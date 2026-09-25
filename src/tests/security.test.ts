/**
 * Real HTTP / API Integration & Negative Security Test Suite
 * 
 * Tests the live Express server pipeline against genuine HTTP requests:
 * - Missing Authentication (401)
 * - Unauthorized RBAC Escalation Attempts (403)
 * - Forged Tenant Headers & Cross-Tenant Access Attempts (403 TENANT_MISMATCH)
 * - Legitimate Tenant & Platform Operations (200)
 * - Public Tenant Resolution vs Private Settings Separation
 * - SQL Injection / Malicious Input Sanitization (400)
 * - Modern Security Headers vs Obsolete Mechanisms
 * - Cryptographic Audit Trail Verification
 */

import http from 'node:http';
import { createApp } from '../../server.ts';
import { Database } from '../core/database/index.ts';
import { AuthenticationService } from '../core/auth/index.ts';
import { DEV_TEST_PRINCIPALS_FIXTURE } from './fixtures/test_tokens.ts';

interface HttpTestResult {
  testId: string;
  name: string;
  passed: boolean;
  expectedStatus: number;
  actualStatus: number;
  message: string;
  details?: unknown;
}

export async function runSecurityIntegrationTests(): Promise<HttpTestResult[]> {
  AuthenticationService.registerTestFixtures(DEV_TEST_PRINCIPALS_FIXTURE);
  const { app } = createApp({ db: Database.createInMemory() });
  const server = http.createServer(app);

  // Bind to dynamic ephemeral port
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to retrieve test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const results: HttpTestResult[] = [];

  try {
    // ----------------------------------------------------
    // TEST 1: Missing Authentication -> 401 on Protected Audit
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/audit/recent`);
      const data = await res.json();
      const passed = res.status === 401 && data.error?.code === 'AUTHENTICATION_REQUIRED';
      results.push({
        testId: 'SEC-01',
        name: 'Missing authentication to /api/audit/recent is rejected with 401',
        passed,
        expectedStatus: 401,
        actualStatus: res.status,
        message: passed ? 'Unauthenticated access correctly denied with 401' : 'Failed to deny unauthenticated request',
      });
    }

    // ----------------------------------------------------
    // TEST 2: Missing Authentication -> 401 on RBAC Roles
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/auth/roles`);
      const data = await res.json();
      const passed = res.status === 401;
      results.push({
        testId: 'SEC-02',
        name: 'Missing authentication to /api/auth/roles is rejected with 401',
        passed,
        expectedStatus: 401,
        actualStatus: res.status,
        message: passed ? 'RBAC endpoint correctly protected from anonymous callers' : 'Failed to protect RBAC route',
      });
    }

    // ----------------------------------------------------
    // TEST 3: Privilege Escalation -> 403 Forbidden
    // Merchant Owner attempts to access Platform Admin route
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/auth/roles`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'FORBIDDEN';
      results.push({
        testId: 'SEC-03',
        name: 'Merchant attempting to access Platform Admin route is denied with 403',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Role privilege escalation prevented by server-side gate' : 'Failed to block escalation',
      });
    }

    // ----------------------------------------------------
    // TEST 4: Forged Tenant Header Cross-Tenant Access -> 403 TENANT_MISMATCH
    // Merchant A token requests Tenant B settings via x-tenant-id
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
          'x-tenant-id': 'tenant_store_nilecrafts',
        },
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'TENANT_MISMATCH';
      results.push({
        testId: 'SEC-04',
        name: 'Forged x-tenant-id header is intercepted and denied with 403 TENANT_MISMATCH',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Cross-tenant boundary strictly enforced server-side' : 'Failed to intercept forged tenant ID',
      });
    }

    // ----------------------------------------------------
    // TEST 5: Forged Query Tenant Parameter -> 403 TENANT_MISMATCH
    // Merchant A token requests Tenant B settings via query parameter
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_nilecrafts`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'TENANT_MISMATCH';
      results.push({
        testId: 'SEC-05',
        name: 'Cross-tenant query parameter is intercepted and denied with 403 TENANT_MISMATCH',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Query-based tenant mismatch denied' : 'Failed to deny cross-tenant query',
      });
    }

    // ----------------------------------------------------
    // TEST 6: Legitimate Tenant Access -> 200 OK
    // Merchant A token requests Tenant A settings
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_albaraka`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 200 && data.settings?.tenantId === 'tenant_store_albaraka';
      results.push({
        testId: 'SEC-06',
        name: 'Legitimate merchant access to own tenant settings succeeds with 200 OK',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Authorized tenant data returned correctly' : 'Failed legitimate tenant access',
      });
    }

    // ----------------------------------------------------
    // TEST 7: Platform Admin Tenant Access -> 200 OK
    // Platform Admin token can inspect tenant settings
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_albaraka`, {
        headers: {
          Authorization: 'Bearer token_platform_admin',
        },
      });
      const data = await res.json();
      const passed = res.status === 200 && data.settings?.tenantId === 'tenant_store_albaraka';
      results.push({
        testId: 'SEC-07',
        name: 'Platform admin access to tenant settings succeeds with 200 OK',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Platform admin successfully inspected tenant' : 'Platform admin access failed',
      });
    }

    // ----------------------------------------------------
    // TEST 7B: Cross-Tenant Symmetric Test: Tenant B Accesses Own Resource -> 200 OK ALLOW
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_nilecrafts`, {
        headers: {
          Authorization: 'Bearer token_nilecrafts_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 200 && data.settings?.tenantId === 'tenant_store_nilecrafts';
      results.push({
        testId: 'SEC-07B',
        name: 'Tenant B accesses own settings (resource B) -> 200 OK ALLOW',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Tenant B successfully accessed own store settings' : 'Failed Tenant B self-access',
      });
    }

    // ----------------------------------------------------
    // TEST 7C: Cross-Tenant Symmetric Test: Tenant B Attempts Access to Resource A -> 403 DENY
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_albaraka`, {
        headers: {
          Authorization: 'Bearer token_nilecrafts_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'TENANT_MISMATCH';
      results.push({
        testId: 'SEC-07C',
        name: 'Tenant B attempts to access Tenant A settings (resource A) -> 403 Forbidden DENY',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Cross-tenant access from B to A blocked with TENANT_MISMATCH' : 'Security breach: Cross-tenant access was not blocked',
      });
    }

    // ----------------------------------------------------
    // TEST 7D: Missing Tenant Context -> 400 TENANT_REQUIRED
    // When an authenticated user does not specify target tenant and token has no tenant
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings`, {
        headers: {
          Authorization: 'Bearer token_platform_admin',
        },
      });
      const data = await res.json();
      const passed = res.status === 400 && data.error?.code === 'TENANT_REQUIRED';
      results.push({
        testId: 'SEC-07D',
        name: 'Missing tenant identifier returns 400 Bad Request (TENANT_REQUIRED)',
        passed,
        expectedStatus: 400,
        actualStatus: res.status,
        message: passed ? 'Missing tenant requirement strictly enforced' : 'Failed to require tenant identifier',
      });
    }

    // ----------------------------------------------------
    // TEST 7E: Malformed Tenant Identifier -> 400 INVALID_INPUT
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_albaraka/../../etc/passwd`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 400 && data.error?.code === 'INVALID_INPUT';
      results.push({
        testId: 'SEC-07E',
        name: 'Malformed tenant identifier with path traversal or injection is rejected with 400 INVALID_INPUT',
        passed,
        expectedStatus: 400,
        actualStatus: res.status,
        message: passed ? 'Malformed tenant identifier safely caught and rejected' : 'Failed to reject malformed tenant ID',
      });
    }

    // ----------------------------------------------------
    // TEST 7F: Forged Tenant Header -> 403 TENANT_MISMATCH
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
          'x-tenant-id': 'tenant_store_nilecrafts',
        },
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'TENANT_MISMATCH';
      results.push({
        testId: 'SEC-07F',
        name: 'Forged x-tenant-id header is detected and blocked with 403 TENANT_MISMATCH',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Forged header cross-tenant access blocked successfully' : 'Forged tenant header was not blocked',
      });
    }

    // ----------------------------------------------------
    // TEST 8: Malicious Input Handling in Public Slug -> 400 INVALID_INPUT
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/resolve?slug=' OR '1'='1'`);
      const data = await res.json();
      const passed = res.status === 400 && data.error?.code === 'INVALID_INPUT';
      results.push({
        testId: 'SEC-08',
        name: 'Malicious non-alphanumeric slug input is rejected with 400 Bad Request',
        passed,
        expectedStatus: 400,
        actualStatus: res.status,
        message: passed ? 'Input injection payload safely caught and rejected' : 'Failed to sanitize input',
      });
    }

    // ----------------------------------------------------
    // TEST 9: Public Tenant Resolution does NOT leak sensitive settings
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/resolve?slug=albaraka`);
      const data = await res.json();
      const hasPublicFields = data.tenant?.slug === 'albaraka' && data.tenant?.nameAr;
      const leaksPrivateFields =
        data.tenant?.contactEmail !== undefined ||
        data.tenant?.taxPercentage !== undefined ||
        data.tenant?.orderNotificationPhone !== undefined;
      const passed = res.status === 200 && hasPublicFields && !leaksPrivateFields;
      results.push({
        testId: 'SEC-09',
        name: 'Public tenant resolution returns storefront metadata without leaking private settings',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Storefront public representation segregated from private data' : 'Data leakage detected',
      });
    }

    // ----------------------------------------------------
    // TEST 10: Security Headers Audit
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/health`);
      const xssHeader = res.headers.get('x-xss-protection');
      const nosniff = res.headers.get('x-content-type-options');
      const frameOptions = res.headers.get('x-frame-options');
      const csp = res.headers.get('content-security-policy');

      const passed =
        xssHeader === null && // Obsolete header removed
        nosniff === 'nosniff' &&
        frameOptions === 'SAMEORIGIN' &&
        csp !== null;

      results.push({
        testId: 'SEC-10',
        name: 'Security headers hardened: obsolete X-XSS-Protection removed, CSP & nosniff present',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed
          ? 'Modern security headers verified and obsolete mechanisms purged'
          : `Header audit failed (xss: ${xssHeader}, nosniff: ${nosniff})`,
      });
    }

    // ----------------------------------------------------
    // TEST 11: Cryptographic Audit Trail Hash-Chain Integrity
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/audit/verify-integrity`, {
        headers: {
          Authorization: 'Bearer token_platform_admin',
        },
      });
      const data = await res.json();
      const passed = res.status === 200 && data.cryptographicChainValid === true;
      results.push({
        testId: 'SEC-11',
        name: 'Cryptographic SHA-256 audit chain integrity is verified end-to-end',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'SHA-256 genesis-to-head hash chain validated' : 'Audit chain integrity failed',
      });
    }

    // ----------------------------------------------------
    // TEST 12: Cross-Tenant Mutation Attack (PATCH) -> 403 Forbidden
    // Merchant A attempts to mutate settings of Merchant B
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_nilecrafts`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contactEmail: 'hacker@malicious.com' }),
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'TENANT_MISMATCH';
      results.push({
        testId: 'SEC-12',
        name: 'Cross-tenant settings mutation (PATCH) is blocked with 403 TENANT_MISMATCH',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Cross-tenant mutation attack successfully thwarted' : 'Failed to block cross-tenant mutation',
      });
    }

    // ----------------------------------------------------
    // TEST 13: Legitimate Tenant Settings Mutation -> 200 OK
    // Merchant updates own store settings through Application Service
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_albaraka`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contactPhone: '+249912000000' }),
      });
      const data = await res.json();
      const passed = res.status === 200 && data.success === true && data.settings?.contactPhone === '+249912000000';
      results.push({
        testId: 'SEC-13',
        name: 'Legitimate tenant settings mutation via Application Service succeeds with 200',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Legitimate mutation persisted and audited via Application Service' : 'Failed legitimate mutation',
      });
    }

    // ----------------------------------------------------
    // TEST 14: Unauthenticated access to /api/tenants -> 401
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenants`);
      const data = await res.json();
      const passed = res.status === 401 && data.error?.code === 'AUTHENTICATION_REQUIRED';
      results.push({
        testId: 'SEC-14',
        name: 'Unauthenticated access to /api/tenants is rejected with 401',
        passed,
        expectedStatus: 401,
        actualStatus: res.status,
        message: passed ? 'Active tenant list protected from anonymous callers' : 'Failed to protect /api/tenants',
      });
    }

    // ----------------------------------------------------
    // TEST 15: Merchant access to /api/tenants -> 403 Forbidden
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenants`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
        },
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'FORBIDDEN';
      results.push({
        testId: 'SEC-15',
        name: 'Merchant access to /api/tenants is rejected with 403 (Platform Admin only)',
        passed,
        expectedStatus: 403,
        actualStatus: res.status,
        message: passed ? 'Tenant listing restricted to platform admin role' : 'Failed to restrict /api/tenants',
      });
    }

    // ----------------------------------------------------
    // TEST 16: Platform Admin access to /api/tenants -> 200 OK
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenants`, {
        headers: {
          Authorization: 'Bearer token_platform_admin',
        },
      });
      const data = await res.json();
      const passed = res.status === 200 && Array.isArray(data.stores);
      results.push({
        testId: 'SEC-16',
        name: 'Platform Admin access to /api/tenants succeeds with 200 OK',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Platform Admin successfully accessed tenant registry' : 'Platform admin access failed',
      });
    }

    // ----------------------------------------------------
    // TEST 17: Unauthenticated access to /api/audit/stream -> 401
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/audit/stream`);
      const data = await res.json();
      const passed = res.status === 401 && data.error?.code === 'AUTHENTICATION_REQUIRED';
      results.push({
        testId: 'SEC-17',
        name: 'Unauthenticated access to /api/audit/stream is rejected with 401',
        passed,
        expectedStatus: 401,
        actualStatus: res.status,
        message: passed ? 'Audit stream protected from unauthenticated callers' : 'Failed to protect audit stream',
      });
    }

    // ----------------------------------------------------
    // TEST 18: Merchant access to /api/audit/stream -> Tenant Scoped (No Global Chain)
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/audit/stream`, {
        headers: {
          Authorization: 'Bearer token_albaraka_owner',
        },
      });
      const data = await res.json();
      const passed =
        res.status === 200 &&
        data.scope === 'TENANT_SCOPED' &&
        data.tenantId === 'tenant_store_albaraka' &&
        data.integrity === null;
      results.push({
        testId: 'SEC-18',
        name: 'Merchant access to /api/audit/stream is strictly tenant-scoped with integrity withheld',
        passed,
        expectedStatus: 200,
        actualStatus: res.status,
        message: passed ? 'Audit stream correctly partitioned for tenant' : 'Audit stream scoping failed',
      });
    }

    // ----------------------------------------------------
    // TEST 19: Deprecated /api/tenant/test-isolation -> 404 Not Found
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/tenant/test-isolation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorTenantId: 'a', targetTenantId: 'b' }),
      });
      const passed = res.status === 404;
      results.push({
        testId: 'SEC-19',
        name: 'Deprecated unauthenticated endpoint /api/tenant/test-isolation returns 404',
        passed,
        expectedStatus: 404,
        actualStatus: res.status,
        message: passed ? 'Test endpoint successfully purged from routing table' : 'Deprecated test endpoint still active',
      });
    }

    // ----------------------------------------------------
    // TEST 20: Malformed and Invalid Bearer Tokens -> 401
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/audit/recent`, {
        headers: {
          Authorization: 'Bearer invalid_garbage_token_123',
        },
      });
      const data = await res.json();
      const passed = res.status === 401 && (data.error?.code === 'INVALID_TOKEN' || data.error?.code === 'AUTHENTICATION_REQUIRED');
      results.push({
        testId: 'SEC-20',
        name: 'Invalid and malformed bearer tokens are rejected with 401',
        passed,
        expectedStatus: 401,
        actualStatus: res.status,
        message: passed ? 'Invalid tokens fail closed with 401' : 'Failed to reject invalid token',
      });
    }

    // ----------------------------------------------------
    // TEST 21: Rate Limiting Throttling Defense -> 429 Too Many Requests
    // Placed at the end of the test suite to prevent burst limits from blocking other tests
    // ----------------------------------------------------
    {
      // Rapidly fire requests to trigger rate limit (test limit configured on app)
      let throttled = false;
      for (let i = 0; i < 110; i++) {
        const res = await fetch(`${baseUrl}/api/health`);
        if (res.status === 429) {
          throttled = true;
          const retryAfter = res.headers.get('Retry-After');
          const data = await res.json();
          results.push({
            testId: 'SEC-21',
            name: 'High-frequency request bursts trigger 429 RATE_LIMIT_EXCEEDED with Retry-After',
            passed: Boolean(throttled && retryAfter && data.error?.code === 'RATE_LIMIT_EXCEEDED'),
            expectedStatus: 429,
            actualStatus: res.status,
            message: 'Rate limiting defense successfully throttled excessive traffic',
          });
          break;
        }
      }
      if (!throttled) {
        results.push({
          testId: 'SEC-21',
          name: 'High-frequency request bursts trigger 429 RATE_LIMIT_EXCEEDED with Retry-After',
          passed: false,
          expectedStatus: 429,
          actualStatus: 200,
          message: 'Rate limiting failed to throttle burst requests',
        });
      }
    }

    // ----------------------------------------------------
    // PRODUCTION FAIL-CLOSED TEST SUITE (SEC-22 to SEC-26)
    // ----------------------------------------------------
    const prodApp = createApp({ isProduction: true, db: Database.createInMemory() });
    const prodServer = http.createServer(prodApp.app);
    await new Promise<void>((resolve) => prodServer.listen(0, '127.0.0.1', () => resolve()));
    const prodAddr = prodServer.address() as any;
    const prodBaseUrl = `http://127.0.0.1:${prodAddr.port}`;

    try {
      // SEC-22: GET /api/tests/phase0 -> 404 in production
      {
        const res = await fetch(`${prodBaseUrl}/api/tests/phase0`);
        const passed = res.status === 404;
        results.push({
          testId: 'SEC-22',
          name: 'Production fail-closed: GET /api/tests/phase0 returns 404',
          passed,
          expectedStatus: 404,
          actualStatus: res.status,
          message: passed ? 'Phase 0 test endpoint strictly disabled in production' : 'Phase 0 test route exposed in production',
        });
      }

      // SEC-23: GET /api/tests/security -> 404 in production
      {
        const res = await fetch(`${prodBaseUrl}/api/tests/security`);
        const passed = res.status === 404;
        results.push({
          testId: 'SEC-23',
          name: 'Production fail-closed: GET /api/tests/security returns 404',
          passed,
          expectedStatus: 404,
          actualStatus: res.status,
          message: passed ? 'Security test endpoint strictly disabled in production' : 'Security test route exposed in production',
        });
      }

      // SEC-24: GET /api/tests/remediation -> 404 in production
      {
        const res = await fetch(`${prodBaseUrl}/api/tests/remediation`);
        const passed = res.status === 404;
        results.push({
          testId: 'SEC-24',
          name: 'Production fail-closed: GET /api/tests/remediation returns 404',
          passed,
          expectedStatus: 404,
          actualStatus: res.status,
          message: passed ? 'Remediation test endpoint strictly disabled in production' : 'Remediation test route exposed in production',
        });
      }

      // SEC-25: POST /api/tenant/test-isolation -> 404 in production
      {
        const res = await fetch(`${prodBaseUrl}/api/tenant/test-isolation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorTenantId: 'a', targetTenantId: 'b' }),
        });
        const passed = res.status === 404;
        results.push({
          testId: 'SEC-25',
          name: 'Production fail-closed: POST /api/tenant/test-isolation returns 404',
          passed,
          expectedStatus: 404,
          actualStatus: res.status,
          message: passed ? 'Deprecated isolation endpoint returns 404' : 'Deprecated test endpoint exposed',
        });
      }

      // SEC-26: Adversarial attempts to bypass production route suppression via headers, query params, cookies
      {
        const res = await fetch(`${prodBaseUrl}/api/tests/phase0?enableTests=true&debug=1&env=development`, {
          headers: {
            'X-Enable-Tests': 'true',
            'X-Debug-Mode': '1',
            'X-Forwarded-Env': 'development',
            Cookie: 'debug=1; devMode=true',
          },
        });
        const passed = res.status === 404;
        results.push({
          testId: 'SEC-26',
          name: 'Production fail-closed cannot be bypassed via query params, headers, or cookies',
          passed,
          expectedStatus: 404,
          actualStatus: res.status,
          message: passed ? 'All adversarial bypass vectors rejected with 404' : 'Adversarial vector enabled test route',
        });
      }
    } finally {
      await new Promise<void>((resolve) => prodServer.close(() => resolve()));
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  return results;
}

// Standalone CLI runner
if (process.argv[1] && process.argv[1].endsWith('security.test.ts')) {
  runSecurityIntegrationTests()
    .then((results) => {
      console.log('\n==================================================');
      console.log('SOODA HTTP & SECURITY INTEGRATION TEST SUITE');
      console.log('==================================================');
      let allPassed = true;
      for (const r of results) {
        const icon = r.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`[${r.testId}] ${icon} : ${r.name}`);
        console.log(`       Status: ${r.actualStatus} (expected: ${r.expectedStatus}) | ${r.message}`);
        if (!r.passed) allPassed = false;
      }
      console.log('==================================================');
      if (allPassed) {
        console.log(`All ${results.length} security integration tests PASSED!`);
        process.exit(0);
      } else {
        console.error('One or more security integration tests FAILED!');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal Test Runner Error:', err);
      process.exit(1);
    });
}
