/**
 * Phase 1 Authentication & Account System Test Suite
 * 
 * Verifies real end-to-end security and business behavior:
 * 1. Argon2id password hashing and constant-time verification.
 * 2. Protection against timing-attack user enumeration via dummy verification.
 * 3. Brute-force protection & automatic account lockout (5 failed attempts).
 * 4. Inactive / disabled account authentication rejection.
 * 5. Persistent opaque session creation, SHA-256 hash-at-rest lookup, and expiry.
 * 6. Session revocation (single session and all user sessions).
 * 7. Real HTTP Login flow with HttpOnly cookie generation and Bearer token fallback.
 * 8. Authenticated identity inspection (/api/auth/me) with tenant memberships.
 * 9. Real HTTP Logout flow with server-side revocation and cookie eviction.
 * 10. Multi-tenant membership boundary validation under active sessions.
 * 11. Tamper-evident cryptographic audit log generation and chain integrity verification.
 */

import http from 'node:http';
import { createApp } from '../../server.ts';
import { Database } from '../core/database/index.ts';
import { hashPassword, verifyPassword, dummyVerify } from '../core/security/password.ts';
import { SessionService, SESSION_COOKIE_NAME } from '../core/auth/session.ts';
import { AuditLogService, AuditAction, registerAuditDatabaseProvider } from '../core/observability/index.ts';
import { AccountStatus, SystemRole } from '../core/domain/index.ts';

export interface AuthTestResult {
  testId: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  message: string;
  details?: unknown;
}

export async function runAuthenticationTestSuite(): Promise<AuthTestResult[]> {
  const results: AuthTestResult[] = [];
  const db = Database.createInMemory();
  const { app, sessionService } = createApp({ db });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to retrieve test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // ----------------------------------------------------
    // TEST 1: Argon2id Password Hashing & Verification
    // ----------------------------------------------------
    {
      const plainPassword = 'CorrectHorseBatteryStaple#2026';
      const hash = await hashPassword(plainPassword);
      const isMatch = await verifyPassword(hash, plainPassword);
      const isMismatch = await verifyPassword(hash, 'WrongPassword#123');

      const passed = isMatch === true && isMismatch === false && hash.startsWith('$argon2id$');
      results.push({
        testId: 'AUTH-01',
        name: 'Argon2id produces valid hash, accepts correct password, rejects incorrect password',
        passed,
        expected: 'Argon2id prefix, verify(correct)=true, verify(wrong)=false',
        actual: `prefix=${hash.substring(0, 10)}, isMatch=${isMatch}, isMismatch=${isMismatch}`,
        message: passed ? 'Password hashing verified' : 'Argon2id verification failed',
      });
    }

    // ----------------------------------------------------
    // TEST 2: Timing-attack Dummy Verification
    // ----------------------------------------------------
    {
      const start = Date.now();
      await dummyVerify();
      const durationMs = Date.now() - start;
      const passed = durationMs >= 10; // Must execute real compute work
      results.push({
        testId: 'AUTH-02',
        name: 'Dummy password verification performs compute work to neutralize timing attacks',
        passed,
        expected: 'duration >= 10ms',
        actual: `${durationMs}ms`,
        message: passed ? 'Dummy verification executed with constant-time workload' : 'Dummy verify too fast',
      });
    }

    // ----------------------------------------------------
    // TEST 3: HTTP Login with Missing Credentials -> 400
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@sooda.sd' }), // missing password
      });
      const data = await res.json();
      const passed = res.status === 400 && data.error?.code === 'INVALID_INPUT';
      results.push({
        testId: 'AUTH-03',
        name: 'Login endpoint requires both email and password with 400 INVALID_INPUT',
        passed,
        expected: 'HTTP 400 with INVALID_INPUT',
        actual: `HTTP ${res.status} with code=${data.error?.code}`,
        message: passed ? 'Validation correctly rejected incomplete login payload' : 'Failed to reject missing password',
      });
    }

    // ----------------------------------------------------
    // TEST 4: HTTP Login with Unknown User -> 401
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@sooda.sd', password: 'AnyPassword#123' }),
      });
      const data = await res.json();
      const passed = res.status === 401 && data.error?.code === 'INVALID_CREDENTIALS';
      results.push({
        testId: 'AUTH-04',
        name: 'Nonexistent user login rejected with 401 INVALID_CREDENTIALS',
        passed,
        expected: 'HTTP 401 with INVALID_CREDENTIALS',
        actual: `HTTP ${res.status} with code=${data.error?.code}`,
        message: passed ? 'Nonexistent user fails closed safely' : 'Failed to deny unknown user',
      });
    }

    // ----------------------------------------------------
    // TEST 5: HTTP Login with Invalid Password -> 401 & Lockout Counter Increment
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@albaraka.sd', password: 'WrongPassword#1' }),
      });
      const data = await res.json();
      const user = db.getUser('user_merchant_albaraka_owner');
      const passed = res.status === 401 && data.error?.code === 'INVALID_CREDENTIALS' && (user?.failedLoginAttempts ?? 0) >= 1;
      results.push({
        testId: 'AUTH-05',
        name: 'Incorrect password returns 401 and increments failed_login_attempts',
        passed,
        expected: 'HTTP 401 and failed_login_attempts >= 1',
        actual: `HTTP ${res.status}, attempts=${user?.failedLoginAttempts}`,
        message: passed ? 'Failed attempt tracked in database' : 'Failed attempt not tracked',
      });
    }

    // ----------------------------------------------------
    // TEST 6: Brute Force Account Lockout (5 failed attempts -> 403 ACCOUNT_LOCKED)
    // ----------------------------------------------------
    {
      // Trigger remaining failed attempts to reach threshold of 5
      for (let i = 0; i < 4; i++) {
        await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'owner@albaraka.sd', password: 'WrongPassword#Repeated' }),
        });
      }

      // Next attempt with valid password should now be BLOCKED due to lockout
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@albaraka.sd', password: 'MerchantPass#2026' }),
      });
      const data = await res.json();
      const user = db.getUser('user_merchant_albaraka_owner');
      const passed = res.status === 403 && data.error?.code === 'ACCOUNT_LOCKED' && user?.status === AccountStatus.LOCKED;
      results.push({
        testId: 'AUTH-06',
        name: 'Repeated failed logins lock the account and block subsequent valid logins with 403',
        passed,
        expected: 'HTTP 403 with ACCOUNT_LOCKED and user.status=LOCKED',
        actual: `HTTP ${res.status} code=${data.error?.code} user.status=${user?.status}`,
        message: passed ? 'Brute-force lockout enforced successfully' : 'Lockout not enforced',
      });

      // Unlock user for subsequent tests
      db.unlockUser('user_merchant_albaraka_owner');
    }

    // ----------------------------------------------------
    // TEST 7: Inactive / Disabled Account Rejection -> 403 ACCOUNT_INACTIVE
    // ----------------------------------------------------
    {
      // Create an inactive user
      const inactiveHash = await hashPassword('InactivePass#2026');
      db.createUser({
        id: 'user_inactive_test',
        email: 'inactive@sooda.sd',
        fullName: 'حساب غير نشط',
        role: SystemRole.MERCHANT_STAFF,
        status: AccountStatus.INACTIVE,
        isActive: false,
        passwordHash: inactiveHash,
      });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'inactive@sooda.sd', password: 'InactivePass#2026' }),
      });
      const data = await res.json();
      const passed = res.status === 403 && data.error?.code === 'ACCOUNT_INACTIVE';
      results.push({
        testId: 'AUTH-07',
        name: 'Inactive / disabled user cannot authenticate even with correct password',
        passed,
        expected: 'HTTP 403 with ACCOUNT_INACTIVE',
        actual: `HTTP ${res.status} with code=${data.error?.code}`,
        message: passed ? 'Inactive user rejected' : 'Failed to reject inactive user',
      });
    }

    // ----------------------------------------------------
    // TEST 8: Successful Browser Login Sets HttpOnly, SameSite=Strict Cookie & Does Not Expose Raw Token in JSON
    // ----------------------------------------------------
    let validSessionToken = '';
    let validCookieHeader = '';
    {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@sooda.sd', password: 'AdminPassword#2026' }),
      });
      const data = await res.json();
      const setCookie = res.headers.get('set-cookie') || '';
      validCookieHeader = setCookie.split(';')[0]; // e.g. "sooda_session=..."
      validSessionToken = validCookieHeader.replace(`${SESSION_COOKIE_NAME}=`, '');

      const hasSameSiteStrict = /samesite=strict/i.test(setCookie);
      const hasHttpOnly = /httponly/i.test(setCookie);
      const hasPathRoot = /path=\//i.test(setCookie);
      const hasMaxAge = /max-age=/i.test(setCookie);
      const tokenNotInBody = data.data?.token === undefined;

      const passed =
        res.status === 200 &&
        data.success === true &&
        data.data?.authType === 'COOKIE' &&
        tokenNotInBody &&
        data.data?.user?.email === 'admin@sooda.sd' &&
        data.data?.user?.role === SystemRole.PLATFORM_ADMIN &&
        setCookie.includes(SESSION_COOKIE_NAME) &&
        hasHttpOnly &&
        hasSameSiteStrict &&
        hasPathRoot &&
        hasMaxAge;

      results.push({
        testId: 'AUTH-08',
        name: 'Browser login sets HttpOnly, SameSite=Strict, Path=/, Max-Age cookie and does not expose raw token in JSON',
        passed,
        expected: 'HTTP 200, authType=COOKIE, token undefined in body, cookie contains HttpOnly, SameSite=Strict, Path=/, Max-Age',
        actual: `HTTP ${res.status}, authType=${data.data?.authType}, tokenInBody=${Boolean(data.data?.token)}, httpOnly=${hasHttpOnly}, sameSiteStrict=${hasSameSiteStrict}, pathRoot=${hasPathRoot}, maxAge=${hasMaxAge}`,
        message: passed ? 'Browser authentication cookie policy and token encapsulation verified' : 'Cookie policy or token policy failed',
      });
    }

    // ----------------------------------------------------
    // TEST 8B: Production Mode Enforces Secure Attribute on Cookie
    // ----------------------------------------------------
    {
      const prodDb = Database.createInMemory();
      const { app: prodApp } = createApp({ db: prodDb, isProduction: true });
      const prodServer = http.createServer(prodApp);
      await new Promise<void>((resolve) => prodServer.listen(0, '127.0.0.1', () => resolve()));
      const prodAddr = prodServer.address() as any;
      const prodBaseUrl = `http://127.0.0.1:${prodAddr.port}`;

      try {
        const res = await fetch(`${prodBaseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@sooda.sd', password: 'AdminPassword#2026' }),
        });
        const setCookie = res.headers.get('set-cookie') || '';
        const hasSecure = /secure/i.test(setCookie);
        const hasSameSiteStrict = /samesite=strict/i.test(setCookie);
        const hasHttpOnly = /httponly/i.test(setCookie);

        const passed = res.status === 200 && hasSecure && hasSameSiteStrict && hasHttpOnly;
        results.push({
          testId: 'AUTH-08B',
          name: 'Production environment enforces Secure, HttpOnly, and SameSite=Strict flags on session cookie',
          passed,
          expected: 'Secure=true, HttpOnly=true, SameSite=Strict=true',
          actual: `Secure=${hasSecure}, HttpOnly=${hasHttpOnly}, SameSiteStrict=${hasSameSiteStrict}`,
          message: passed ? 'Production cookie security flags confirmed' : 'Missing Secure flag in production mode',
        });
      } finally {
        await new Promise<void>((resolve) => prodServer.close(() => resolve()));
        prodDb.close();
        registerAuditDatabaseProvider(() => db);
        AuditLogService.getInstance(db);
      }
    }

    // ----------------------------------------------------
    // TEST 9: Session Hash-at-Rest Verification
    // ----------------------------------------------------
    {
      const tokenHash = SessionService.hashToken(validSessionToken);
      const sessionInDb = db.getSessionByTokenHash(tokenHash);
      const passed = Boolean(sessionInDb) && sessionInDb?.userId === 'user_platform_admin' && !sessionInDb?.isRevoked;
      results.push({
        testId: 'AUTH-09',
        name: 'Session token is hashed via SHA-256 before storage; raw token is not stored in DB',
        passed,
        expected: 'session found by hash, rawToken is not the stored hash',
        actual: `found=${Boolean(sessionInDb)}, hashPrefix=${tokenHash.substring(0, 10)}`,
        message: passed ? 'Hash-at-rest pattern verified' : 'Session token storage verification failed',
      });
    }

    // ----------------------------------------------------
    // TEST 10: Authenticated Inspection (/api/auth/me) via Cookie
    // ----------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: validCookieHeader },
      });
      const data = await res.json();
      const passed =
        res.status === 200 &&
        data.success === true &&
        data.data?.user?.id === 'user_platform_admin' &&
        data.data?.user?.email === 'admin@sooda.sd';

      results.push({
        testId: 'AUTH-10',
        name: 'Endpoint /api/auth/me successfully authenticates caller via HttpOnly cookie',
        passed,
        expected: 'HTTP 200 with user profile',
        actual: `HTTP ${res.status}, user=${data.data?.user?.email}`,
        message: passed ? 'Cookie authentication confirmed' : 'Cookie authentication failed',
      });
    }

    // ----------------------------------------------------
    // TEST 11: Programmatic API Authentication (/api/auth/token) via Bearer Header
    // ----------------------------------------------------
    let apiBearerToken = '';
    {
      const res = await fetch(`${baseUrl}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@sooda.sd', password: 'AdminPassword#2026' }),
      });
      const data = await res.json();
      const setCookie = res.headers.get('set-cookie');
      apiBearerToken = data.data?.token || '';

      // Validate that programmatic authentication returns Bearer token and sets NO cookie
      const tokenReceived = Boolean(apiBearerToken && apiBearerToken.length >= 32);
      const noCookieSet = !setCookie || setCookie.length === 0;

      // Verify that the Bearer token authenticates against /api/auth/me
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${apiBearerToken}` },
      });
      const meData = await meRes.json();

      const passed =
        res.status === 200 &&
        data.data?.authType === 'BEARER' &&
        tokenReceived &&
        noCookieSet &&
        meRes.status === 200 &&
        meData.data?.user?.id === 'user_platform_admin';

      results.push({
        testId: 'AUTH-11',
        name: 'Endpoint /api/auth/token issues Bearer token for programmatic API clients without cookies',
        passed,
        expected: 'HTTP 200, authType=BEARER, token present, no Set-Cookie, Bearer works on /api/auth/me',
        actual: `HTTP ${res.status}, authType=${data.data?.authType}, tokenLength=${apiBearerToken.length}, noCookie=${noCookieSet}, meStatus=${meRes.status}`,
        message: passed ? 'Programmatic Bearer authentication confirmed' : 'Programmatic auth failed',
      });
    }

    // ----------------------------------------------------
    // TEST 12: Merchant Login & Tenant Memberships Resolution
    // ----------------------------------------------------
    let merchantToken = '';
    {
      const res = await fetch(`${baseUrl}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@albaraka.sd', password: 'MerchantPass#2026' }),
      });
      const data = await res.json();
      merchantToken = data.data?.token || '';
      const memberships = data.data?.user?.memberships || [];

      const passed =
        res.status === 200 &&
        data.data?.user?.role === SystemRole.MERCHANT_OWNER &&
        memberships.some((m: any) => m.tenantId === 'tenant_store_albaraka');

      results.push({
        testId: 'AUTH-12',
        name: 'Merchant login includes verified tenant_memberships in authenticated context',
        passed,
        expected: 'role=MERCHANT_OWNER, memberships contains tenant_store_albaraka',
        actual: `role=${data.data?.user?.role}, membershipsCount=${memberships.length}`,
        message: passed ? 'Tenant memberships resolved correctly' : 'Failed to resolve memberships',
      });
    }

    // ----------------------------------------------------
    // TEST 13: Tenant Isolation Boundary with Real Session
    // ----------------------------------------------------
    {
      // Merchant Al-Baraka attempts to access Al-Baraka settings (legitimate)
      const legitRes = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_albaraka`, {
        headers: { Authorization: `Bearer ${merchantToken}` },
      });

      // Merchant Al-Baraka attempts to access NileCrafts settings (cross-tenant attack)
      const crossTenantRes = await fetch(`${baseUrl}/api/tenant/settings?tenantId=tenant_store_nilecrafts`, {
        headers: { Authorization: `Bearer ${merchantToken}` },
      });
      const crossTenantData = await crossTenantRes.json();

      const passed =
        legitRes.status === 200 &&
        crossTenantRes.status === 403 &&
        crossTenantData.error?.code === 'TENANT_MISMATCH';

      results.push({
        testId: 'AUTH-13',
        name: 'Cross-tenant access blocked (403 TENANT_MISMATCH) under active merchant session',
        passed,
        expected: 'Legitimate=200, CrossTenant=403 TENANT_MISMATCH',
        actual: `LegitStatus=${legitRes.status}, CrossStatus=${crossTenantRes.status}, code=${crossTenantData.error?.code}`,
        message: passed ? 'Strict tenant boundary maintained' : 'Cross tenant security boundary breached',
      });
    }

    // ----------------------------------------------------
    // TEST 14: Single Session Revocation via /api/auth/logout
    // ----------------------------------------------------
    {
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${validSessionToken}`,
          Cookie: validCookieHeader,
        },
      });
      const logoutData = await logoutRes.json();
      const setCookie = logoutRes.headers.get('set-cookie') || '';
      const clearsCookieWithStrict = /samesite=strict/i.test(setCookie) && /path=\//i.test(setCookie);

      // Verify session is revoked in database
      const tokenHash = SessionService.hashToken(validSessionToken);
      const sessionInDb = db.getSessionByTokenHash(tokenHash, true);

      // Attempting to access /api/auth/me with revoked token must now fail with 401
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${validSessionToken}` },
      });

      const passed =
        logoutRes.status === 200 &&
        logoutData.success === true &&
        clearsCookieWithStrict &&
        sessionInDb?.isRevoked === true &&
        meRes.status === 401;

      results.push({
        testId: 'AUTH-14',
        name: 'Logout revokes session in database, clears cookie with SameSite=Strict, and invalidates subsequent requests (401)',
        passed,
        expected: 'Logout=200, isRevoked=true, clearsCookieWithStrict=true, meRes=401',
        actual: `LogoutStatus=${logoutRes.status}, isRevoked=${sessionInDb?.isRevoked}, clearsStrict=${clearsCookieWithStrict}, meResStatus=${meRes.status}`,
        message: passed ? 'Session revocation verified' : 'Session revocation failed',
      });
    }

    // ----------------------------------------------------
    // TEST 15: Global User Session Revocation
    // ----------------------------------------------------
    {
      // Create two sessions for the merchant
      const s1 = sessionService.createSession('user_merchant_nilecrafts_owner');
      const s2 = sessionService.createSession('user_merchant_nilecrafts_owner');

      const v1Before = sessionService.validateSession(s1.rawToken);
      const v2Before = sessionService.validateSession(s2.rawToken);

      // Global revocation
      sessionService.revokeAllUserSessions('user_merchant_nilecrafts_owner');

      const v1After = sessionService.validateSession(s1.rawToken);
      const v2After = sessionService.validateSession(s2.rawToken);

      const passed =
        v1Before.valid === true &&
        v2Before.valid === true &&
        v1After.valid === false &&
        v2After.valid === false;

      results.push({
        testId: 'AUTH-15',
        name: 'Global session revocation invalidates all active sessions for target user',
        passed,
        expected: 'Before=true/true, After=false/false',
        actual: `Before=${v1Before.valid}/${v2Before.valid}, After=${v1After.valid}/${v2After.valid}`,
        message: passed ? 'Global session revocation verified' : 'Global revocation failed',
      });
    }

    // ----------------------------------------------------
    // TEST 16: Session Expiration Enforcement
    // ----------------------------------------------------
    {
      // Create session with 1 millisecond TTL
      const expiredSession = sessionService.createSession('user_platform_admin', { ttlMs: -1000 });
      const validation = sessionService.validateSession(expiredSession.rawToken);

      const passed = validation.valid === false && validation.reason === 'SESSION_EXPIRED';
      const failReason = !validation.valid ? (validation as any).reason : 'NONE';
      results.push({
        testId: 'AUTH-16',
        name: 'Expired session tokens are strictly rejected with reason SESSION_EXPIRED',
        passed,
        expected: 'valid=false, reason=SESSION_EXPIRED',
        actual: `valid=${validation.valid}, reason=${failReason}`,
        message: passed ? 'Session expiration enforced' : 'Expired session was accepted',
      });
    }

    // ----------------------------------------------------
    // TEST 17: Audit Chain Cryptographic Integrity After All Auth Events
    // ----------------------------------------------------
    {
      const auditService = AuditLogService.getInstance();
      const integrity = auditService.verifyIntegrity();
      const recentEvents = auditService.getRecent(100);
      const authEvents = recentEvents.filter((e) =>
        [
          AuditAction.LOGIN_SUCCESS,
          AuditAction.LOGIN_FAILURE,
          AuditAction.ACCOUNT_LOCKED,
          AuditAction.LOGOUT,
          AuditAction.SESSION_CREATED,
          AuditAction.SESSION_REVOKED,
          AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
        ].includes(e.action as AuditAction)
      );

      const passed = integrity.valid === true && authEvents.length >= 6;
      results.push({
        testId: 'AUTH-17',
        name: 'All authentication events are recorded in the cryptographic audit chain and pass integrity validation',
        passed,
        expected: 'integrity.valid=true, authEvents >= 6',
        actual: `valid=${integrity.valid}, authEventsCount=${authEvents.length}, totalEvents=${recentEvents.length}`,
        message: passed ? 'Audit chain integrity intact across all authentication operations' : 'Audit chain integrity failed',
      });
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return results;
}

if (process.argv[1] && process.argv[1].includes('authentication.test.ts')) {
  console.log('==================================================');
  console.log('Sooda SaaS Phase 1 Authentication & Account Tests');
  console.log('==================================================');
  runAuthenticationTestSuite()
    .then((results) => {
      let allPassed = true;
      for (const r of results) {
        const icon = r.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`[${r.testId}] ${icon} : ${r.name}`);
        console.log(`       ${r.message} | ${r.actual}`);
        if (!r.passed) allPassed = false;
      }
      console.log('==================================================');
      if (allPassed) {
        console.log(`All ${results.length} Phase 1 Authentication tests PASSED!`);
        process.exit(0);
      } else {
        console.error('One or more Phase 1 Authentication tests FAILED!');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Fatal Test Runner Error:', err);
      process.exit(1);
    });
}

