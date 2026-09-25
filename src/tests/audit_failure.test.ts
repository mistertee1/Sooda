/**
 * Automated Test Suite: Audit Persistence Failure & Atomicity Policy
 * 
 * Tests the failure boundary of AuditLogService & Database Persistence:
 * 1. Database persistence failure occurs at the boundary.
 * 2. Failure is detected and raises AuditPersistenceError.
 * 3. System refuses to silently report successful persistence.
 * 4. Authoritative in-memory state (sequence counter, head hash) does not advance.
 * 5. A later successful audit remains consistent, seamlessly chaining from the last valid event.
 * 6. Cryptographic chain integrity verification passes with zero gaps or corruption.
 * 7. Business services abort operations when audit persistence fails (fail-closed).
 */

import { Database } from '../core/database/index.ts';
import {
  AuditLogService,
  AuditAction,
  AuditPersistenceError,
  AuditServiceStatus,
  registerAuditDatabaseProvider,
  clearAuditDatabaseProvider,
} from '../core/observability/index.ts';
import { TenantSettingsService } from '../core/services/index.ts';
import { SystemRole, AccountStatus } from '../core/domain/index.ts';
import { type AuthenticatedPrincipal, AuthenticationService, SessionService } from '../core/auth/index.ts';

interface FailureTestResult {
  testId: string;
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

export class AuditFailureTestSuite {
  public static async runAll(): Promise<FailureTestResult[]> {
    const results: FailureTestResult[] = [];

    // =========================================================================
    // TEST 1: Baseline Audit Event Recording
    // =========================================================================
    const db = Database.createInMemory();
    const audit = AuditLogService.resetInstance(db);

    let event1: any;
    try {
      event1 = audit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
        resource: 'Store:store_albaraka',
        result: 'SUCCESS',
      });

      const dbLatest = db.getLatestAuditEvent();
      const passed =
        event1.sequenceNumber === 1 &&
        audit.getSequenceNumber() === 1 &&
        dbLatest?.sequenceNumber === 1 &&
        dbLatest?.hash === event1.hash;

      results.push({
        testId: 'FAIL-01',
        name: 'Baseline audit recording commits to both memory and database',
        passed,
        message: passed
          ? 'Event #1 recorded with valid sequence and hash in memory and DB'
          : 'Failed baseline audit recording',
      });
    } catch (err: any) {
      results.push({
        testId: 'FAIL-01',
        name: 'Baseline audit recording commits to both memory and database',
        passed: false,
        message: `Unexpected error during baseline recording: ${err.message}`,
      });
    }

    const baselineHash = event1?.hash;

    // =========================================================================
    // TEST 2 & 3: Database Persistence Failure is Detected & Raises AuditPersistenceError
    // =========================================================================
    const originalInsert = db.insertAuditEvent.bind(db);
    let errorCaught: any = null;

    try {
      // Induce a realistic database I/O error at the persistence boundary
      db.insertAuditEvent = () => {
        throw new Error('SQLITE_IOERR_WRITE: disk I/O failure during audit event insert');
      };

      audit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'tenant_albaraka',
        resource: 'StoreSettings:tenant_albaraka',
        result: 'SUCCESS',
      });
    } catch (err: any) {
      errorCaught = err;
    }

    {
      const isAuditPersistenceError = errorCaught instanceof AuditPersistenceError;
      const errorCodeCorrect = errorCaught?.code === 'AUDIT_PERSISTENCE_FAILED';
      const notSwallowed = errorCaught !== null;
      const passed = notSwallowed && isAuditPersistenceError && errorCodeCorrect;

      results.push({
        testId: 'FAIL-02',
        name: 'Database persistence failure throws AuditPersistenceError and is NOT silently swallowed',
        passed,
        message: passed
          ? 'Persistence failure properly intercepted and observable via AuditPersistenceError'
          : `Audit error was swallowed or had wrong type: ${errorCaught?.name} (${errorCaught?.message})`,
      });
    }

    // =========================================================================
    // TEST 4: Authoritative In-Memory State Does NOT Advance (Atomicity)
    // =========================================================================
    {
      const currentSeq = audit.getSequenceNumber();
      const currentHash = audit.getLastHash();
      const memoryEvents = audit.getRecent(10);
      const dbLatest = db.getLatestAuditEvent();

      const passed =
        currentSeq === 1 &&
        currentHash === baselineHash &&
        memoryEvents.length === 1 &&
        memoryEvents[0].sequenceNumber === 1 &&
        dbLatest?.sequenceNumber === 1;

      results.push({
        testId: 'FAIL-03',
        name: 'In-memory state (sequence counter, head hash, cache) does NOT advance on persistence failure',
        passed,
        message: passed
          ? `Sequence counter remained at ${currentSeq} and hash remained unchanged at baseline`
          : `State was corrupted: sequenceCounter=${currentSeq}, memoryEvents=${memoryEvents.length}`,
      });
    }

    // =========================================================================
    // TEST 5: System Recovers Seamlessly When Persistence is Restored
    // =========================================================================
    let event2: any;
    try {
      // Restore legitimate database persistence
      db.insertAuditEvent = originalInsert;

      event2 = audit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'tenant_albaraka',
        resource: 'StoreSettings:tenant_albaraka',
        result: 'SUCCESS',
      });

      const passed =
        event2.sequenceNumber === 2 &&
        event2.previousHash === baselineHash &&
        audit.getSequenceNumber() === 2 &&
        audit.getLastHash() === event2.hash;

      results.push({
        testId: 'FAIL-04',
        name: 'Subsequent audit event chains directly to last persisted event (no phantom gaps)',
        passed,
        message: passed
          ? `Event #2 chained directly to previousHash ${baselineHash.substring(0, 8)} with sequence 2`
          : `Event #2 failed to chain properly: seq=${event2?.sequenceNumber}, prevHash=${event2?.previousHash?.substring(0, 8)}`,
      });
    } catch (err: any) {
      results.push({
        testId: 'FAIL-04',
        name: 'Subsequent audit event chains directly to last persisted event',
        passed: false,
        message: `Failed subsequent recording: ${err.message}`,
      });
    }

    // =========================================================================
    // TEST 6: Cryptographic Chain Integrity Verification
    // =========================================================================
    {
      const integrity = audit.verifyIntegrity();
      const passed = integrity.valid && integrity.errors.length === 0 && integrity.verifiedCount === 2;

      results.push({
        testId: 'FAIL-05',
        name: 'Cryptographic hash chain is valid from genesis to head with zero corruption',
        passed,
        message: passed
          ? `Chain verified valid across ${integrity.verifiedCount} events with 0 errors`
          : `Chain verification failed: ${integrity.errors.join('; ')}`,
      });
    }

    // =========================================================================
    // TEST 7: Table Corruption / DDL Failure Mode
    // =========================================================================
    {
      let ddlErrorCaught: any = null;
      try {
        // Break table schema to test DDL-level constraint failure
        db.rawDb.exec('ALTER TABLE audit_events RENAME TO audit_events_backup;');

        audit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_UPDATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        ddlErrorCaught = err;
      }

      // Restore table
      db.rawDb.exec('ALTER TABLE audit_events_backup RENAME TO audit_events;');

      const passed =
        ddlErrorCaught instanceof AuditPersistenceError &&
        audit.getSequenceNumber() === 2 &&
        audit.getLastHash() === event2.hash;

      results.push({
        testId: 'FAIL-06',
        name: 'Underlying SQLite table unavailability triggers fail-closed error with state preserved',
        passed,
        message: passed
          ? 'Table drop correctly threw AuditPersistenceError without advancing sequence'
          : `Expected AuditPersistenceError, got: ${ddlErrorCaught?.name}`,
      });
    }

    // =========================================================================
    // TEST 8: Business Service Aborts When Audit Fails (Fail-Closed Service Policy)
    // =========================================================================
    {
      const testDb = Database.createInMemory();
      AuditLogService.resetInstance(testDb);
      const service = new TenantSettingsService(testDb);

      const principal: AuthenticatedPrincipal = {
        id: 'usr_albaraka_owner',
        email: 'owner@albaraka.sd',
        role: SystemRole.MERCHANT_OWNER,
        status: AccountStatus.ACTIVE,
        tenantId: 'tenant_store_albaraka',
        fullName: 'Test Owner',
        memberships: [
          {
            id: 'mem_test_owner',
            userId: 'usr_albaraka_owner',
            tenantId: 'tenant_store_albaraka',
            role: SystemRole.MERCHANT_OWNER,
            status: AccountStatus.ACTIVE,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };

      // Induce audit failure
      testDb.insertAuditEvent = () => {
        throw new Error('Database disk full');
      };

      let serviceError: any = null;
      try {
        // Run updateSettings which calls auditLog.record()
        await service.updateSettings('tenant_store_albaraka', { contactPhone: '+249912345678' }, principal);
      } catch (err: any) {
        serviceError = err;
      }

      const passed = serviceError instanceof AuditPersistenceError;

      results.push({
        testId: 'FAIL-07',
        name: 'Business service aborts operation when audit persistence fails (fail-closed)',
        passed,
        message: passed
          ? 'Service operation correctly aborted due to audit persistence failure'
          : `Service did not abort with AuditPersistenceError: ${serviceError?.name} (${serviceError?.message})`,
      });
    }

    // =========================================================================
    // TEST A: No Available Database Provider
    // =========================================================================
    {
      clearAuditDatabaseProvider();
      const noDbAudit = AuditLogService.resetInstance(undefined);

      let caughtErr: any = null;
      try {
        noDbAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_CREATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        caughtErr = err;
      }

      const passed =
        caughtErr instanceof AuditPersistenceError &&
        noDbAudit.getSequenceNumber() === 0 &&
        noDbAudit.getLastHash() === '0000000000000000000000000000000000000000000000000000000000000000' &&
        noDbAudit.getRecent().length === 0;

      results.push({
        testId: 'FAIL-08-TEST-A',
        name: 'No database: audit.record() throws AuditPersistenceError and preserves 0/GENESIS/0 state',
        passed,
        message: passed
          ? 'AuditPersistenceError thrown and no in-memory events committed when database is absent'
          : `Failed: err=${caughtErr?.name}, seq=${noDbAudit.getSequenceNumber()}, events=${noDbAudit.getRecent().length}`,
      });
    }

    // =========================================================================
    // TEST B: Database Provider Returns Null
    // =========================================================================
    {
      registerAuditDatabaseProvider(() => null);
      const nullDbAudit = AuditLogService.resetInstance(undefined);

      const seqBefore = nullDbAudit.getSequenceNumber();
      const hashBefore = nullDbAudit.getLastHash();
      const eventsBefore = nullDbAudit.getRecent().length;

      let caughtErr: any = null;
      try {
        nullDbAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_CREATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        caughtErr = err;
      }

      const passed =
        caughtErr instanceof AuditPersistenceError &&
        nullDbAudit.getSequenceNumber() === seqBefore &&
        nullDbAudit.getLastHash() === hashBefore &&
        nullDbAudit.getRecent().length === eventsBefore;

      results.push({
        testId: 'FAIL-09-TEST-B',
        name: 'Database provider returning null: throws AuditPersistenceError with authoritative memory state unchanged',
        passed,
        message: passed
          ? 'AuditPersistenceError thrown and memory state unchanged when provider returns null'
          : `Failed: err=${caughtErr?.name}, seq=${nullDbAudit.getSequenceNumber()}`,
      });
    }

    // =========================================================================
    // TEST C: Database Initialization Failure Must Fail Closed
    // =========================================================================
    {
      const failingDb = Database.createInMemory();
      failingDb.getLatestAuditEvent = () => {
        throw new Error('Disk I/O error reading latest audit record');
      };

      const failingInitAudit = AuditLogService.resetInstance(failingDb);

      // Verify initialization failure is NOT silently converted into a healthy genesis state
      const notHealthyGenesis =
        !failingInitAudit.isReady() &&
        failingInitAudit.getStatus() === AuditServiceStatus.UNAVAILABLE &&
        failingInitAudit.getLastError() !== null;

      let recordError: any = null;
      try {
        failingInitAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_CREATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        recordError = err;
      }

      const passed =
        notHealthyGenesis &&
        recordError instanceof AuditPersistenceError &&
        failingInitAudit.getRecent().length === 0;

      results.push({
        testId: 'FAIL-10-TEST-C',
        name: 'Database initialization failure fails closed and blocks audit recording',
        passed,
        message: passed
          ? 'Initialization failure preserved as UNAVAILABLE, not converted to healthy genesis, and record blocked with AuditPersistenceError'
          : `Failed: notHealthyGenesis=${notHealthyGenesis}, recordError=${recordError?.name}`,
      });
    }

    // =========================================================================
    // TEST D: Recovery from Failure
    // =========================================================================
    {
      const recoveryDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(recoveryDb);
      const seedEvent = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      // Break DB temporarily
      const originalGetLatest = recoveryDb.getLatestAuditEvent.bind(recoveryDb);
      recoveryDb.getLatestAuditEvent = () => {
        throw new Error('Temporary table lock');
      };
      seedAudit.initDatabase(recoveryDb);
      const wasUnavailable = !seedAudit.isReady();

      // Database becomes healthy again
      recoveryDb.getLatestAuditEvent = originalGetLatest;
      seedAudit.initDatabase(recoveryDb);
      const isRecovered = seedAudit.isReady();

      // Record valid event
      const recoveredEvent = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      const integrity = seedAudit.verifyIntegrity(recoveryDb);

      const passed =
        wasUnavailable &&
        isRecovered &&
        recoveredEvent.sequenceNumber === 2 &&
        recoveredEvent.previousHash === seedEvent.hash &&
        integrity.valid === true &&
        integrity.verifiedCount === 2;

      results.push({
        testId: 'FAIL-11-TEST-D',
        name: 'Audit service recovers seamlessly once database is restored, with unbroken cryptographic chain',
        passed,
        message: passed
          ? `Recovered at sequence #${recoveredEvent.sequenceNumber} chaining to head hash ${recoveredEvent.previousHash.substring(0, 8)}, chain verified`
          : `Failed: wasUnavailable=${wasUnavailable}, isRecovered=${isRecovered}, seq=${recoveredEvent.sequenceNumber}, chainValid=${integrity.valid}`,
      });
    }

    // =========================================================================
    // TEST E: Existing Database Must Never Reset to Genesis on Read Failure
    // =========================================================================
    {
      const durableDb = Database.createInMemory();
      const auditService = AuditLogService.resetInstance(durableDb);

      // Create database state: event #1 and event #2
      const ev1 = auditService.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });
      const ev2 = auditService.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'tenant_albaraka',
      });

      // Simulate a temporary database read failure
      const originalGetLatest = durableDb.getLatestAuditEvent.bind(durableDb);
      durableDb.getLatestAuditEvent = () => {
        throw new Error('Temporary database disk timeout');
      };

      // Reconnect/re-init during read failure
      auditService.initDatabase(durableDb);

      // System MUST NOT behave as though sequence = 0, previousHash = GENESIS
      const didNotResetToGenesis =
        auditService.getSequenceNumber() === 2 &&
        auditService.getLastHash() === ev2.hash &&
        !auditService.isReady();

      // Database recovers
      durableDb.getLatestAuditEvent = originalGetLatest;
      auditService.initDatabase(durableDb);

      // After recovery, it must continue from sequence = 2, previousHash = hash(event #2)
      const continuesFromEv2Head =
        auditService.isReady() &&
        auditService.getSequenceNumber() === 2 &&
        auditService.getLastHash() === ev2.hash;

      const ev3 = auditService.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      const integrity = auditService.verifyIntegrity(durableDb);

      const passed =
        didNotResetToGenesis &&
        continuesFromEv2Head &&
        ev3.sequenceNumber === 3 &&
        ev3.previousHash === ev2.hash &&
        integrity.valid === true &&
        integrity.verifiedCount === 3;

      results.push({
        testId: 'FAIL-12-TEST-E',
        name: 'Existing database never resets to genesis on read failure and resumes continuous cryptographic chain',
        passed,
        message: passed
          ? `Read failure did not wipe to genesis; resumed at sequence #${ev3.sequenceNumber} chaining from event #2 with verified integrity`
          : `Failed: didNotReset=${didNotResetToGenesis}, continuesFromEv2=${continuesFromEv2Head}, seq3=${ev3.sequenceNumber}`,
      });
    }

    // =========================================================================
    // NEGATIVE INTEGRATION TESTS (Tests A-E) USING AuditLogService.setFailureSimulator
    // =========================================================================

    // -------------------------------------------------------------------------
    // TEST A: Injected Audit Failure on SESSION_CREATED Aborts Login and Rolls Back Session
    // -------------------------------------------------------------------------
    {
      const authDb = Database.createInMemory();
      const authAudit = AuditLogService.resetInstance(authDb);
      const sessionService = new SessionService(authDb, authAudit);
      const authService = new AuthenticationService(authDb, sessionService, authAudit);

      const user = authDb.getUserByEmail('admin@sooda.sd')!;
      const initialAuditSeq = authAudit.getSequenceNumber();
      const initialAuditHash = authAudit.getLastHash();

      // Configure simulator to fail on SESSION_CREATED
      authAudit.setFailureSimulator((action) =>
        action === AuditAction.SESSION_CREATED
          ? new Error('SIMULATED_FAILURE: Disk I/O error during SESSION_CREATED persistence')
          : null
      );

      let caughtErr: any = null;
      try {
        await authService.authenticate({
          email: 'admin@sooda.sd',
          password: 'AdminPassword#2026',
        });
      } catch (err) {
        caughtErr = err;
      }

      // 1. Must fail closed with AuditPersistenceError
      const isAuditPersistenceError = caughtErr instanceof AuditPersistenceError;
      // 2. Transaction must have rolled back: sessions table has 0 sessions for this user
      const userSessions = authDb.getSessionsForUser(user.id);
      const sessionRolledBack = userSessions.length === 0;
      // 3. In-memory audit state must match database (not advance)
      const auditStateConsistent =
        authAudit.getSequenceNumber() === initialAuditSeq &&
        authAudit.getLastHash() === initialAuditHash;

      const passed = isAuditPersistenceError && sessionRolledBack && auditStateConsistent;

      results.push({
        testId: 'FAIL-SIM-A',
        name: 'Simulated audit failure on SESSION_CREATED aborts login, rolls back session creation, and preserves head state',
        passed,
        message: passed
          ? 'Transaction rolled back: session not created in DB, AuditPersistenceError thrown, audit state uncorrupted'
          : `Failed: isErr=${isAuditPersistenceError}, sessionsCount=${userSessions.length}, seq=${authAudit.getSequenceNumber()}`,
      });

      authAudit.setFailureSimulator(null);
    }

    // -------------------------------------------------------------------------
    // TEST B: Injected Audit Failure on LOGIN_SUCCESS Rolls Back Entire Login Transaction
    // -------------------------------------------------------------------------
    {
      const authDb = Database.createInMemory();
      const authAudit = AuditLogService.resetInstance(authDb);
      const sessionService = new SessionService(authDb, authAudit);
      const authService = new AuthenticationService(authDb, sessionService, authAudit);

      const user = authDb.getUserByEmail('admin@sooda.sd')!;
      const initialAuditSeq = authAudit.getSequenceNumber();

      // Configure simulator to fail on LOGIN_SUCCESS (which occurs after session creation in the transaction)
      authAudit.setFailureSimulator((action) =>
        action === AuditAction.LOGIN_SUCCESS
          ? new Error('SIMULATED_FAILURE: Disk error during LOGIN_SUCCESS')
          : null
      );

      let caughtErr: any = null;
      try {
        await authService.authenticate({
          email: 'admin@sooda.sd',
          password: 'AdminPassword#2026',
        });
      } catch (err) {
        caughtErr = err;
      }

      const isAuditPersistenceError = caughtErr instanceof AuditPersistenceError;
      // Session creation must have been rolled back despite occurring before LOGIN_SUCCESS in code!
      const userSessions = authDb.getSessionsForUser(user.id);
      const sessionRolledBack = userSessions.length === 0;
      const auditStateConsistent = authAudit.getSequenceNumber() === initialAuditSeq;

      const passed = isAuditPersistenceError && sessionRolledBack && auditStateConsistent;

      results.push({
        testId: 'FAIL-SIM-B',
        name: 'Simulated audit failure on LOGIN_SUCCESS rolls back both session creation and user state atomically',
        passed,
        message: passed
          ? 'Atomic rollback verified: session created earlier in transaction was reverted cleanly on LOGIN_SUCCESS failure'
          : `Failed: isErr=${isAuditPersistenceError}, sessionsCount=${userSessions.length}, seq=${authAudit.getSequenceNumber()}`,
      });

      authAudit.setFailureSimulator(null);
    }

    // -------------------------------------------------------------------------
    // TEST C: Injected Audit Failure on LOGIN_FAILURE Fails Closed
    // -------------------------------------------------------------------------
    {
      const authDb = Database.createInMemory();
      const authAudit = AuditLogService.resetInstance(authDb);
      const sessionService = new SessionService(authDb, authAudit);
      const authService = new AuthenticationService(authDb, sessionService, authAudit);

      authAudit.setFailureSimulator((action) =>
        action === AuditAction.LOGIN_FAILURE
          ? new Error('SIMULATED_FAILURE: Audit log storage full on LOGIN_FAILURE')
          : null
      );

      let caughtErr: any = null;
      try {
        await authService.authenticate({
          email: 'admin@sooda.sd',
          password: 'IncorrectPassword!',
        });
      } catch (err) {
        caughtErr = err;
      }

      const passed = caughtErr instanceof AuditPersistenceError;

      results.push({
        testId: 'FAIL-SIM-C',
        name: 'Simulated audit failure on LOGIN_FAILURE fails closed with AuditPersistenceError (not masked as 401)',
        passed,
        message: passed
          ? 'System failed closed on audit persistence failure during bad credentials attempt'
          : `Failed: err=${caughtErr?.name} (${caughtErr?.message})`,
      });

      authAudit.setFailureSimulator(null);
    }

    // -------------------------------------------------------------------------
    // TEST D: Injected Audit Failure on ACCOUNT_LOCKED Fails Closed
    // -------------------------------------------------------------------------
    {
      const authDb = Database.createInMemory();
      const authAudit = AuditLogService.resetInstance(authDb);
      const sessionService = new SessionService(authDb, authAudit);
      const authService = new AuthenticationService(authDb, sessionService, authAudit);

      const user = authDb.getUserByEmail('admin@sooda.sd')!;
      // Lock user
      authDb.lockUser(user.id, new Date(Date.now() + 15 * 60 * 1000).toISOString());

      authAudit.setFailureSimulator((action) =>
        action === AuditAction.ACCOUNT_LOCKED
          ? new Error('SIMULATED_FAILURE: Storage unavailable on ACCOUNT_LOCKED')
          : null
      );

      let caughtErr: any = null;
      try {
        await authService.authenticate({
          email: 'admin@sooda.sd',
          password: 'AdminPassword#2026',
        });
      } catch (err) {
        caughtErr = err;
      }

      const passed = caughtErr instanceof AuditPersistenceError;

      results.push({
        testId: 'FAIL-SIM-D',
        name: 'Simulated audit failure on ACCOUNT_LOCKED fails closed with AuditPersistenceError',
        passed,
        message: passed
          ? 'Audit failure during locked account detection halted operation with AuditPersistenceError'
          : `Failed: err=${caughtErr?.name}`,
      });

      authAudit.setFailureSimulator(null);
    }

    // -------------------------------------------------------------------------
    // TEST E: Injected Failure on SESSION_REVOKED Rollback & Full Post-Failure Recovery
    // -------------------------------------------------------------------------
    {
      const authDb = Database.createInMemory();
      const authAudit = AuditLogService.resetInstance(authDb);
      const sessionService = new SessionService(authDb, authAudit);
      const authService = new AuthenticationService(authDb, sessionService, authAudit);

      // 1. Legitimate successful login while simulator is inactive
      const authResult = await authService.authenticate({
        email: 'admin@sooda.sd',
        password: 'AdminPassword#2026',
      });

      const validationBefore = sessionService.validateSession(authResult.rawToken);
      const validBeforeRevoke = validationBefore.valid === true;

      // 2. Simulate failure during SESSION_REVOKED
      authAudit.setFailureSimulator((action) =>
        action === AuditAction.SESSION_REVOKED
          ? new Error('SIMULATED_FAILURE: Storage timeout during SESSION_REVOKED')
          : null
      );

      let revokeErr: any = null;
      try {
        sessionService.revokeSessionByToken(authResult.rawToken);
      } catch (err) {
        revokeErr = err;
      }

      // Revocation must have failed closed and transactionally rolled back
      const revokeThrewAuditErr = revokeErr instanceof AuditPersistenceError;
      const validationDuringFailure = sessionService.validateSession(authResult.rawToken);
      const sessionStillValid = validationDuringFailure.valid === true;

      // 3. Clear failure simulator and perform clean operations
      authAudit.setFailureSimulator(null);

      // Successfully revoke session
      const revokeSuccess = sessionService.revokeSessionByToken(authResult.rawToken);
      const validationAfterRevoke = sessionService.validateSession(authResult.rawToken);
      const sessionRevoked = validationAfterRevoke.valid === false;

      // New authentication cycle
      const secondAuth = await authService.authenticate({
        email: 'admin@sooda.sd',
        password: 'AdminPassword#2026',
      });
      const secondSessionValid = sessionService.validateSession(secondAuth.rawToken).valid === true;

      // Verify unbroken cryptographic audit chain integrity across all failed and successful attempts
      const integrity = authAudit.verifyIntegrity(authDb);
      const chainValid = integrity.valid === true && integrity.errors.length === 0;

      const passed =
        validBeforeRevoke &&
        revokeThrewAuditErr &&
        sessionStillValid &&
        revokeSuccess &&
        sessionRevoked &&
        secondSessionValid &&
        chainValid;

      results.push({
        testId: 'FAIL-SIM-E',
        name: 'Simulated revocation failure rolls back, and system fully recovers with unbroken cryptographic audit chain',
        passed,
        message: passed
          ? `Revocation failure rolled back; recovered cleanly, verified chain across ${integrity.verifiedCount} events with 0 errors`
          : `Failed: validBefore=${validBeforeRevoke}, threwErr=${revokeThrewAuditErr}, stillValid=${sessionStillValid}, revoked=${sessionRevoked}, chainValid=${chainValid}`,
      });
    }

    // Restore clean singleton state for any following suites
    const finalCleanDb = Database.createInMemory();
    registerAuditDatabaseProvider(() => finalCleanDb);
    AuditLogService.resetInstance(finalCleanDb);

    return results;
  }
}

// Standalone CLI runner
if (process.argv[1] && process.argv[1].endsWith('audit_failure.test.ts')) {
  console.log('\n==================================================');
  console.log('SOODA AUDIT FAILURE & ATOMICITY TEST SUITE');
  console.log('==================================================');

  AuditFailureTestSuite.runAll().then((results) => {
    let allPassed = true;

    for (const r of results) {
      const icon = r.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`[${r.testId}] ${icon} : ${r.name}`);
      console.log(`       ${r.message}`);
      if (!r.passed) allPassed = false;
    }

    console.log('==================================================');
    if (allPassed) {
      console.log(`All ${results.length} audit failure & atomicity tests PASSED!`);
      process.exit(0);
    } else {
      console.error('One or more audit failure tests FAILED!');
      process.exit(1);
    }
  });
}
