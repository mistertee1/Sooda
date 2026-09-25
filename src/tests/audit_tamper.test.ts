/**
 * Audit Tamper and Cryptographic Integrity Test Suite
 * 
 * Tests the canonical audit payload generation, SHA-256 hash chaining,
 * and tamper detection under adversarial mutations.
 */

import { AuditLogService, AuditAction, IAuditDatabase } from '../core/observability/index.ts';
import { Database } from '../core/database/index.ts';
import {
  canonicalizeValue,
  canonicalizeAuditEventPayload,
  computeAuditEventHash,
} from '../core/audit/canonical.ts';

export interface AuditTamperTestResult {
  testId: string;
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

export class AuditTamperTestSuite {
  private static testFieldTamper(
    testId: string,
    fieldName: string,
    sqlMutation: string
  ): AuditTamperTestResult {
    const memDb = Database.createInMemory();
    const audit = AuditLogService.resetInstance(memDb);

    audit.record({
      tenantId: 'tenant_store_albaraka',
      actorId: 'user_merchant_1',
      actorRole: 'MERCHANT_OWNER',
      action: AuditAction.STORE_UPDATED,
      entityType: 'Store',
      entityId: 'store_1',
      resource: 'Store:store_1',
      result: 'SUCCESS',
      traceId: 'trace_orig_123',
      storeId: 'store_1',
      ipAddress: '192.168.1.50',
      userAgent: 'SoodaBrowser/1.0',
      metadata: { initialKey: 'initialVal' },
    });

    // Verify baseline pristine state
    const baseline = audit.verifyIntegrity();
    if (!baseline.valid || baseline.verifiedCount !== 1) {
      return {
        testId,
        name: `Adversarial mutation of ${fieldName} is detected and fails verification`,
        passed: false,
        message: `Baseline integrity check failed before tamper: ${baseline.errors.join(', ')}`,
      };
    }

    // Adversarial database tamper
    memDb.rawDb.exec(sqlMutation);

    const integrity = audit.verifyIntegrity();
    const passed = integrity.valid === false && integrity.errors.length > 0;
    return {
      testId,
      name: `Adversarial mutation of ${fieldName} is detected and fails verification`,
      passed,
      message: passed
        ? `Mutation of ${fieldName} intercepted: ${integrity.errors[0]}`
        : `Failed to detect mutation of ${fieldName}`,
    };
  }

  public static runAll(): AuditTamperTestResult[] {
    const results: AuditTamperTestResult[] = [];

    // ---------------------------------------------------------
    // TEST 1: Deterministic Canonical Serialization of Metadata
    // ---------------------------------------------------------
    {
      const obj1 = { z: 10, a: 'test', m: { b: 2, a: 1 }, arr: [1, 2, 3] };
      const obj2 = { a: 'test', m: { a: 1, b: 2 }, z: 10, arr: [1, 2, 3] };
      const canon1 = canonicalizeValue(obj1);
      const canon2 = canonicalizeValue(obj2);
      const passed = canon1 === canon2 && canon1.startsWith('{"a":"test","arr":[1,2,3],"m":{"a":1,"b":2},"z":10}');
      results.push({
        testId: 'AUD-T01',
        name: 'Deterministic canonical serialization produces identical strings for unordered keys',
        passed,
        message: passed
          ? 'Canonical JSON value formatting is strictly deterministic and ordered'
          : `Serialization mismatch: ${canon1} !== ${canon2}`,
      });
    }

    // ---------------------------------------------------------
    // TEST 1B: Metadata: Key Reordering Preserves Hash, Value Mutation Changes Hash
    // ---------------------------------------------------------
    {
      const hOrder1 = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { keyZ: 'last', keyA: 'first' },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const hOrder2 = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { keyA: 'first', keyZ: 'last' },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const hValMutated = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { keyA: 'mutated', keyZ: 'last' },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const passed = hOrder1 === hOrder2 && hOrder1 !== hValMutated;
      results.push({
        testId: 'AUD-T01B',
        name: 'Metadata key reordering does not alter hash, but value mutation changes hash',
        passed,
        message: passed
          ? 'Key reordering invariance verified and value sensitivity verified'
          : `Hash invariant failed: hOrder1=${hOrder1}, hOrder2=${hOrder2}, hValMutated=${hValMutated}`,
      });
    }

    // ---------------------------------------------------------
    // TEST 1C: Metadata: Nested Object Mutation Changes Hash
    // ---------------------------------------------------------
    {
      const hNest1 = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { parent: { child: 'alpha', deep: { counter: 10 } } },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const hNest2 = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { parent: { child: 'alpha', deep: { counter: 99 } } },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const passed = hNest1 !== hNest2;
      results.push({
        testId: 'AUD-T01C',
        name: 'Metadata nested object mutation changes cryptographic hash',
        passed,
        message: passed
          ? 'Nested object mutation correctly changes hash'
          : 'Nested object mutation failed to alter hash',
      });
    }

    // ---------------------------------------------------------
    // TEST 1D: Metadata: Array Element Mutation Changes Hash
    // ---------------------------------------------------------
    {
      const hArr1 = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { roles: ['ADMIN', 'MANAGER', 'AUDITOR'] },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const hArr2 = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: { roles: ['ADMIN', 'OPERATOR', 'AUDITOR'] },
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const passed = hArr1 !== hArr2;
      results.push({
        testId: 'AUD-T01D',
        name: 'Metadata array element mutation changes cryptographic hash',
        passed,
        message: passed
          ? 'Array element mutation correctly alters hash'
          : 'Array element mutation failed to alter hash',
      });
    }

    // ---------------------------------------------------------
    // TEST 1E: Metadata: Null vs Empty String Distinguishable
    // ---------------------------------------------------------
    {
      const hNull = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: null,
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const hEmpty = computeAuditEventHash(
        canonicalizeAuditEventPayload(
          {
            sequenceNumber: 1,
            timestamp: '2026-09-13T00:00:00.000Z',
            actorId: 'user_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.STORE_UPDATED,
            entityType: 'Store',
            entityId: 'store_1',
            metadata: '',
          },
          '0000000000000000000000000000000000000000000000000000000000000000'
        )
      );

      const passed = hNull !== hEmpty;
      results.push({
        testId: 'AUD-T01E',
        name: 'Metadata null vs empty string are strictly distinguishable and produce distinct hashes',
        passed,
        message: passed
          ? 'Explicit null and empty string distinctness verified'
          : 'Collision detected between metadata null and empty string',
      });
    }

    // ---------------------------------------------------------
    // TEST 2: Empty Audit Log Behavior
    // ---------------------------------------------------------
    {
      const memDb = Database.createInMemory();
      const audit = AuditLogService.resetInstance(memDb);
      const integrity = audit.verifyIntegrity();
      const passed = integrity.valid === true && integrity.verifiedCount === 0 && integrity.errors.length === 0;
      results.push({
        testId: 'AUD-T02',
        name: 'Empty audit log verifies valid with 0 records',
        passed,
        message: passed ? 'Empty state correctly verified as pristine' : 'Empty verification failed',
      });
    }

    // ---------------------------------------------------------
    // TEST 3: Single Event Audit Log Behavior & Genesis Hash Link
    // ---------------------------------------------------------
    {
      const memDb = Database.createInMemory();
      const audit = AuditLogService.resetInstance(memDb);
      const event = audit.record({
        tenantId: 'tenant_test_1',
        actorId: 'actor_1',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_ACCESSED,
        entityType: 'TenantSettings',
        entityId: 'settings_1',
        metadata: { initial: true },
      });

      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const integrity = audit.verifyIntegrity();
      const passed =
        event.sequenceNumber === 1 &&
        event.previousHash === genesisHash &&
        event.hash.length === 64 &&
        integrity.valid === true &&
        integrity.verifiedCount === 1;

      results.push({
        testId: 'AUD-T03',
        name: 'Single event correctly chains from genesis hash and passes verification',
        passed,
        message: passed ? 'Genesis link and first event verified' : 'Single event verification failed',
      });
    }

    // ---------------------------------------------------------
    // TEST 4: Strictly Monotonic Sequence Numbering
    // ---------------------------------------------------------
    {
      const memDb = Database.createInMemory();
      const audit = AuditLogService.resetInstance(memDb);
      const events = [];
      for (let i = 0; i < 10; i++) {
        events.push(
          audit.record({
            tenantId: 'tenant_store_albaraka',
            actorId: 'user_merchant_1',
            actorRole: 'MERCHANT_OWNER',
            action: AuditAction.TENANT_SETTINGS_UPDATED,
            entityType: 'StoreSettings',
            entityId: `settings_${i}`,
            metadata: { iteration: i },
          })
        );
      }

      const seqs = events.map((e) => e.sequenceNumber);
      const isMonotonic = seqs.every((seq, idx) => seq === idx + 1);
      const integrity = audit.verifyIntegrity();
      const passed = isMonotonic && integrity.valid === true && integrity.verifiedCount === 10;

      results.push({
        testId: 'AUD-T04',
        name: 'Audit sequence numbering is strictly monotonic (1..N)',
        passed,
        message: passed ? 'Monotonic sequence verified across 10 records' : 'Sequence monotonicity violated',
      });
    }

    // ---------------------------------------------------------
    // INDIVIDUAL FIELD MUTATION TAMPER TESTS (ALL 16 FIELDS)
    // ---------------------------------------------------------

    // 1. sequenceNumber
    results.push(
      this.testFieldTamper(
        'AUD-F01',
        'sequenceNumber',
        `UPDATE audit_events SET sequence_number = 999 WHERE id LIKE 'audit_%'`
      )
    );

    // 2. timestamp
    results.push(
      this.testFieldTamper(
        'AUD-F02',
        'timestamp',
        `UPDATE audit_events SET timestamp = '1970-01-01T00:00:00.000Z' WHERE sequence_number = 1`
      )
    );

    // 3. tenantId
    results.push(
      this.testFieldTamper(
        'AUD-F03',
        'tenantId',
        `UPDATE audit_events SET tenant_id = 'tenant_forged_injected' WHERE sequence_number = 1`
      )
    );

    // 4. actorId
    results.push(
      this.testFieldTamper(
        'AUD-F04',
        'actorId',
        `UPDATE audit_events SET actor_id = 'forged_intruder_user' WHERE sequence_number = 1`
      )
    );

    // 5. actorRole
    results.push(
      this.testFieldTamper(
        'AUD-F05',
        'actorRole',
        `UPDATE audit_events SET actor_role = 'PLATFORM_ADMIN' WHERE sequence_number = 1`
      )
    );

    // 6. action
    results.push(
      this.testFieldTamper(
        'AUD-F06',
        'action',
        `UPDATE audit_events SET action = 'USER_PASSWORD_RESET' WHERE sequence_number = 1`
      )
    );

    // 7. entityType
    results.push(
      this.testFieldTamper(
        'AUD-F07',
        'entityType',
        `UPDATE audit_events SET entity_type = 'ForgedEntityType' WHERE sequence_number = 1`
      )
    );

    // 8. entityId
    results.push(
      this.testFieldTamper(
        'AUD-F08',
        'entityId',
        `UPDATE audit_events SET entity_id = 'forged_entity_id_999' WHERE sequence_number = 1`
      )
    );

    // 9. resource
    results.push(
      this.testFieldTamper(
        'AUD-F09',
        'resource',
        `UPDATE audit_events SET resource = 'ForgedResource:999' WHERE sequence_number = 1`
      )
    );

    // 10. result
    results.push(
      this.testFieldTamper(
        'AUD-F10',
        'result',
        `UPDATE audit_events SET result = 'BLOCKED' WHERE sequence_number = 1`
      )
    );

    // 11. traceId
    results.push(
      this.testFieldTamper(
        'AUD-F11',
        'traceId',
        `UPDATE audit_events SET trace_id = 'forged_trace_xyz' WHERE sequence_number = 1`
      )
    );

    // 12. storeId
    results.push(
      this.testFieldTamper(
        'AUD-F12',
        'storeId',
        `UPDATE audit_events SET store_id = 'forged_store_777' WHERE sequence_number = 1`
      )
    );

    // 13. ipAddress
    results.push(
      this.testFieldTamper(
        'AUD-F13',
        'ipAddress',
        `UPDATE audit_events SET ip_address = '10.99.99.99' WHERE sequence_number = 1`
      )
    );

    // 14. userAgent
    results.push(
      this.testFieldTamper(
        'AUD-F14',
        'userAgent',
        `UPDATE audit_events SET user_agent = 'MaliciousBot/9.9' WHERE sequence_number = 1`
      )
    );

    // 15. metadata
    results.push(
      this.testFieldTamper(
        'AUD-F15',
        'metadata',
        `UPDATE audit_events SET metadata = '{"tampered":true,"forged":123}' WHERE sequence_number = 1`
      )
    );

    // 16. previousHash
    results.push(
      this.testFieldTamper(
        'AUD-F16',
        'previousHash',
        `UPDATE audit_events SET previous_hash = '1111111111111111111111111111111111111111111111111111111111111111' WHERE sequence_number = 1`
      )
    );

    // ---------------------------------------------------------
    // TEST 21: Multi-Tenant Interleaved Audit Logs Maintain Single Global Chain
    // ---------------------------------------------------------
    {
      const memDb = Database.createInMemory();
      const audit = AuditLogService.resetInstance(memDb);

      audit.record({
        tenantId: 'tenant_store_albaraka',
        actorId: 'user_albaraka',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: 'albaraka',
      });

      audit.record({
        tenantId: 'tenant_store_nilecrafts',
        actorId: 'user_nilecrafts',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: 'nilecrafts',
      });

      audit.record({
        tenantId: undefined, // Platform level event
        actorId: 'user_platform_admin',
        actorRole: 'PLATFORM_ADMIN',
        action: AuditAction.USER_LOGIN,
        entityType: 'PlatformSession',
        entityId: 'admin_session_1',
      });

      audit.record({
        tenantId: 'tenant_store_albaraka',
        actorId: 'user_albaraka',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: 'albaraka_settings',
      });

      const integrity = audit.verifyIntegrity();
      const passed = integrity.valid === true && integrity.verifiedCount === 4;

      results.push({
        testId: 'AUD-T21',
        name: 'Multi-tenant interleaved events maintain single global cryptographic chain',
        passed,
        message: passed ? 'Interleaved multi-tenant audit chain integrity verified' : 'Multi-tenant chain failed',
      });
    }

    // ---------------------------------------------------------
    // TEST 22: Reconstruction from Persistent Storage Reproduces Identical Chain
    // ---------------------------------------------------------
    {
      const memDb = Database.createInMemory();
      const audit1 = AuditLogService.resetInstance(memDb);

      const e1 = audit1.record({
        tenantId: 'tenant_store_albaraka',
        actorId: 'user_albaraka',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'albaraka',
      });

      const e2 = audit1.record({
        tenantId: 'tenant_store_nilecrafts',
        actorId: 'user_nilecrafts',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_CREATED,
        entityType: 'Store',
        entityId: 'nilecrafts',
      });

      // Simulate application restart: instantiate a new AuditLogService reading from the same DB
      const audit2 = AuditLogService.resetInstance(memDb);
      const integrity = audit2.verifyIntegrity();

      // Record a 3rd event on the reconstructed instance
      const e3 = audit2.record({
        tenantId: 'tenant_store_albaraka',
        actorId: 'user_albaraka',
        actorRole: 'MERCHANT_OWNER',
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: 'albaraka',
      });

      const integrityPostRestart = audit2.verifyIntegrity();

      const passed =
        integrity.valid === true &&
        integrity.verifiedCount === 2 &&
        e3.sequenceNumber === 3 &&
        e3.previousHash === e2.hash &&
        integrityPostRestart.valid === true &&
        integrityPostRestart.verifiedCount === 3;

      results.push({
        testId: 'AUD-T22',
        name: 'Reconstruction from persistent database reproduces identical sequence and head hash',
        passed,
        message: passed
          ? 'Application restart seamlessly resumes monotonic sequence and cryptographic hash chain'
          : 'Reconstruction failed',
      });
    }

    return results;
  }
}

// Standalone CLI runner
if (process.argv[1] && process.argv[1].endsWith('audit_tamper.test.ts')) {
  const results = AuditTamperTestSuite.runAll();
  console.log('\n==================================================');
  console.log('SOODA AUDIT TAMPER & INTEGRITY TEST SUITE');
  console.log('==================================================');
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${r.testId}] ${icon} : ${r.name}`);
    console.log(`       ${r.message}`);
    if (!r.passed) allPassed = false;
  }
  console.log('==================================================');
  if (allPassed) {
    console.log(`All ${results.length} audit tamper & integrity tests PASSED!`);
    process.exit(0);
  } else {
    console.error('One or more audit tests FAILED!');
    process.exit(1);
  }
}
