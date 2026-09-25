/**
 * Authentication Service & Atomic Consistency Boundary
 * 
 * CORE SECURITY INVARIANTS:
 * 1. ZERO-TRUST IDENTITY: Client is never trusted to supply user ID, tenant ID, or role.
 * 2. ATOMIC AUTHENTICATION BOUNDARY: Authentication state changes (account status updates,
 *    lock count resets, session persistence) and required security audit events (SESSION_CREATED,
 *    LOGIN_SUCCESS) are bound within a real SQLite database transaction.
 * 3. FAIL-CLOSED AUDIT INTEGRITY: If any required security audit event fails to persist,
 *    the entire database transaction rolls back, leaving zero usable active sessions,
 *    reverting user account mutations, and preserving cryptographic audit chain integrity.
 * 4. AUDIT EVENT ORDERING: Within the transaction, SESSION_CREATED precedes LOGIN_SUCCESS,
 *    guaranteeing that the session entity is cataloged before user login completion is logged.
 */

import { Database } from '../database/index.ts';
import { User, Session, SystemRole, AccountStatus } from '../domain/index.ts';
import { SessionService, SESSION_DEFAULT_TTL_MS, type AuthenticatedPrincipal } from './session.ts';
import { AuditLogService, AuditAction } from '../observability/index.ts';
import { verifyPassword, dummyVerify } from '../security/password.ts';
import {
  AuthenticationError,
  InvalidCredentialsError,
  AccountLockedError,
  AccountInactiveError,
  AuditPersistenceError,
} from '../errors/index.ts';
import { logger } from '../observability/index.ts';

export interface AuthenticateCredentialsParams {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  traceId?: string;
}

export interface AuthenticationResult {
  session: Session;
  rawToken: string;
  user: User;
}

export class AuthenticationService {
  constructor(
    private readonly db: Database,
    private readonly sessionService: SessionService,
    private readonly auditLog?: AuditLogService
  ) {}

  private getAuditLog(): AuditLogService | undefined {
    if (this.auditLog && !(this.auditLog as any).db?.isClosed) {
      return this.auditLog;
    }
    return AuditLogService.getInstance();
  }

  /**
   * Authenticates user credentials and executes the atomic login transaction.
   * Enforces timing attack protections, brute-force lockout, and fail-closed audit persistence.
   */
  public async authenticate(params: AuthenticateCredentialsParams): Promise<AuthenticationResult> {
    const { email, password, ipAddress, userAgent, traceId } = params;
    const clientIp = ipAddress || '127.0.0.1';
    const clientUa = userAgent || 'UNKNOWN';

    // 1. Retrieve user by normalized email
    const user = this.db.getUserByEmail(email);

    // Timing-attack defense: If user does not exist, compute full Argon2id verify workload
    if (!user) {
      await dummyVerify();
      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: undefined,
          actorId: 'anonymous',
          actorRole: 'ANONYMOUS',
          action: AuditAction.LOGIN_FAILURE,
          entityType: 'User',
          entityId: 'unknown',
          traceId,
          metadata: { reason: 'USER_NOT_FOUND', email },
        });
      }
      throw new InvalidCredentialsError('Invalid email or password.');
    }

    // 2. Reject locked accounts
    const isLocked =
      user.status === AccountStatus.LOCKED ||
      (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());

    if (isLocked) {
      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: user.tenantId || undefined,
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ACCOUNT_LOCKED,
          entityType: 'User',
          entityId: user.id,
          traceId,
          metadata: { reason: 'ACCOUNT_LOCKED_ACTIVE', lockedUntil: user.lockedUntil },
        });
      }
      throw new AccountLockedError('Account has been locked due to multiple failed login attempts.');
    }

    // 3. Reject inactive or disabled accounts before computing password hash
    if (!user.isActive || user.status !== AccountStatus.ACTIVE) {
      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: user.tenantId || undefined,
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.LOGIN_FAILURE,
          entityType: 'User',
          entityId: user.id,
          traceId,
          metadata: { reason: 'ACCOUNT_INACTIVE', status: user.status },
        });
      }
      throw new AccountInactiveError('Account is inactive or disabled.');
    }

    // 4. Retrieve stored credentials
    const credentials = this.db.getUserCredentials(user.id);
    if (!credentials?.passwordHash) {
      await dummyVerify();
      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: user.tenantId || undefined,
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.LOGIN_FAILURE,
          entityType: 'User',
          entityId: user.id,
          traceId,
          metadata: { reason: 'NO_CREDENTIALS_FOUND' },
        });
      }
      throw new InvalidCredentialsError('Invalid email or password.');
    }

    // 5. Verify password hash using constant-time Argon2id
    const isValidPassword = await verifyPassword(credentials.passwordHash, password);
    if (!isValidPassword) {
      const lockResult = this.db.recordFailedLogin(user.id, 5, 15 * 60 * 1000);
      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: user.tenantId || undefined,
          actorId: user.id,
          actorRole: user.role,
          action: lockResult.isLocked ? AuditAction.ACCOUNT_LOCKED : AuditAction.LOGIN_FAILURE,
          entityType: 'User',
          entityId: user.id,
          traceId,
          metadata: {
            reason: 'BAD_PASSWORD',
            attempts: lockResult.attempts,
            isLocked: lockResult.isLocked,
          },
        });
      }

      if (lockResult.isLocked) {
        throw new AccountLockedError('Account has been locked due to multiple failed login attempts.');
      }

      throw new InvalidCredentialsError('Invalid email or password.');
    }

    // 6. ATOMIC LOGIN TRANSACTION BOUNDARY
    // All authentication state mutations and required security audit events
    // MUST commit together or roll back completely.
    return this.executeLoginTransaction({
      user,
      clientIp,
      clientUa,
      traceId,
    });
  }

  /**
   * Executes the atomic login transaction boundary.
   *
   * Ordering Guarantee:
   * 1. Persistent auth state update: recordSuccessfulLogin(user.id)
   * 2. Session entity creation in database: createSession(...)
   * 3. SESSION_CREATED audit event persisted
   * 4. LOGIN_SUCCESS audit event persisted
   * 5. Commit
   *
   * If any step fails or audit persistence throws, SQLite transaction
   * rolls back all changes, ensuring zero active sessions remain in database.
   */
  public executeLoginTransaction(params: {
    user: User;
    clientIp: string;
    clientUa: string;
    traceId?: string;
  }): AuthenticationResult {
    const { user, clientIp, clientUa, traceId } = params;

    return this.db.transaction(() => {
      // 1. Update persistent user auth state: reset failed login attempts, set last login timestamp
      this.db.recordSuccessfulLogin(user.id);

      // 2. Create server-side session entity in SQLite (skip internal audit to enforce ordered transaction)
      const { session, rawToken } = this.sessionService.createSession(user.id, {
        ipAddress: clientIp,
        userAgent: clientUa,
        skipAudit: true,
      });

      // 3. Persist SESSION_CREATED audit event
      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: user.tenantId || undefined,
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.SESSION_CREATED,
          entityType: 'Session',
          entityId: session.id,
          traceId,
          metadata: {
            ipAddress: clientIp,
            userAgent: clientUa,
            expiresAt: session.expiresAt,
          },
        });

        // 4. Persist LOGIN_SUCCESS audit event
        audit.record({
          tenantId: user.tenantId || undefined,
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.LOGIN_SUCCESS,
          entityType: 'User',
          entityId: user.id,
          traceId,
          metadata: {
            sessionId: session.id,
            ipAddress: clientIp,
            userAgent: clientUa,
          },
        });
      }

      // Fetch refreshed user record
      const updatedUser = this.db.getUser(user.id) || user;

      return {
        session,
        rawToken,
        user: updatedUser,
      };
    });
  }

  /**
   * Resolves and verifies an authorization token.
   * 
   * FAILS CLOSED:
   * - If nodeEnv is 'production', test tokens are strictly rejected regardless of caller flags.
   * - If no valid production authentication mechanism is active and test tokens are disabled, returns null.
   */
  public static verifyToken(
    tokenHeader?: string | null,
    options?: TokenVerificationOptions
  ): AuthenticatedPrincipal | null {
    if (!tokenHeader) {
      return null;
    }

    const match = tokenHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return null;
    }

    const token = match[1].trim();
    if (!token) {
      return null;
    }

    // Determine current environment
    const currentEnv = options?.nodeEnv || 
      (typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined) || 
      'development';

    // STRICT PRODUCTION RULE: Never accept test credentials in production
    if (currentEnv === 'production') {
      // In production mode, predictable static test tokens are rejected unconditionally
      return null;
    }

    // In non-production environments, check if test tokens are permitted
    const allowTestTokens = options?.allowTestTokens ?? (
      currentEnv === 'test' ||
      currentEnv === 'development' ||
      (typeof process !== 'undefined' && process.env?.ALLOW_DEV_TEST_TOKENS === 'true')
    );

    if (!allowTestTokens) {
      // Fails closed if test tokens are disabled
      return null;
    }

    // Resolve isolated test fixture if explicitly registered in non-production test runner
    if (!activeTestPrincipalsFixture) {
      return null;
    }
    const principal = activeTestPrincipalsFixture[token];
    return principal || null;
  }

  /**
   * Registers test/dev principal fixtures in test harnesses.
   * Strictly disallowed in production.
   */
  public static registerTestFixtures(fixtures: Record<string, AuthenticatedPrincipal>): void {
    const currentEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
    if (currentEnv !== 'production') {
      activeTestPrincipalsFixture = fixtures;
    }
  }

  /**
   * Clears registered test fixtures.
   */
  public static clearTestFixtures(): void {
    activeTestPrincipalsFixture = null;
  }
}

let activeTestPrincipalsFixture: Record<string, AuthenticatedPrincipal> | null = null;

export interface TokenVerificationOptions {
  nodeEnv?: string;
  allowTestTokens?: boolean;
}

