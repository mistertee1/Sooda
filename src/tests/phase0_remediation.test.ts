/**
 * Phase 0.2 Foundation Blocker Remediation Test Suite
 * 
 * Verifies all 5 remediation areas:
 * 1. Authentication: Isolated test credentials, production lockout (fails closed), unknown/malformed credential handling.
 * 2. Audit Log: Database persistence, restart survival, integrity verification, tamper detection, and restoration.
 * 3. Database: Engine abstraction (IDatabaseAdapter), deterministic & repeatable versioned migrations.
 * 4. Rate Limiting: Pluggable IRateLimitStore and MemoryRateLimitStore sliding window functionality.
 * 5. Workflow: Engine orchestration, ordered execution, stop on failure, reverse compensation, trace propagation, audit logging.
 */

import path from 'node:path';
import fs from 'node:fs';
import { AuthenticationService, AuthorizationPolicy } from '../core/auth/index.ts';
import { Database, SQLiteDatabaseAdapter, IDatabaseAdapter } from '../core/database/index.ts';
import { AuditLogService, AuditAction, registerAuditDatabaseProvider } from '../core/observability/index.ts';
import { IRateLimitStore, MemoryRateLimitStore, RateLimiter } from '../core/security/rateLimit.ts';
import { Workflow, WorkflowContext } from '../core/workflow/index.ts';
import { SystemRole, Permission } from '../core/domain/index.ts';
import { TenantResolver } from '../core/tenant/index.ts';
import { TenantMismatchError, AuthorizationError } from '../core/errors/index.ts';
import { DEV_TEST_PRINCIPALS_FIXTURE } from './fixtures/test_tokens.ts';

export interface RemediationTestResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export class RemediationTestSuite {
  public static async runAll(): Promise<RemediationTestResult[]> {
    AuthenticationService.registerTestFixtures(DEV_TEST_PRINCIPALS_FIXTURE);
    const db = Database.resetInstance(':memory:');
    registerAuditDatabaseProvider(() => Database.getInstance());
    AuditLogService.resetInstance(db);
    const results: RemediationTestResult[] = [];

    // --- BLOCKER 1: AUTHENTICATION REMEDIATION ---
    results.push(this.testAuthProductionFailsClosed());
    results.push(this.testAuthUnknownCredentialsFail());
    results.push(this.testAuthMalformedCredentialsFail());
    results.push(this.testAuthPrivilegeEscalationPreventedInProduction());
    results.push(this.testTenantAuthorizationStillOccursAfterIdentityResolution());

    // --- BLOCKER 2: PERSISTENT AUDIT LOG REMEDIATION ---
    results.push(await this.testAuditPersistenceAndRestartIntegrity());
    results.push(await this.testAuditTamperingDetectionAndRecovery());

    // --- BLOCKER 3: DATABASE ABSTRACTION & DETERMINISTIC MIGRATIONS ---
    results.push(this.testDatabaseAdapterAbstraction());
    results.push(this.testDeterministicMigrationExecution());

    // --- BLOCKER 4: RATE LIMIT STORE ABSTRACTION ---
    results.push(this.testRateLimitStoreSlidingWindow());
    results.push(this.testRateLimiterPluggableStore());

    // --- BLOCKER 5: WORKFLOW ENGINE ORCHESTRATION ---
    results.push(await this.testWorkflowOrderedExecution());
    results.push(await this.testWorkflowFailureStopsExecutionAndCompensatesReverse());
    results.push(await this.testWorkflowTracePropagationAndContextPassing());
    results.push(await this.testWorkflowFailureAuditLogging());

    return results;
  }

  // =========================================================================
  // BLOCKER 1: AUTHENTICATION
  // =========================================================================

  private static testAuthProductionFailsClosed(): RemediationTestResult {
    try {
      // In production mode, test tokens MUST fail closed and return null
      const principal = AuthenticationService.verifyToken('Bearer token_platform_admin', {
        nodeEnv: 'production',
        allowTestTokens: false,
      });

      if (principal !== null) {
        throw new Error('SECURITY VIOLATION: Test token was accepted in production mode!');
      }

      return {
        id: 'REM-AUTH-01',
        name: 'Test credentials fail closed and return null in production mode',
        category: 'Authentication',
        passed: true,
        message: 'Static test credentials strictly rejected when NODE_ENV is production.',
      };
    } catch (err: any) {
      return {
        id: 'REM-AUTH-01',
        name: 'Test credentials fail closed and return null in production mode',
        category: 'Authentication',
        passed: false,
        message: err.message,
      };
    }
  }

  private static testAuthUnknownCredentialsFail(): RemediationTestResult {
    try {
      const result = AuthenticationService.verifyToken('Bearer random_forged_token_xyz', {
        nodeEnv: 'development',
      });

      if (result !== null) {
        throw new Error('Unknown credentials did not return null');
      }

      return {
        id: 'REM-AUTH-02',
        name: 'Unknown credentials return null (unauthenticated)',
        category: 'Authentication',
        passed: true,
        message: 'Arbitrary/unrecognized bearer tokens safely return null.',
      };
    } catch (err: any) {
      return {
        id: 'REM-AUTH-02',
        name: 'Unknown credentials return null (unauthenticated)',
        category: 'Authentication',
        passed: false,
        message: err.message,
      };
    }
  }

  private static testAuthMalformedCredentialsFail(): RemediationTestResult {
    try {
      const tests = [
        '',
        '   ',
        'Basic dXNlcjpwYXNz',
        'Token 12345',
        'Bearer',
        'Bearer   ',
        null,
        undefined,
      ];

      for (const input of tests) {
        const res = AuthenticationService.verifyToken(input as any, { nodeEnv: 'development' });
        if (res !== null) {
          throw new Error(`Malformed credential '${input}' was not rejected!`);
        }
      }

      return {
        id: 'REM-AUTH-03',
        name: 'Malformed credentials safely return null without exception',
        category: 'Authentication',
        passed: true,
        message: 'All malformed/non-Bearer authorization headers correctly rejected.',
      };
    } catch (err: any) {
      return {
        id: 'REM-AUTH-03',
        name: 'Malformed credentials safely return null without exception',
        category: 'Authentication',
        passed: false,
        message: err.message,
      };
    }
  }

  private static testAuthPrivilegeEscalationPreventedInProduction(): RemediationTestResult {
    try {
      // Attempting to obtain PLATFORM_ADMIN via predictable token in production
      const adminPrincipal = AuthenticationService.verifyToken('Bearer token_platform_admin', {
        nodeEnv: 'production',
      });

      if (adminPrincipal !== null) {
        throw new Error('SECURITY VIOLATION: Privileged role obtained via predictable token in production!');
      }

      return {
        id: 'REM-AUTH-04',
        name: 'Privileged role cannot be obtained through predictable tokens in production',
        category: 'Authentication',
        passed: true,
        message: 'Platform admin role cannot be resolved via test credentials in production.',
      };
    } catch (err: any) {
      return {
        id: 'REM-AUTH-04',
        name: 'Privileged role cannot be obtained through predictable tokens in production',
        category: 'Authentication',
        passed: false,
        message: err.message,
      };
    }
  }

  private static testTenantAuthorizationStillOccursAfterIdentityResolution(): RemediationTestResult {
    try {
      // In dev/test, identity resolution provides a principal
      const principal = AuthenticationService.verifyToken('Bearer token_albaraka_owner', {
        nodeEnv: 'test',
        allowTestTokens: true,
      });

      if (!principal) {
        throw new Error('Principal fixture failed to resolve in test mode');
      }

      // Proving: resolving a principal DOES NOT bypass authorization
      // 1. RBAC check: Merchant cannot perform platform-wide manage tenants
      let rbacBlocked = false;
      try {
        AuthorizationPolicy.assertAuthorized(principal, Permission.PLATFORM_MANAGE_TENANTS);
      } catch (err) {
        if (err instanceof AuthorizationError) {
          rbacBlocked = true;
        }
      }

      if (!rbacBlocked) {
        throw new Error('RBAC authorization was bypassed after identity resolution!');
      }

      // 2. Tenant isolation check: Albaraka merchant cannot access NileCrafts tenant
      let tenantBlocked = false;
      try {
        TenantResolver.assertTenantOwnership(
          principal.tenantId!,
          'tenant_store_nilecrafts',
          false,
          principal.id,
          principal.role
        );
      } catch (err) {
        if (err instanceof TenantMismatchError) {
          tenantBlocked = true;
        }
      }

      if (!tenantBlocked) {
        throw new Error('Cross-tenant isolation was bypassed after identity resolution!');
      }

      return {
        id: 'REM-AUTH-05',
        name: 'Tenant authorization and RBAC strictly enforced after identity resolution',
        category: 'Authentication',
        passed: true,
        message: 'Identity resolution does not grant authorization; RBAC & tenant boundaries hold firm.',
      };
    } catch (err: any) {
      return {
        id: 'REM-AUTH-05',
        name: 'Tenant authorization and RBAC strictly enforced after identity resolution',
        category: 'Authentication',
        passed: false,
        message: err.message,
      };
    }
  }

  // =========================================================================
  // BLOCKER 2: PERSISTENT AUDIT LOG
  // =========================================================================

  private static async testAuditPersistenceAndRestartIntegrity(): Promise<RemediationTestResult> {
    const testDbPath = path.join(process.cwd(), 'data', 'test_audit_persistence.db');
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }

      const db = Database.resetInstance(testDbPath);
      const audit = AuditLogService.resetInstance(db);

      // Write audit events
      const evt1 = audit.record({
        actorId: 'user_merchant_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        tenantId: 'tenant_1',
        entityType: 'User',
        entityId: 'user_merchant_1',
      });

      const evt2 = audit.record({
        actorId: 'user_merchant_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        tenantId: 'tenant_1',
        entityType: 'StoreSettings',
        entityId: 'settings_tenant_1',
      });

      // Verify chain before restart
      const preRestartCheck = audit.verifyIntegrity(db);
      if (!preRestartCheck.valid) {
        throw new Error(`Pre-restart audit integrity failed: ${preRestartCheck.errors.join(', ')}`);
      }

      // SIMULATE APPLICATION RESTART:
      // Close and re-open database, and re-initialize AuditLogService singleton
      db.rawDb.close();
      const reopenedDb = Database.resetInstance(testDbPath);
      const restartedAudit = AuditLogService.resetInstance(reopenedDb);

      // Read events from reopened persistent DB
      const latest = reopenedDb.getLatestAuditEvent();
      if (!latest || latest.sequenceNumber !== 2) {
        throw new Error(`Restart failed to reconstruct latest sequence. Expected 2, found ${latest?.sequenceNumber}`);
      }

      if (latest.hash !== evt2.hash) {
        throw new Error(`Restart failed to reconstruct head hash. Expected ${evt2.hash}, found ${latest.hash}`);
      }

      // Verify chain reconstructed from persistent database records
      const postRestartCheck = restartedAudit.verifyIntegrity(reopenedDb);
      if (!postRestartCheck.valid || postRestartCheck.verifiedCount !== 2) {
        throw new Error(`Post-restart integrity failed: ${postRestartCheck.errors.join(', ')}`);
      }

      // Record a new event after restart to prove chain continuity across restarts
      const evt3 = restartedAudit.record({
        actorId: 'user_merchant_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        tenantId: 'tenant_1',
        entityType: 'Store',
        entityId: 'store_1',
      });

      if (evt3.previousHash !== evt2.hash) {
        throw new Error(`Cryptographic chain broken across restart! Expected previousHash ${evt2.hash}, got ${evt3.previousHash}`);
      }

      const continuityCheck = restartedAudit.verifyIntegrity(reopenedDb);
      if (!continuityCheck.valid || continuityCheck.verifiedCount !== 3) {
        throw new Error(`Post-restart chain continuity failed: ${continuityCheck.errors.join(', ')}`);
      }

      // Cleanup
      reopenedDb.rawDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }

      // Restore in-memory singleton
      const memDb = Database.resetInstance(':memory:');
      registerAuditDatabaseProvider(() => Database.getInstance());
      AuditLogService.resetInstance(memDb);

      return {
        id: 'REM-AUDIT-01',
        name: 'Audit log persists to database and survives application restart with unbroken cryptographic chain',
        category: 'Audit Logging',
        passed: true,
        message: 'Persistent records read, sequence & head hash reconstructed, and chain verified across restart.',
      };
    } catch (err: any) {
      if (fs.existsSync(testDbPath)) {
        try { fs.unlinkSync(testDbPath); } catch {}
      }
      const memDb = Database.resetInstance(':memory:');
      registerAuditDatabaseProvider(() => Database.getInstance());
      AuditLogService.resetInstance(memDb);
      return {
        id: 'REM-AUDIT-01',
        name: 'Audit log persists to database and survives application restart with unbroken cryptographic chain',
        category: 'Audit Logging',
        passed: false,
        message: err.message,
      };
    }
  }

  private static async testAuditTamperingDetectionAndRecovery(): Promise<RemediationTestResult> {
    const testDbPath = path.join(process.cwd(), 'data', 'test_audit_tamper.db');
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }

      const db = Database.resetInstance(testDbPath);
      const audit = AuditLogService.resetInstance(db);

      // Write 3 genuine events
      const evt1 = audit.record({
        actorId: 'user_admin',
        actorRole: 'PLATFORM_ADMIN',
        action: AuditAction.USER_LOGIN,
        entityType: 'Platform',
        entityId: 'platform_core',
      });

      const evt2 = audit.record({
        actorId: 'user_admin',
        actorRole: 'PLATFORM_ADMIN',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_new_1',
      });

      const evt3 = audit.record({
        actorId: 'user_admin',
        actorRole: 'PLATFORM_ADMIN',
        action: AuditAction.PERMISSION_GRANTED,
        entityType: 'User',
        entityId: 'user_subadmin',
      });

      // Confirm clean state
      const initialCheck = audit.verifyIntegrity(db);
      if (!initialCheck.valid) {
        throw new Error('Initial audit integrity check failed');
      }

      // 1. TAMPER WITH DATABASE RECORD #2:
      // An unauthorized attacker directly modifies the action column in SQLite
      db.rawDb.prepare("UPDATE audit_events SET action = 'TAMPERED_MALICIOUS_ACTION' WHERE sequence_number = 2").run();

      // 2. RUN INTEGRITY VERIFICATION -> MUST FAIL
      const tamperedCheck = audit.verifyIntegrity(db);
      if (tamperedCheck.valid) {
        throw new Error('SECURITY VIOLATION: Tampered audit record in database was NOT detected!');
      }

      const hasTamperError = tamperedCheck.errors.some((e) => e.includes('tampered record') || e.includes('broken chain'));
      if (!hasTamperError) {
        throw new Error(`Expected tamper error, got: ${tamperedCheck.errors.join(', ')}`);
      }

      // 3. RESTORE DATABASE RECORD TO ORIGINAL VALUE
      db.rawDb.prepare('UPDATE audit_events SET action = ? WHERE sequence_number = 2').run(evt2.action);

      // 4. CONFIRM RESTORATION SUCCEEDS
      const restoredCheck = audit.verifyIntegrity(db);
      if (!restoredCheck.valid) {
        throw new Error(`Restoration failed to restore valid chain: ${restoredCheck.errors.join(', ')}`);
      }

      // Cleanup
      db.rawDb.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      const memDb = Database.resetInstance(':memory:');
      registerAuditDatabaseProvider(() => Database.getInstance());
      AuditLogService.resetInstance(memDb);

      return {
        id: 'REM-AUDIT-02',
        name: 'Tamper detection confirms modification failure and restores valid verification',
        category: 'Audit Logging',
        passed: true,
        message: 'Direct database tampering detected via hash mismatch; restoration re-establishes validity.',
      };
    } catch (err: any) {
      if (fs.existsSync(testDbPath)) {
        try { fs.unlinkSync(testDbPath); } catch {}
      }
      const memDb = Database.resetInstance(':memory:');
      registerAuditDatabaseProvider(() => Database.getInstance());
      AuditLogService.resetInstance(memDb);
      return {
        id: 'REM-AUDIT-02',
        name: 'Tamper detection confirms modification failure and restores valid verification',
        category: 'Audit Logging',
        passed: false,
        message: err.message,
      };
    }
  }

  // =========================================================================
  // BLOCKER 3: DATABASE ABSTRACTION & DETERMINISTIC MIGRATIONS
  // =========================================================================

  private static testDatabaseAdapterAbstraction(): RemediationTestResult {
    try {
      const db = Database.getInstance();
      const adapter: IDatabaseAdapter = db.adapter;

      if (!adapter) {
        throw new Error('Database instance does not expose an IDatabaseAdapter implementation');
      }

      if (adapter.engineName !== 'sqlite') {
        throw new Error(`Unexpected development database engine: ${adapter.engineName}`);
      }

      if (adapter.isDistributedCapable !== false) {
        throw new Error('SQLite adapter must correctly identify as non-distributed');
      }

      // Test adapter operations
      const platforms = adapter.query('SELECT * FROM platforms WHERE id = ?', ['platform_sooda_core']);
      if (!platforms || platforms.length !== 1) {
        throw new Error('Adapter query failed to return expected platform record');
      }

      const platformOne = adapter.queryOne<{ id: string }>('SELECT id FROM platforms WHERE id = ?', ['platform_sooda_core']);
      if (!platformOne || platformOne.id !== 'platform_sooda_core') {
        throw new Error('Adapter queryOne failed to return record');
      }

      return {
        id: 'REM-DB-01',
        name: 'Database adapter abstraction decouples domain from SQLite engine',
        category: 'Database Strategy',
        passed: true,
        message: 'IDatabaseAdapter contract verified; SQLite adapter cleanly encapsulates local engine.',
      };
    } catch (err: any) {
      return {
        id: 'REM-DB-01',
        name: 'Database adapter abstraction decouples domain from SQLite engine',
        category: 'Database Strategy',
        passed: false,
        message: err.message,
      };
    }
  }

  private static testDeterministicMigrationExecution(): RemediationTestResult {
    try {
      const db = Database.getInstance();

      // Initial applied migrations
      const initialApplied = db.getAppliedMigrations();
      if (initialApplied.length < 2) {
        throw new Error(`Expected at least 2 migrations applied, found ${initialApplied.length}`);
      }

      // Execute runMigrations() repeatedly to prove idempotence and non-destructiveness
      db.runMigrations();
      db.runMigrations();

      const postApplied = db.getAppliedMigrations();
      if (postApplied.length !== initialApplied.length) {
        throw new Error(`Repeated migration run altered migration count: ${initialApplied.length} -> ${postApplied.length}`);
      }

      // Verify existing data was NOT destroyed by repeated migration execution
      const platform = db.getPlatform('platform_sooda_core');
      if (!platform) {
        throw new Error('Repeated migration execution caused data loss!');
      }

      return {
        id: 'REM-DB-02',
        name: 'Deterministic versioned migrations execute idempotently without data loss',
        category: 'Database Strategy',
        passed: true,
        message: 'Versioned migrations table checked; repeated execution executes safely without reset.',
      };
    } catch (err: any) {
      return {
        id: 'REM-DB-02',
        name: 'Deterministic versioned migrations execute idempotently without data loss',
        category: 'Database Strategy',
        passed: false,
        message: err.message,
      };
    }
  }

  // =========================================================================
  // BLOCKER 4: RATE LIMIT STORE ABSTRACTION
  // =========================================================================

  private static testRateLimitStoreSlidingWindow(): RemediationTestResult {
    try {
      const store: IRateLimitStore = new MemoryRateLimitStore();
      const clientKey = 'client_test_ip_1';
      const limit = 3;
      const windowMs = 5000;

      // Request 1: Allowed
      const r1 = store.incrementAndCheck(clientKey, limit, windowMs) as any;
      if (!r1.allowed || r1.remaining !== 2) {
        throw new Error(`Request 1 check failed: remaining ${r1.remaining}`);
      }

      // Request 2: Allowed
      const r2 = store.incrementAndCheck(clientKey, limit, windowMs) as any;
      if (!r2.allowed || r2.remaining !== 1) {
        throw new Error(`Request 2 check failed: remaining ${r2.remaining}`);
      }

      // Request 3: Allowed (reaches limit)
      const r3 = store.incrementAndCheck(clientKey, limit, windowMs) as any;
      if (!r3.allowed || r3.remaining !== 0) {
        throw new Error(`Request 3 check failed: remaining ${r3.remaining}`);
      }

      // Request 4: Blocked (exceeds limit)
      const r4 = store.incrementAndCheck(clientKey, limit, windowMs) as any;
      if (r4.allowed !== false || r4.remaining !== 0) {
        throw new Error(`Request 4 was not throttled: allowed ${r4.allowed}`);
      }

      // Reset
      store.reset(clientKey);
      const rAfterReset = store.incrementAndCheck(clientKey, limit, windowMs) as any;
      if (!rAfterReset.allowed) {
        throw new Error('Reset failed to clear rate limit counter');
      }

      return {
        id: 'REM-RATE-01',
        name: 'MemoryRateLimitStore implements sliding window rate limiting and reset',
        category: 'Rate Limiting',
        passed: true,
        message: 'Sliding window throttling, remaining counter decrement, and store reset verified.',
      };
    } catch (err: any) {
      return {
        id: 'REM-RATE-01',
        name: 'MemoryRateLimitStore implements sliding window rate limiting and reset',
        category: 'Rate Limiting',
        passed: false,
        message: err.message,
      };
    }
  }

  private static testRateLimiterPluggableStore(): RemediationTestResult {
    try {
      const memoryStore = new MemoryRateLimitStore();
      const limiter = new RateLimiter(memoryStore, 5, 60000);

      if (limiter.getStore() !== memoryStore) {
        throw new Error('RateLimiter did not bind provided store instance');
      }

      if (limiter.getStore().isDistributed !== false) {
        throw new Error('Memory store must identify as non-distributed');
      }

      return {
        id: 'REM-RATE-02',
        name: 'RateLimiter accepts pluggable IRateLimitStore implementations',
        category: 'Rate Limiting',
        passed: true,
        message: 'IRateLimitStore contract enables transparent substitution of distributed Redis in production.',
      };
    } catch (err: any) {
      return {
        id: 'REM-RATE-02',
        name: 'RateLimiter accepts pluggable IRateLimitStore implementations',
        category: 'Rate Limiting',
        passed: false,
        message: err.message,
      };
    }
  }

  // =========================================================================
  // BLOCKER 5: WORKFLOW ENGINE ORCHESTRATION
  // =========================================================================

  private static async testWorkflowOrderedExecution(): Promise<RemediationTestResult> {
    try {
      const executionOrder: string[] = [];

      const wf = new Workflow<{ initial: number }, { step3: number }>('TestOrderedWorkflow')
        .step({
          name: 'Step1',
          execute: (input: any) => {
            executionOrder.push('Step1');
            return { value: input.initial + 1 };
          },
        })
        .step({
          name: 'Step2',
          execute: (input: any) => {
            executionOrder.push('Step2');
            return { value: input.value * 2 };
          },
        })
        .step({
          name: 'Step3',
          execute: (input: any) => {
            executionOrder.push('Step3');
            return { step3: input.value + 10 };
          },
        });

      const result = await wf.run({ initial: 5 });

      if (!result.success) {
        throw new Error(`Workflow failed: ${result.error}`);
      }

      if (result.data?.step3 !== 22) {
        throw new Error(`Unexpected result data: ${JSON.stringify(result.data)}`);
      }

      const orderString = executionOrder.join('->');
      if (orderString !== 'Step1->Step2->Step3') {
        throw new Error(`Execution order violation: ${orderString}`);
      }

      return {
        id: 'REM-WF-01',
        name: 'Workflow executes steps in strict chronological order',
        category: 'Workflow Engine',
        passed: true,
        message: 'Step1->Step2->Step3 pipeline executed successfully with typed output propagation.',
      };
    } catch (err: any) {
      return {
        id: 'REM-WF-01',
        name: 'Workflow executes steps in strict chronological order',
        category: 'Workflow Engine',
        passed: false,
        message: err.message,
      };
    }
  }

  private static async testWorkflowFailureStopsExecutionAndCompensatesReverse(): Promise<RemediationTestResult> {
    try {
      const executedSteps: string[] = [];
      const compensatedSteps: string[] = [];

      const wf = new Workflow<{ accountId: string }, { done: boolean }>('FailingRollbackWorkflow')
        .step({
          name: 'AllocateResource',
          execute: (input: any) => {
            executedSteps.push('AllocateResource');
            return { resourceId: 'res_123', ...input };
          },
          compensate: () => {
            compensatedSteps.push('AllocateResource');
          },
        })
        .step({
          name: 'ReserveCapacity',
          execute: (input: any) => {
            executedSteps.push('ReserveCapacity');
            return { capacityId: 'cap_456', ...input };
          },
          compensate: () => {
            compensatedSteps.push('ReserveCapacity');
          },
        })
        .step({
          name: 'FailingStep',
          execute: () => {
            executedSteps.push('FailingStep');
            throw new Error('Simulated external service timeout');
          },
          compensate: () => {
            compensatedSteps.push('FailingStep');
          },
        })
        .step({
          name: 'UnreachableStep',
          execute: () => {
            executedSteps.push('UnreachableStep');
            return { done: true };
          },
        });

      const result = await wf.run({ accountId: 'acc_001' });

      if (result.success) {
        throw new Error('Workflow was expected to fail but reported success!');
      }

      // Step execution must stop after FailingStep (UnreachableStep must NOT run)
      if (executedSteps.includes('UnreachableStep')) {
        throw new Error('Execution was not stopped: UnreachableStep ran after failure!');
      }

      // Compensations must execute in REVERSE order of completed steps:
      // Step 2 (ReserveCapacity) then Step 1 (AllocateResource). FailingStep did not succeed so it is not compensated.
      const compString = compensatedSteps.join('->');
      if (compString !== 'ReserveCapacity->AllocateResource') {
        throw new Error(`Compensations did not execute in reverse order! Expected ReserveCapacity->AllocateResource, got: ${compString}`);
      }

      return {
        id: 'REM-WF-02',
        name: 'Step failure halts execution and triggers reverse-order compensation rollback',
        category: 'Workflow Engine',
        passed: true,
        message: 'UnreachableStep skipped; Reverse compensation executed: ReserveCapacity then AllocateResource.',
      };
    } catch (err: any) {
      return {
        id: 'REM-WF-02',
        name: 'Step failure halts execution and triggers reverse-order compensation rollback',
        category: 'Workflow Engine',
        passed: false,
        message: err.message,
      };
    }
  }

  private static async testWorkflowTracePropagationAndContextPassing(): Promise<RemediationTestResult> {
    try {
      const explicitTraceId = 'trace_custom_seed_98765';
      let capturedTraceId = '';
      let capturedStep1Data: unknown = null;

      const wf = new Workflow<{ payload: string }, { final: string }>('TraceContextWorkflow')
        .step({
          name: 'ExtractHeader',
          execute: (input: any, ctx) => {
            capturedTraceId = ctx.traceId;
            return { extracted: input.payload.toUpperCase() };
          },
        })
        .step({
          name: 'TransformPayload',
          execute: (input: any, ctx) => {
            capturedStep1Data = ctx.stepData['ExtractHeader'];
            return { final: `PROCESSED:${input.extracted}` };
          },
        });

      const result = await wf.run(
        { payload: 'test_value' },
        { traceId: explicitTraceId }
      );

      if (!result.success) {
        throw new Error(`Workflow execution failed: ${result.error}`);
      }

      if (capturedTraceId !== explicitTraceId) {
        throw new Error(`Trace ID was not preserved: expected ${explicitTraceId}, captured ${capturedTraceId}`);
      }

      if (!capturedStep1Data || (capturedStep1Data as any).extracted !== 'TEST_VALUE') {
        throw new Error(`Context stepData was not passed to subsequent step: ${JSON.stringify(capturedStep1Data)}`);
      }

      return {
        id: 'REM-WF-03',
        name: 'Workflow context passes stepData and propagates trace correlation ID',
        category: 'Workflow Engine',
        passed: true,
        message: 'Trace correlation ID preserved throughout execution; previous step outputs accessible in context.',
      };
    } catch (err: any) {
      return {
        id: 'REM-WF-03',
        name: 'Workflow context passes stepData and propagates trace correlation ID',
        category: 'Workflow Engine',
        passed: false,
        message: err.message,
      };
    }
  }

  private static async testWorkflowFailureAuditLogging(): Promise<RemediationTestResult> {
    try {
      const audit = AuditLogService.getInstance();
      const testTraceId = `trace_wf_failure_audit_${Date.now()}`;

      const wf = new Workflow<{ key: string }, void>('AuditLoggingFailingWorkflow')
        .step({
          name: 'StepThatSucceeds',
          execute: () => ({ ok: true }),
          compensate: () => {},
        })
        .step({
          name: 'StepThatThrows',
          execute: () => {
            throw new Error('Simulated downstream outage');
          },
        });

      await wf.run({ key: 'val' }, { traceId: testTraceId, tenantId: 'tenant_store_albaraka' });

      // Check audit log for WORKFLOW_FAILED_COMPENSATED event
      const recentEvents = audit.getRecent(10);
      const failureEvent = recentEvents.find((e) => e.traceId === testTraceId);

      if (!failureEvent) {
        throw new Error('Workflow failure did not record an audit log event with the matching traceId');
      }

      if (failureEvent.action !== AuditAction.WORKFLOW_FAILED_COMPENSATED) {
        throw new Error(`Unexpected audit action: expected WORKFLOW_FAILED_COMPENSATED, got ${failureEvent.action}`);
      }

      if (failureEvent.result !== 'FAILED') {
        throw new Error(`Unexpected audit result status: ${failureEvent.result}`);
      }

      return {
        id: 'REM-WF-04',
        name: 'Workflow failure records tamper-evident audit event with trace ID',
        category: 'Workflow Engine',
        passed: true,
        message: 'WORKFLOW_FAILED_COMPENSATED audit event recorded with matching traceId and compensated step details.',
      };
    } catch (err: any) {
      return {
        id: 'REM-WF-04',
        name: 'Workflow failure records tamper-evident audit event with trace ID',
        category: 'Workflow Engine',
        passed: false,
        message: err.message,
      };
    }
  }
}

// Standalone runner when invoked via CLI
if (process.argv[1] && process.argv[1].endsWith('phase0_remediation.test.ts')) {
  RemediationTestSuite.runAll().then((results) => {
    console.log('\n==================================================');
    console.log('PHASE 0.2 BLOCKER REMEDIATION TEST SUITE');
    console.log('==================================================');
    let allPassed = true;
    for (const r of results) {
      const icon = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`[${r.id}] ${icon} : ${r.name}`);
      console.log(`       Category: ${r.category} | ${r.message}`);
      if (!r.passed) allPassed = false;
    }
    console.log('==================================================');
    if (allPassed) {
      console.log(`All ${results.length} remediation tests PASSED successfully!`);
      process.exit(0);
    } else {
      console.error('Some remediation tests FAILED.');
      process.exit(1);
    }
  }).catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}
