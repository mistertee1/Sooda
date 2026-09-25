/**
 * Server-Side Session Management Service
 * Production-Grade Opaque Session Tokens with Cryptographic Hashing.
 * 
 * SECURITY SPECIFICATIONS:
 * 1. Opaque Tokens: Cryptographically secure 32-byte pseudo-random tokens (crypto.randomBytes).
 * 2. Hash-at-Rest: Only SHA-256 digests of session tokens are stored in the database.
 * 3. Constant-Time & Revocation: Revocation immediately renders the token invalid.
 * 4. Account Status Enforcement: Revoked/Locked/Suspended accounts are strictly rejected.
 * 5. Last Seen Tracking: Updates last_seen_at timestamp to support idle monitoring.
 */

import crypto from 'node:crypto';
import { Database } from '../database/index.ts';
import { User, Session, AccountStatus, SystemRole, TenantMembership } from '../domain/index.ts';
import { AuditLogService, AuditAction } from '../observability/index.ts';

export const SESSION_COOKIE_NAME = 'sooda_session';
export const SESSION_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthenticatedPrincipal {
  id: string;
  email: string;
  role: SystemRole;
  status: AccountStatus;
  tenantId: string | null;
  fullName: string;
  memberships: TenantMembership[];
  sessionId?: string;
}

export type SessionValidationResult =
  | { valid: true; session: Session; user: User; principal: AuthenticatedPrincipal }
  | {
      valid: false;
      reason:
        | 'MISSING_TOKEN'
        | 'SESSION_NOT_FOUND_OR_REVOKED'
        | 'SESSION_EXPIRED'
        | 'USER_NOT_FOUND'
        | 'ACCOUNT_LOCKED'
        | 'ACCOUNT_INACTIVE';
    };

export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly auditLog?: AuditLogService
  ) {}

  private getAuditLog(): AuditLogService | undefined {
    if (this.auditLog && !(this.auditLog as any).db?.isClosed) {
      return this.auditLog;
    }
    return AuditLogService.getInstance();
  }

  /**
   * Hashes an opaque session token using SHA-256 for persistent database lookup.
   */
  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a 256-bit cryptographically secure random token formatted as base64url.
   */
  public static generateToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Creates a new server-side session for an authenticated user.
   */
  public createSession(
    userId: string,
    options?: {
      ipAddress?: string | null;
      userAgent?: string | null;
      ttlMs?: number;
      actorRole?: string;
      tenantId?: string | null;
      skipAudit?: boolean;
    }
  ): { session: Session; rawToken: string } {
    return this.db.transaction(() => {
      const rawToken = SessionService.generateToken();
      const tokenHash = SessionService.hashToken(rawToken);
      const now = new Date();
      const ttl = options?.ttlMs ?? SESSION_DEFAULT_TTL_MS;
      const expiresAt = new Date(now.getTime() + ttl).toISOString();
      const sessionId = `sess_${crypto.randomUUID()}`;

      const session = this.db.createSession({
        id: sessionId,
        userId,
        sessionTokenHash: tokenHash,
        expiresAt,
        ipAddress: options?.ipAddress ?? null,
        userAgent: options?.userAgent ?? null,
      });

      const audit = this.getAuditLog();
      if (audit && !options?.skipAudit) {
        audit.record({
          tenantId: options?.tenantId ?? undefined,
          actorId: userId,
          actorRole: options?.actorRole ?? 'SYSTEM',
          action: AuditAction.SESSION_CREATED,
          entityType: 'Session',
          entityId: sessionId,
          metadata: {
            ipAddress: options?.ipAddress ?? 'UNKNOWN',
            userAgent: options?.userAgent ?? 'UNKNOWN',
            expiresAt,
          },
        });
      }

      return { session, rawToken };
    });
  }

  /**
   * Validates a raw session token against the persistent database.
   * Enforces expiration, revocation, user existence, account lock status, and active status.
   */
  public validateSession(rawToken: string): SessionValidationResult {
    if (!rawToken || typeof rawToken !== 'string') {
      return { valid: false, reason: 'MISSING_TOKEN' };
    }

    const tokenHash = SessionService.hashToken(rawToken.trim());
    const session = this.db.getSessionByTokenHash(tokenHash);

    if (!session || session.isRevoked) {
      return { valid: false, reason: 'SESSION_NOT_FOUND_OR_REVOKED' };
    }

    const now = Date.now();
    const expiresTime = new Date(session.expiresAt).getTime();
    if (expiresTime <= now) {
      return { valid: false, reason: 'SESSION_EXPIRED' };
    }

    const user = this.db.getUser(session.userId);
    if (!user) {
      return { valid: false, reason: 'USER_NOT_FOUND' };
    }

    // Check account lockout
    if (
      user.status === AccountStatus.LOCKED ||
      (user.lockedUntil && new Date(user.lockedUntil).getTime() > now)
    ) {
      return { valid: false, reason: 'ACCOUNT_LOCKED' };
    }

    // Check account status
    if (user.status !== AccountStatus.ACTIVE || !user.isActive) {
      return { valid: false, reason: 'ACCOUNT_INACTIVE' };
    }

    // Update last seen timestamp
    const nowIso = new Date(now).toISOString();
    this.db.touchSession(session.id, nowIso);

    const principal: AuthenticatedPrincipal = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      tenantId: user.tenantId,
      fullName: user.fullName,
      memberships: user.memberships ?? [],
      sessionId: session.id,
    };

    return { valid: true, session, user, principal };
  }

  /**
   * Revokes a session identified by its raw bearer token or cookie value.
   */
  public revokeSessionByToken(rawToken: string): boolean {
    if (!rawToken) return false;
    const tokenHash = SessionService.hashToken(rawToken.trim());
    const session = this.db.getSessionByTokenHash(tokenHash);
    if (!session) return false;

    return this.db.transaction(() => {
      this.db.revokeSession(session.id);

      const audit = this.getAuditLog();
      if (audit) {
        audit.record({
          tenantId: undefined,
          actorId: session.userId,
          actorRole: 'SYSTEM',
          action: AuditAction.SESSION_REVOKED,
          entityType: 'Session',
          entityId: session.id,
          metadata: { revokedVia: 'TOKEN' },
        });
      }

      return true;
    });
  }

  /**
   * Revokes a specific session by its primary key ID.
   */
  public revokeSessionById(sessionId: string, actorUserId?: string): void {
    this.db.revokeSession(sessionId);

    const audit = this.getAuditLog();
    if (audit) {
      try {
        audit.record({
          tenantId: undefined,
          actorId: actorUserId || 'system',
          actorRole: 'SYSTEM',
          action: AuditAction.SESSION_REVOKED,
          entityType: 'Session',
          entityId: sessionId,
          metadata: { revokedVia: 'SESSION_ID' },
        });
      } catch (err) {
        throw err;
      }
    }
  }

  /**
   * Revokes all active sessions for a given user (e.g., password reset or security breach).
   */
  public revokeAllUserSessions(userId: string, actorUserId?: string): void {
    this.db.revokeAllUserSessions(userId);

    const audit = this.getAuditLog();
    if (audit) {
      try {
        audit.record({
          tenantId: undefined,
          actorId: actorUserId ?? userId,
          actorRole: 'SYSTEM',
          action: AuditAction.ALL_SESSIONS_REVOKED,
          entityType: 'User',
          entityId: userId,
          metadata: { reason: 'GLOBAL_REVOCATION' },
        });
      } catch (err) {
        throw err;
      }
    }
  }

  /**
   * Extracts authentication token from either HttpOnly cookie or Authorization Bearer header.
   */
  public static extractTokenFromRequest(req: {
    cookies?: Record<string, string>;
    headers?: Record<string, string | string[] | undefined>;
  }): string | null {
    // 1. Check HttpOnly cookie first (recommended web auth pattern)
    if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
      return req.cookies[SESSION_COOKIE_NAME];
    }

    // 2. Fallback to Authorization: Bearer <token> (API / programmatic clients)
    const authHeader = req.headers?.['authorization'] || req.headers?.['Authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }
}
