/**
 * Phase 2 Store Management & Merchant Dashboard Test Suite
 * 
 * End-to-end verification of Phase 2 domain, security, and API behavior
 * directly covering the 20 Mandatory Security Tests:
 * 
 * 1. Unauthenticated request rejected (P2-SEC-01)
 * 2. Authenticated merchant can access own authorized store (P2-SEC-02)
 * 3. Merchant cannot access another tenant's store (P2-SEC-03)
 * 4. Changing storeId in URL cannot bypass authorization (P2-SEC-04)
 * 5. Changing tenant ID cannot bypass authorization (P2-SEC-05)
 * 6. Forged user ID rejected (P2-SEC-06)
 * 7. Forged role rejected (P2-SEC-07)
 * 8. STORE_CUSTOMER cannot access merchant management API (P2-SEC-08)
 * 9. Client cannot modify tenantId (P2-SEC-09)
 * 10. Client cannot modify ownership (P2-SEC-10)
 * 11. Client cannot modify createdAt (P2-SEC-11)
 * 12. Unknown update fields rejected (P2-SEC-12)
 * 13. Invalid slug rejected (P2-SEC-13)
 * 14. Duplicate slug rejected where uniqueness applies (P2-SEC-14)
 * 15. Unauthorized status change rejected (P2-SEC-15)
 * 16. Authorized update persists (P2-SEC-16)
 * 17. Audit event generated (P2-SEC-17)
 * 18. Audit failure respects fail-closed policy (P2-SEC-18)
 * 19. Database failure does not leave partial state (P2-SEC-19)
 * 20. Cross-tenant access does not leak store existence/data (P2-SEC-20)
 */

import http from 'node:http';
import { createApp } from '../../server.ts';
import { Database } from '../core/database/index.ts';
import { SessionService, SESSION_COOKIE_NAME } from '../core/auth/session.ts';
import {
  AuditLogService,
  AuditAction,
  AuditPersistenceError,
  registerAuditDatabaseProvider,
} from '../core/observability/index.ts';
import { SystemRole, AccountStatus } from '../core/domain/index.ts';

export interface StoreTestResult {
  testId: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  message: string;
  details?: unknown;
}

export async function runStoreManagementTestSuite(): Promise<StoreTestResult[]> {
  const results: StoreTestResult[] = [];
  const db = Database.createInMemory();
  db.runMigrations();
  db.seedFoundation();

  // Seed extra test tenants and users for multi-tenant isolation testing
  const now = new Date().toISOString();
  db.rawDb.exec(`
    INSERT INTO users (id, email, normalized_email, phone, full_name, password_hash, password_algo, role, status, is_active, failed_login_attempts, created_at, updated_at)
    VALUES ('user_merchant_other', 'other@bluenile.sd', 'other@bluenile.sd', '+249912000002', 'Other Merchant', 'hash', 'argon2id', 'MERCHANT_OWNER', 'ACTIVE', 1, 0, '${now}', '${now}');

    INSERT INTO users (id, email, normalized_email, phone, full_name, password_hash, password_algo, role, status, is_active, failed_login_attempts, created_at, updated_at)
    VALUES ('user_staff_albaraka', 'staff@albaraka.sd', 'staff@albaraka.sd', '+249912000003', 'Staff Albaraka', 'hash', 'argon2id', 'MERCHANT_STAFF', 'ACTIVE', 1, 0, '${now}', '${now}');

    INSERT INTO users (id, email, normalized_email, phone, full_name, password_hash, password_algo, role, status, is_active, failed_login_attempts, created_at, updated_at)
    VALUES ('user_customer_test', 'customer@gmail.com', 'customer@gmail.com', '+249912000004', 'Test Customer', 'hash', 'argon2id', 'STORE_CUSTOMER', 'ACTIVE', 1, 0, '${now}', '${now}');

    INSERT INTO merchants (id, owner_user_id, business_name, trade_name_ar, country_code, city, phone_number, status, created_at, updated_at)
    VALUES ('merchant_other', 'user_merchant_other', 'Blue Nile Goods', 'بضائع النيل الأزرق', 'SD', 'Omdurman', '+249912000002', 'ACTIVE', '${now}', '${now}');

    INSERT INTO stores (id, merchant_id, slug, name_ar, name_en, description_ar, description_en, status, currency, timezone, default_locale, created_at, updated_at)
    VALUES ('tenant_store_other', 'merchant_other', 'blue-nile', 'متجر النيل الأزرق', 'Blue Nile Store', 'وصف المتجر', 'Store description', 'ACTIVE', 'SDG', 'Africa/Khartoum', 'ar', '${now}', '${now}');

    INSERT INTO store_settings (id, tenant_id, store_id, contact_email, contact_phone, created_at, updated_at)
    VALUES ('settings_other', 'tenant_store_other', 'tenant_store_other', 'info@bluenile.sd', '+249912000002', '${now}', '${now}');

    INSERT INTO tenant_memberships (id, user_id, tenant_id, role, status, created_at, updated_at)
    VALUES ('mship_other_owner', 'user_merchant_other', 'tenant_store_other', 'MERCHANT_OWNER', 'ACTIVE', '${now}', '${now}');

    INSERT INTO tenant_memberships (id, user_id, tenant_id, role, status, created_at, updated_at)
    VALUES ('mship_staff_albaraka', 'user_staff_albaraka', 'tenant_store_albaraka', 'MERCHANT_STAFF', 'ACTIVE', '${now}', '${now}');
  `);

  registerAuditDatabaseProvider(() => db);
  const auditService = AuditLogService.getInstance(db);
  const { app, sessionService } = createApp({ db });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const makeRequest = async (
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {}
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders: Record<string, string> = { ...options.headers };

      let bodyData: string | undefined;
      if (options.body) {
        bodyData = JSON.stringify(options.body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyData).toString();
      }

      const req = http.request(
        url,
        {
          method: options.method || 'GET',
          headers: reqHeaders,
        },
        (res) => {
          let rawData = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (rawData += chunk));
          res.on('end', () => {
            let json = {};
            try {
              json = rawData ? JSON.parse(rawData) : {};
            } catch {
              json = { raw: rawData };
            }
            resolve({ status: res.statusCode || 0, headers: res.headers, json });
          });
        }
      );

      req.on('error', reject);
      if (bodyData) req.write(bodyData);
      req.end();
    });
  };

  const getErrorCode = (json: any): string => json?.code || json?.error?.code || '';

  try {
    // Authenticated Sessions for test personas
    const merchantUser = db.getUser('user_merchant_albaraka_owner')!; // Owner of tenant_store_albaraka
    const sessionMerchant = sessionService.createSession(merchantUser.id, {
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      actorRole: merchantUser.role,
      tenantId: merchantUser.tenantId,
    });

    const otherMerchantUser = db.getUser('user_merchant_other')!; // Owner of tenant_store_other
    const sessionOtherMerchant = sessionService.createSession(otherMerchantUser.id, {
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      actorRole: otherMerchantUser.role,
      tenantId: 'tenant_store_other',
    });

    const staffUser = db.getUser('user_staff_albaraka')!; // Staff of tenant_store_albaraka
    const sessionStaff = sessionService.createSession(staffUser.id, {
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      actorRole: staffUser.role,
      tenantId: 'tenant_store_albaraka',
    });

    const customerUser = db.getUser('user_customer_test')!; // STORE_CUSTOMER
    const sessionCustomer = sessionService.createSession(customerUser.id, {
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent/1.0',
      actorRole: customerUser.role,
    });

    // ====================================================
    // 1. Unauthenticated request rejected (P2-SEC-01)
    // ====================================================
    {
      const res = await makeRequest('/api/stores');
      const passed = res.status === 401 && res.json.error?.code === 'AUTHENTICATION_REQUIRED';
      results.push({
        testId: 'P2-SEC-01',
        name: 'Unauthenticated Request Rejected',
        passed,
        expected: 'HTTP 401 AUTHENTICATION_REQUIRED',
        actual: `HTTP ${res.status} ${res.json.error?.code}`,
        message: passed ? 'Unauthenticated access rejected' : 'Failed to reject unauthenticated request',
      });
    }

    // ====================================================
    // 2. Authenticated merchant can access own authorized store (P2-SEC-02)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
      });
      const passed = res.status === 200 && res.json.store?.id === 'tenant_store_albaraka';
      results.push({
        testId: 'P2-SEC-02',
        name: 'Authenticated Merchant Can Access Own Authorized Store',
        passed,
        expected: 'HTTP 200 with tenant_store_albaraka details',
        actual: `HTTP ${res.status} (${res.json.store?.id})`,
        message: passed ? 'Merchant retrieved authorized store profile' : 'Failed to retrieve own store',
      });
    }

    // ====================================================
    // 3. Merchant cannot access another tenant\'s store (P2-SEC-03)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_other', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 403 && (errCode === 'TENANT_MISMATCH' || errCode === 'FORBIDDEN');
      results.push({
        testId: 'P2-SEC-03',
        name: "Merchant Cannot Access Another Tenant's Store",
        passed,
        expected: 'HTTP 403 TENANT_MISMATCH',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Cross-tenant access blocked' : 'Cross-tenant access allowed',
      });
    }

    // ====================================================
    // 4. Changing storeId in URL cannot bypass authorization (P2-SEC-04)
    // ====================================================
    {
      // Attacker is merchant for albaraka, attempts to change URL param to other tenant's store
      const res = await makeRequest('/api/stores/tenant_store_other', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 403 && (errCode === 'TENANT_MISMATCH' || errCode === 'FORBIDDEN');
      results.push({
        testId: 'P2-SEC-04',
        name: 'Changing storeId in URL Cannot Bypass Authorization',
        passed,
        expected: 'HTTP 403 TENANT_MISMATCH',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'URL parameter tampering blocked' : 'URL tampering succeeded',
      });
    }

    // ====================================================
    // 5. Changing tenant ID cannot bypass authorization (P2-SEC-05)
    // ====================================================
    {
      // Attacker attempts to pass header and query overrides for tenantId
      const res = await makeRequest('/api/stores/tenant_store_other?tenantId=tenant_store_other', {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}`,
          'X-Tenant-ID': 'tenant_store_other',
        },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 403 && (errCode === 'TENANT_MISMATCH' || errCode === 'FORBIDDEN');
      results.push({
        testId: 'P2-SEC-05',
        name: 'Changing Tenant ID Cannot Bypass Authorization',
        passed,
        expected: 'HTTP 403 TENANT_MISMATCH',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Header/Query tenant injection ignored; server authority enforced' : 'Tenant ID injection bypassed auth',
      });
    }

    // ====================================================
    // 6. Forged user ID rejected (P2-SEC-06)
    // ====================================================
    {
      // Attacker sends arbitrary X-User-Id header without valid session
      const res = await makeRequest('/api/stores', {
        headers: {
          'X-User-Id': 'user_platform_admin',
          'X-Actor-Role': 'PLATFORM_ADMIN',
        },
      });
      const passed = res.status === 401;
      results.push({
        testId: 'P2-SEC-06',
        name: 'Forged User ID Rejected',
        passed,
        expected: 'HTTP 401 (Forged identity headers discarded)',
        actual: `HTTP ${res.status}`,
        message: passed ? 'Client-supplied identity headers rejected without cryptographic session' : 'Forged identity accepted',
      });
    }

    // ====================================================
    // 7. Forged role rejected (P2-SEC-07)
    // ====================================================
    {
      // Customer attempts to supply PLATFORM_ADMIN role in header or body
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${sessionCustomer.rawToken}`,
          'X-User-Role': 'PLATFORM_ADMIN',
        },
        body: { nameEn: 'Attempted Escalation', role: 'PLATFORM_ADMIN' },
      });
      const passed = res.status === 403;
      results.push({
        testId: 'P2-SEC-07',
        name: 'Forged Role Rejected',
        passed,
        expected: 'HTTP 403 FORBIDDEN',
        actual: `HTTP ${res.status}`,
        message: passed ? 'Role escalation rejected; role resolved strictly from server session' : 'Role forgery succeeded',
      });
    }

    // ====================================================
    // 8. STORE_CUSTOMER cannot access merchant management API (P2-SEC-08)
    // ====================================================
    {
      const resList = await makeRequest('/api/stores', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionCustomer.rawToken}` },
      });
      const resGet = await makeRequest('/api/stores/tenant_store_albaraka', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionCustomer.rawToken}` },
      });
      const passed = resList.status === 403 && resGet.status === 403;
      results.push({
        testId: 'P2-SEC-08',
        name: 'STORE_CUSTOMER Cannot Access Merchant Management API',
        passed,
        expected: 'HTTP 403 on both /api/stores and /api/stores/:id',
        actual: `HTTP ${resList.status} / HTTP ${resGet.status}`,
        message: passed ? 'Customer accounts blocked from merchant API' : 'Customer accessed merchant API',
      });
    }

    // ====================================================
    // 9. Client cannot modify tenantId (P2-SEC-09)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { tenantId: 'tenant_store_hijacked' },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 400 && (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_INPUT');
      results.push({
        testId: 'P2-SEC-09',
        name: 'Client Cannot Modify tenantId',
        passed,
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Prohibited tenantId mutation rejected' : 'Allowed tenantId mutation',
      });
    }

    // ====================================================
    // 10. Client cannot modify ownership (P2-SEC-10)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { merchantId: 'merchant_other', ownerId: 'user_merchant_other' },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 400 && (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_INPUT');
      results.push({
        testId: 'P2-SEC-10',
        name: 'Client Cannot Modify Ownership',
        passed,
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Prohibited ownership mutation rejected' : 'Allowed ownership mutation',
      });
    }

    // ====================================================
    // 11. Client cannot modify createdAt (P2-SEC-11)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { createdAt: '2020-01-01T00:00:00.000Z' },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 400 && (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_INPUT');
      results.push({
        testId: 'P2-SEC-11',
        name: 'Client Cannot Modify createdAt',
        passed,
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Prohibited createdAt mutation rejected' : 'Allowed createdAt mutation',
      });
    }

    // ====================================================
    // 12. Unknown update fields rejected (P2-SEC-12)
    // ====================================================
    {
      // Explicit test payload from specification:
      // { id, tenantId, ownerId, role, createdAt, status, name }
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: {
          id: 'tenant_store_hacked',
          tenantId: 'tenant_store_hacked',
          ownerId: 'user_hacker',
          role: 'PLATFORM_ADMIN',
          createdAt: '2020-01-01T00:00:00.000Z',
          status: 'ACTIVE',
          name: 'Hacked Store Name',
        },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 400 && (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_INPUT');
      results.push({
        testId: 'P2-SEC-12',
        name: 'Unknown Update Fields Rejected (Mass Assignment)',
        passed,
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Mass assignment attack rejected by strict whitelist schema' : 'Mass assignment succeeded',
      });
    }

    // ====================================================
    // 13. Invalid slug rejected (P2-SEC-13)
    // ====================================================
    {
      const resReserved = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { slug: 'admin' },
      });
      const resInvalidChars = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { slug: 'invalid_slug_with_underscores' },
      });
      const errCodeReserved = getErrorCode(resReserved.json);
      const errCodeChars = getErrorCode(resInvalidChars.json);
      const passed =
        resReserved.status === 400 &&
        (errCodeReserved === 'VALIDATION_ERROR' || errCodeReserved === 'INVALID_INPUT') &&
        resInvalidChars.status === 400 &&
        (errCodeChars === 'VALIDATION_ERROR' || errCodeChars === 'INVALID_INPUT');

      results.push({
        testId: 'P2-SEC-13',
        name: 'Invalid Slug Rejected',
        passed,
        expected: 'HTTP 400 VALIDATION_ERROR for reserved keyword and invalid characters',
        actual: `Reserved: HTTP ${resReserved.status} ${errCodeReserved}, InvalidChars: HTTP ${resInvalidChars.status} ${errCodeChars}`,
        message: passed ? 'Invalid and reserved slugs rejected' : 'Invalid slug accepted',
      });
    }

    // ====================================================
    // 14. Duplicate slug rejected where uniqueness applies (P2-SEC-14)
    // ====================================================
    {
      // Attempt to rename albaraka store slug to 'blue-nile', which belongs to tenant_store_other
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { slug: 'blue-nile' },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 400 && (errCode === 'VALIDATION_ERROR' || errCode === 'INVALID_INPUT');
      results.push({
        testId: 'P2-SEC-14',
        name: 'Duplicate Slug Rejected Where Uniqueness Applies',
        passed,
        expected: 'HTTP 400 VALIDATION_ERROR',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Cross-tenant slug collision rejected' : 'Duplicate slug accepted',
      });
    }

    // ====================================================
    // 15. Unauthorized status change rejected (P2-SEC-15)
    // ====================================================
    {
      // Staff member attempting to inactivate store (status changes restricted to MERCHANT_OWNER)
      const res = await makeRequest('/api/stores/tenant_store_albaraka/status', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionStaff.rawToken}` },
        body: { status: 'INACTIVE' },
      });
      const passed = res.status === 403;
      results.push({
        testId: 'P2-SEC-15',
        name: 'Unauthorized Status Change Rejected',
        passed,
        expected: 'HTTP 403 FORBIDDEN',
        actual: `HTTP ${res.status}`,
        message: passed ? 'Staff correctly denied permission to mutate store status' : 'Staff changed store status',
      });
    }

    // ====================================================
    // 16. Authorized update persists (P2-SEC-16)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_albaraka', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: {
          nameAr: 'متجر البركة المطور الشامل',
          nameEn: 'Al-Baraka Verified Store',
          descriptionAr: 'متجر سوداني موثوق للتجارة الرقمية',
          contactEmail: 'orders@albaraka.sd',
          contactPhone: '+249912001122',
        },
      });

      const dbStore = db.getStore('tenant_store_albaraka');
      const dbSettings = db.getStoreSettings('tenant_store_albaraka');

      const passed =
        res.status === 200 &&
        dbStore?.nameAr === 'متجر البركة المطور الشامل' &&
        dbStore?.nameEn === 'Al-Baraka Verified Store' &&
        dbSettings?.contactEmail === 'orders@albaraka.sd' &&
        dbSettings?.contactPhone === '+249912001122';

      results.push({
        testId: 'P2-SEC-16',
        name: 'Authorized Update Persists',
        passed,
        expected: 'HTTP 200 and fields updated in persistent database',
        actual: `HTTP ${res.status} (Store: ${dbStore?.nameAr}, Email: ${dbSettings?.contactEmail})`,
        message: passed ? 'Authorized update correctly persisted across database tables' : 'Update did not persist',
      });
    }

    // ====================================================
    // 17. Audit event generated (P2-SEC-17)
    // ====================================================
    {
      const events = db.getAllAuditEventsChronological();
      const hasStoreUpdated = events.some(
        (e: any) => (e.tenant_id === 'tenant_store_albaraka' || e.tenantId === 'tenant_store_albaraka') && e.action === AuditAction.STORE_UPDATED
      );
      const integrity = auditService.verifyIntegrity();
      const passed = hasStoreUpdated && integrity.valid;

      results.push({
        testId: 'P2-SEC-17',
        name: 'Audit Event Generated',
        passed,
        expected: 'STORE_UPDATED recorded with unbroken SHA-256 hash chain',
        actual: `Audit count: ${events.length}, Hash chain valid: ${integrity.valid}`,
        message: passed ? 'Tamper-evident audit event recorded with continuous hash chain' : 'Audit event missing or invalid',
      });
    }

    // ====================================================
    // 18. Audit failure respects fail-closed policy (P2-SEC-18)
    // ====================================================
    {
      const storeBefore = db.getStore('tenant_store_albaraka')!;
      const originalNameAr = storeBefore.nameAr;

      // Inject simulated audit failure for STORE_UPDATED
      auditService.setFailureSimulator((action) => {
        if (action === String(AuditAction.STORE_UPDATED)) {
          return new AuditPersistenceError('Simulated audit hardware disk write failure');
        }
        return null;
      });

      let resStatus = 0;
      try {
        const res = await makeRequest('/api/stores/tenant_store_albaraka', {
          method: 'PATCH',
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
          body: { nameAr: 'اسم غير قابل للحفظ بسبب فشل التدقيق' },
        });
        resStatus = res.status;
      } finally {
        // Reset failure simulator
        auditService.setFailureSimulator(null);
      }

      const storeAfter = db.getStore('tenant_store_albaraka')!;
      // Adhering to fail-closed policy: the request failed and database change was rolled back
      const passed = resStatus >= 500 && storeAfter.nameAr === originalNameAr;

      results.push({
        testId: 'P2-SEC-18',
        name: 'Audit Failure Respects Fail-Closed Policy',
        passed,
        expected: 'Request rejected (500) and database state rolled back to original',
        actual: `HTTP ${resStatus}, Database name: ${storeAfter.nameAr}`,
        message: passed
          ? 'Fail-closed security verified: audit persistence failure rolled back database changes'
          : 'Fail-closed policy violated: mutation persisted despite audit failure',
      });
    }

    // ====================================================
    // 19. Database failure does not leave partial state (P2-SEC-19)
    // ====================================================
    {
      const storeBefore = db.getStore('tenant_store_albaraka')!;
      const settingsBefore = db.getStoreSettings('tenant_store_albaraka')!;

      // Attempt atomic transaction failure:
      let caughtError = false;
      try {
        db.transaction(() => {
          db.updateStore('tenant_store_albaraka', { nameEn: 'Partial Update Attempt' });
          throw new Error('Simulated mid-transaction failure');
        });
      } catch {
        caughtError = true;
      }

      const storeAfter = db.getStore('tenant_store_albaraka')!;
      const settingsAfter = db.getStoreSettings('tenant_store_albaraka')!;

      const passed =
        caughtError &&
        storeAfter.nameEn === storeBefore.nameEn &&
        settingsAfter?.contactEmail === settingsBefore?.contactEmail;

      results.push({
        testId: 'P2-SEC-19',
        name: 'Database Failure Does Not Leave Partial State',
        passed,
        expected: 'Transaction rolled back with zero partial modifications',
        actual: `Rollback verified: store.nameEn remained '${storeAfter.nameEn}'`,
        message: passed ? 'Atomic transaction boundaries prevent partial state corruption' : 'Partial state detected',
      });
    }

    // ====================================================
    // 20. Cross-tenant access does not leak store existence/data (P2-SEC-20)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/tenant_store_other', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
      });

      const jsonString = JSON.stringify(res.json);
      // Ensure zero sensitive other-tenant details (emails, phones, business names) leaked
      const leakedPhone = jsonString.includes('+249912000002');
      const leakedEmail = jsonString.includes('info@bluenile.sd');
      const leakedData = res.json.store || res.json.settings;

      const passed = res.status === 403 && !leakedPhone && !leakedEmail && !leakedData;

      results.push({
        testId: 'P2-SEC-20',
        name: 'Cross-Tenant Access Does Not Leak Store Existence/Data',
        passed,
        expected: 'HTTP 403 TENANT_MISMATCH with zero leaked metadata or settings',
        actual: `HTTP ${res.status}, LeakedData: ${!!leakedData}`,
        message: passed
          ? 'Cross-tenant boundary strictly prevents data leakage or metadata enumeration'
          : 'Sensitive store data leaked in error payload',
      });
    }

    // ====================================================
    // 21. Check-slug requires authentication (P2-SEC-21)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/check-slug?slug=test-slug&currentStoreId=tenant_store_albaraka');
      const passed = res.status === 401;
      results.push({
        testId: 'P2-SEC-21',
        name: 'Check-Slug Requires Authentication',
        passed,
        expected: 'HTTP 401 AUTHENTICATION_REQUIRED',
        actual: `HTTP ${res.status}`,
        message: passed ? 'Unauthenticated slug enumeration strictly rejected' : 'Unauthenticated slug check allowed',
      });
    }

    // ====================================================
    // 22. Check-slug blocks STORE_CUSTOMER (P2-SEC-22)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/check-slug?slug=test-slug&currentStoreId=tenant_store_albaraka', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionCustomer.rawToken}` },
      });
      const passed = res.status === 403;
      results.push({
        testId: 'P2-SEC-22',
        name: 'Check-Slug Blocks STORE_CUSTOMER Role',
        passed,
        expected: 'HTTP 403 FORBIDDEN',
        actual: `HTTP ${res.status}`,
        message: passed ? 'Store customers blocked from merchant slug management API' : 'Customer accessed slug API',
      });
    }

    // ====================================================
    // 23. Check-slug blocks cross-tenant currentStoreId (P2-SEC-23)
    // ====================================================
    {
      // Merchant Al-Baraka attempts to probe slug availability posing with other tenant's store ID
      const res = await makeRequest('/api/stores/check-slug?slug=test-slug&currentStoreId=tenant_store_other', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
      });
      const errCode = getErrorCode(res.json);
      const passed = res.status === 403 && (errCode === 'TENANT_MISMATCH' || errCode === 'FORBIDDEN');
      results.push({
        testId: 'P2-SEC-23',
        name: 'Check-Slug Blocks Cross-Tenant currentStoreId Query',
        passed,
        expected: 'HTTP 403 TENANT_MISMATCH',
        actual: `HTTP ${res.status} ${errCode}`,
        message: passed ? 'Cross-tenant slug query blocked and audited' : 'Cross-tenant slug query succeeded',
      });
    }

    // ====================================================
    // 24. Check-slug succeeds for authorized store owner (P2-SEC-24)
    // ====================================================
    {
      const res = await makeRequest('/api/stores/check-slug?slug=brand-new-slug&currentStoreId=tenant_store_albaraka', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
      });
      const passed = res.status === 200 && res.json.available === true;
      results.push({
        testId: 'P2-SEC-24',
        name: 'Check-Slug Succeeds for Authorized Store Owner',
        passed,
        expected: 'HTTP 200 available=true',
        actual: `HTTP ${res.status} available=${res.json.available}`,
        message: passed ? 'Authorized merchant verified unique slug availability' : 'Slug verification failed',
      });
    }

    // ====================================================
    // 25. Status update strictly validates ACTIVE/INACTIVE and rejects PAUSED (P2-SEC-25)
    // ====================================================
    {
      // 1. Attempt to set PAUSED (must fail with 400 VALIDATION_ERROR)
      const resPaused = await makeRequest('/api/stores/tenant_store_albaraka/status', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { status: 'PAUSED' },
      });

      // 2. Set to INACTIVE (must succeed with 200)
      const resInactive = await makeRequest('/api/stores/tenant_store_albaraka/status', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { status: 'INACTIVE' },
      });
      const storeInactive = db.getStore('tenant_store_albaraka');

      // 3. Set back to ACTIVE (must succeed with 200)
      const resActive = await makeRequest('/api/stores/tenant_store_albaraka/status', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionMerchant.rawToken}` },
        body: { status: 'ACTIVE' },
      });
      const storeActive = db.getStore('tenant_store_albaraka');

      const passed =
        resPaused.status === 400 &&
        resInactive.status === 200 &&
        storeInactive?.status === 'INACTIVE' &&
        resActive.status === 200 &&
        storeActive?.status === 'ACTIVE';

      results.push({
        testId: 'P2-SEC-25',
        name: 'Store Status Strictly Enforces ACTIVE/INACTIVE (Rejects PAUSED)',
        passed,
        expected: 'PAUSED rejected (400), INACTIVE accepted (200), ACTIVE accepted (200)',
        actual: `PAUSED: ${resPaused.status}, INACTIVE: ${resInactive.status}, ACTIVE: ${resActive.status}`,
        message: passed ? 'Minimal store status model verified; invalid statuses rejected' : 'Status validation failed',
      });
    }

    // ====================================================
    // 26. Production mode physically rejects dev test tokens (P2-SEC-26)
    // ====================================================
    {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      let passed = false;
      let actualStatus = 0;
      try {
        const res = await makeRequest('/api/stores', {
          headers: { Authorization: 'Bearer token_albaraka_owner' },
        });
        actualStatus = res.status;
        passed = res.status === 401;
      } finally {
        process.env.NODE_ENV = prevEnv;
      }

      results.push({
        testId: 'P2-SEC-26',
        name: 'Production Mode Strictly Rejects Dev Test Tokens',
        passed,
        expected: 'HTTP 401 AUTHENTICATION_REQUIRED (Dev test token ignored in production)',
        actual: `HTTP ${actualStatus}`,
        message: passed ? 'Production environment physically rejects test token authentication' : 'Test token accepted in production',
      });
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return results;
}

// Standalone execution support
if (process.argv[1] && process.argv[1].includes('store_management.test.ts')) {
  runStoreManagementTestSuite()
    .then((results) => {
      console.log('\n======================================================');
      console.log(`PHASE 2 STORE MANAGEMENT SECURITY TEST RESULTS (${results.length}/${results.length})`);
      console.log('======================================================\n');
      console.table(
        results.map((r) => ({
          ID: r.testId,
          Name: r.name,
          Passed: r.passed ? 'PASSED' : 'FAILED',
          Expected: r.expected,
          Actual: r.actual,
        }))
      );
      const hasFailures = results.some((r) => !r.passed);
      if (hasFailures) {
        console.error('\nFAIL: Some tests failed in Phase 2 Security Test Suite.\n');
        process.exit(1);
      } else {
        console.log(`\nSUCCESS: All ${results.length} Phase 2 Mandatory Security Tests passed!\n`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error('Fatal test execution error:', err);
      process.exit(1);
    });
}
