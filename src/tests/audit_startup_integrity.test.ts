/**
 * Startup Audit Chain Integrity Verification Test Suite
 * 
 * SPECIFICATION:
 * Verifies that AuditLogService.initDatabase() enforces a strict fail-closed
 * policy by cryptographically verifying the entire persisted audit chain from
 * genesis through current head BEFORE transitioning to AuditServiceStatus.READY.
 * 
 * Covers mandatory tests TEST 1 through TEST 8:
 * - TEST 1: Fresh empty database initializes to READY (sequence=0, genesis head)
 * - TEST 2: Valid chain (#1, #2, #3) initializes to READY (sequence=3, lastHash=hash(#3))
 * - TEST 3: Tampered hash of existing event halts startup with UNAVAILABLE
 * - TEST 4: Tampered previousHash of existing event halts startup with UNAVAILABLE
 * - TEST 5: Tampered sequence number halts startup with UNAVAILABLE
 * - TEST 6: Modified security-sensitive field halts startup with UNAVAILABLE
 * - TEST 7: Historical corruption with locally valid latest row halts startup with UNAVAILABLE (CRITICAL)
 * - TEST 8: Full recovery after database restoration continues chain at sequence #5 chaining to #4
 */

import {
  AuditLogService,
  AuditAction,
  AuditServiceStatus,
  AuditPersistenceError,
  AuditIntegrityError,
} from '../core/observability/index.ts';
import { Database } from '../core/database/index.ts';
import {
  canonicalizeAuditEventPayload,
  computeAuditEventHash,
} from '../core/audit/canonical.ts';

export interface AuditStartupTestResult {
  testId: string;
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export class AuditStartupIntegrityTestSuite {
  public static runAll(): AuditStartupTestResult[] {
    const results: AuditStartupTestResult[] = [];

    // =========================================================================
    // TEST 1: Fresh Empty Database
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const audit = AuditLogService.resetInstance(memDb);

      const isReady = audit.isReady();
      const status = audit.getStatus();
      const seq = audit.getSequenceNumber();
      const lastHash = audit.getLastHash();
      const lastError = audit.getLastError();

      // Record first event to confirm valid operation from genesis
      const ev1 = audit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      const passed =
        isReady === true &&
        status === AuditServiceStatus.READY &&
        seq === 0 &&
        lastHash === GENESIS_HASH &&
        lastError === null &&
        ev1.sequenceNumber === 1 &&
        ev1.previousHash === GENESIS_HASH;

      results.push({
        testId: 'STARTUP-AUD-01',
        name: 'TEST 1: Fresh empty database initializes to READY (sequence=0, genesis head)',
        passed,
        message: passed
          ? 'Fresh database safely initialized in READY status at sequence 0 with genesis head'
          : `Failed: isReady=${isReady}, status=${status}, seq=${seq}, lastHash=${lastHash}`,
      });
    }

    // =========================================================================
    // TEST 2: Valid Chain (#1, #2, #3)
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      const ev1 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      const ev2 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });

      const ev3 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      // Simulate clean system restart / re-initialization
      const restartedAudit = AuditLogService.resetInstance(memDb);

      const isReady = restartedAudit.isReady();
      const status = restartedAudit.getStatus();
      const seq = restartedAudit.getSequenceNumber();
      const lastHash = restartedAudit.getLastHash();
      const lastError = restartedAudit.getLastError();

      const passed =
        isReady === true &&
        status === AuditServiceStatus.READY &&
        seq === 3 &&
        lastHash === ev3.hash &&
        lastError === null;

      results.push({
        testId: 'STARTUP-AUD-02',
        name: 'TEST 2: Valid chain (#1, #2, #3) startup succeeds in READY status at sequence 3',
        passed,
        message: passed
          ? `Valid chain verified on startup: READY at sequence #3 with head hash ${lastHash.substring(0, 8)}`
          : `Failed: isReady=${isReady}, status=${status}, seq=${seq}, expectedHash=${ev3.hash.substring(0, 8)}, got=${lastHash.substring(0, 8)}`,
      });
    }

    // =========================================================================
    // TEST 3: Tampered Hash of an Existing Event
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      // Directly tamper the stored hash of event #2
      memDb.rawDb
        .prepare(
          "UPDATE audit_events SET hash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE sequence_number = 2"
        )
        .run();

      // Restart / initialize service on tampered database
      const tamperedAudit = AuditLogService.resetInstance(memDb);

      const isUnavailable =
        !tamperedAudit.isReady() &&
        tamperedAudit.getStatus() === AuditServiceStatus.UNAVAILABLE &&
        tamperedAudit.getLastError() instanceof AuditIntegrityError;

      // Attempting to record an audit event MUST fail closed with AuditPersistenceError
      let caughtError: any = null;
      try {
        tamperedAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_UPDATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        caughtError = err;
      }

      const passed =
        isUnavailable &&
        caughtError instanceof AuditPersistenceError;

      results.push({
        testId: 'STARTUP-AUD-03',
        name: 'TEST 3: Tampered hash of existing event halts startup with UNAVAILABLE and blocks record()',
        passed,
        message: passed
          ? 'Startup detected tampered hash: status set to UNAVAILABLE, record() threw AuditPersistenceError'
          : `Failed: isUnavailable=${isUnavailable}, caughtError=${caughtError?.name}`,
      });
    }

    // =========================================================================
    // TEST 4: Tampered previousHash of an Existing Event
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      // Directly tamper previous_hash of event #2
      memDb.rawDb
        .prepare(
          "UPDATE audit_events SET previous_hash = '1111111111111111111111111111111111111111111111111111111111111111' WHERE sequence_number = 2"
        )
        .run();

      const tamperedAudit = AuditLogService.resetInstance(memDb);

      const isUnavailable =
        !tamperedAudit.isReady() &&
        tamperedAudit.getStatus() === AuditServiceStatus.UNAVAILABLE &&
        tamperedAudit.getLastError() instanceof AuditIntegrityError;

      let caughtError: any = null;
      try {
        tamperedAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_UPDATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        caughtError = err;
      }

      const passed = isUnavailable && caughtError instanceof AuditPersistenceError;

      results.push({
        testId: 'STARTUP-AUD-04',
        name: 'TEST 4: Tampered previousHash halts startup with UNAVAILABLE and blocks record()',
        passed,
        message: passed
          ? 'Startup detected broken previousHash link: status set to UNAVAILABLE, record() rejected'
          : `Failed: isUnavailable=${isUnavailable}, caughtError=${caughtError?.name}`,
      });
    }

    // =========================================================================
    // TEST 5: Tampered Sequence Number
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      // Modify sequence number of event #3 to create an invalid sequence gap (#1, #2, #99)
      memDb.rawDb
        .prepare('UPDATE audit_events SET sequence_number = 99 WHERE sequence_number = 3')
        .run();

      const tamperedAudit = AuditLogService.resetInstance(memDb);

      const isUnavailable =
        !tamperedAudit.isReady() &&
        tamperedAudit.getStatus() === AuditServiceStatus.UNAVAILABLE &&
        tamperedAudit.getLastError() instanceof AuditIntegrityError;

      let caughtError: any = null;
      try {
        tamperedAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_UPDATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        caughtError = err;
      }

      const passed = isUnavailable && caughtError instanceof AuditPersistenceError;

      results.push({
        testId: 'STARTUP-AUD-05',
        name: 'TEST 5: Tampered sequence number halts startup with UNAVAILABLE and blocks record()',
        passed,
        message: passed
          ? 'Startup detected sequence gap / inconsistency: status set to UNAVAILABLE, record() rejected'
          : `Failed: isUnavailable=${isUnavailable}, caughtError=${caughtError?.name}`,
      });
    }

    // =========================================================================
    // TEST 6: Modified Security-Sensitive Field
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });
      seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });

      // Tamper action field of event #1
      memDb.rawDb
        .prepare("UPDATE audit_events SET action = 'MALICIOUS_STORE_PURGE' WHERE sequence_number = 1")
        .run();

      const tamperedAudit = AuditLogService.resetInstance(memDb);

      const isUnavailable =
        !tamperedAudit.isReady() &&
        tamperedAudit.getStatus() === AuditServiceStatus.UNAVAILABLE &&
        tamperedAudit.getLastError() instanceof AuditIntegrityError;

      let caughtError: any = null;
      try {
        tamperedAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.USER_LOGIN,
          entityType: 'User',
          entityId: 'usr_owner_1',
        });
      } catch (err: any) {
        caughtError = err;
      }

      const passed = isUnavailable && caughtError instanceof AuditPersistenceError;

      results.push({
        testId: 'STARTUP-AUD-06',
        name: 'TEST 6: Modified security-sensitive field halts startup with UNAVAILABLE and blocks record()',
        passed,
        message: passed
          ? 'Startup detected canonical hash mismatch from modified action field: UNAVAILABLE and record() blocked'
          : `Failed: isUnavailable=${isUnavailable}, caughtError=${caughtError?.name}`,
      });
    }

    // =========================================================================
    // TEST 7: Corrupted Historical Event but Latest Row Appears Valid (CRITICAL)
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      const ev1 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      const ev2 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });

      const ev3 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      const ev4 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      // Adversary scenario:
      // An adversary modifies historical event #3 (e.g. changes actor_id to attacker).
      // Event #4 references event #3's stored hash and row #4 internally matches its own hash.
      // A naive startup that only reads getLatestAuditEvent() would see row #4 and declare READY.
      // Full chain verification from genesis must catch the historical corruption at row #3.
      memDb.rawDb
        .prepare("UPDATE audit_events SET actor_id = 'attacker_covert_id' WHERE sequence_number = 3")
        .run();

      // Verify that row #4 locally still has its stored hash matching its payload
      const row4 = memDb.rawDb
        .prepare('SELECT * FROM audit_events WHERE sequence_number = 4')
        .get() as any;
      const row3 = memDb.rawDb
        .prepare('SELECT * FROM audit_events WHERE sequence_number = 3')
        .get() as any;

      const row4LocallyChainsToRow3 = row4.previous_hash === row3.hash;

      // Start / init service
      const startupAudit = AuditLogService.resetInstance(memDb);

      const isUnavailable =
        !startupAudit.isReady() &&
        startupAudit.getStatus() === AuditServiceStatus.UNAVAILABLE &&
        startupAudit.getLastError() instanceof AuditIntegrityError;

      const errorMessage = startupAudit.getLastError()?.message || '';
      const detectedAtRow3 = errorMessage.includes('Event #3 tampered record');

      let caughtError: any = null;
      try {
        startupAudit.record({
          tenantId: 'tenant_albaraka',
          actorId: 'usr_owner_1',
          actorRole: 'MERCHANT_OWNER',
          action: AuditAction.STORE_UPDATED,
          entityType: 'Store',
          entityId: 'store_albaraka',
        });
      } catch (err: any) {
        caughtError = err;
      }

      const passed =
        row4LocallyChainsToRow3 &&
        isUnavailable &&
        detectedAtRow3 &&
        caughtError instanceof AuditPersistenceError;

      results.push({
        testId: 'STARTUP-AUD-07',
        name: 'TEST 7: Historical corruption (#3 tampered, #4 valid head) detected and halts startup',
        passed,
        message: passed
          ? 'Full chain genesis-to-head verification caught historical corruption at row #3 even though latest row appeared valid'
          : `Failed: locallyChained=${row4LocallyChainsToRow3}, isUnavailable=${isUnavailable}, detectedAtRow3=${detectedAtRow3}, err=${errorMessage}`,
      });
    }

    // =========================================================================
    // TEST 8: Full Recovery After Restoring Valid Chain
    // =========================================================================
    {
      const memDb = Database.createInMemory();
      const seedAudit = AuditLogService.resetInstance(memDb);

      const ev1 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      const ev2 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'settings_albaraka',
      });

      const ev3 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      const ev4 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: 'store_albaraka',
      });

      // 1. Break the chain at event #3
      memDb.rawDb
        .prepare("UPDATE audit_events SET actor_id = 'attacker_unauthorized' WHERE sequence_number = 3")
        .run();

      // Init should fail
      seedAudit.initDatabase(memDb);
      const wasUnavailable = !seedAudit.isReady();

      // 2. Restore database to valid state: restore original actor_id
      memDb.rawDb
        .prepare("UPDATE audit_events SET actor_id = 'usr_owner_1' WHERE sequence_number = 3")
        .run();

      // Init again after database is restored
      seedAudit.initDatabase(memDb);
      const isRecovered = seedAudit.isReady() && seedAudit.getStatus() === AuditServiceStatus.READY;
      const headSeq = seedAudit.getSequenceNumber();
      const headHash = seedAudit.getLastHash();

      // 3. Record next event - MUST become sequence #5 and reference event #4's hash
      const ev5 = seedAudit.record({
        tenantId: 'tenant_albaraka',
        actorId: 'usr_owner_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.USER_LOGIN,
        entityType: 'User',
        entityId: 'usr_owner_1',
      });

      const postRecoveryIntegrity = seedAudit.verifyIntegrity(memDb);

      const passed =
        wasUnavailable &&
        isRecovered &&
        headSeq === 4 &&
        headHash === ev4.hash &&
        ev5.sequenceNumber === 5 &&
        ev5.previousHash === ev4.hash &&
        postRecoveryIntegrity.valid === true &&
        postRecoveryIntegrity.verifiedCount === 5;

      results.push({
        testId: 'STARTUP-AUD-08',
        name: 'TEST 8: Recovery: After restoring valid chain (#1..#4), restart enters READY and extends chain at #5 referencing #4',
        passed,
        message: passed
          ? `Service safely recovered: resumed at sequence #5 chaining to head hash ${ev4.hash.substring(0, 8)}, full 5-event chain valid`
          : `Failed: wasUnavailable=${wasUnavailable}, isRecovered=${isRecovered}, headSeq=${headSeq}, ev5Seq=${ev5?.sequenceNumber}, postValid=${postRecoveryIntegrity.valid}`,
      });
    }

    return results;
  }
}

// Standalone CLI execution
if (process.argv[1] && process.argv[1].endsWith('audit_startup_integrity.test.ts')) {
  console.log('==================================================');
  console.log('SOODA STARTUP AUDIT CHAIN INTEGRITY TEST SUITE');
  console.log('==================================================');

  const results = AuditStartupIntegrityTestSuite.runAll();
  let allPassed = true;

  for (const r of results) {
    const symbol = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${r.testId}] ${symbol} : ${r.name}`);
    console.log(`       ${r.message}`);
    if (!r.passed) {
      allPassed = false;
      if (r.details) {
        console.error('       Details:', JSON.stringify(r.details, null, 2));
      }
    }
  }

  console.log('==================================================');
  if (allPassed) {
    console.log(`All ${results.length} startup audit integrity tests PASSED!`);
    process.exit(0);
  } else {
    console.error('Some startup audit integrity tests FAILED.');
    process.exit(1);
  }
}
