# PHASE 1 — HTTP API ROUTE SECURITY MATRIX
**Sooda SaaS E-Commerce Platform**  
**Phase:** 1.0 — Authentication & Account System  
**Security Posture:** Zero-Trust, Server-Authoritative Identity, Fail-Closed  
**Generated & Verified:** September 2026

---

## 1. Overview & Security Architecture

The Sooda SaaS platform strictly decouples **Authentication** (identity verification) from **Authorization** (permissions & tenant boundaries). All authentication state is server-authoritative and backed by durable SQLite storage; the browser client is never trusted to declare user ID, role, tenant ID, or authentication state.

### Defense-in-Depth Request Pipeline

Every HTTP request traversing `/api/*` executes the following ordered security middleware pipeline:

1. **Payload Size Guard:** Request body is strictly limited to 1MB (`express.json({ limit: '1mb' })`) preventing payload-bomb memory exhaustion.
2. **Hardened HTTP Headers:** Enforces modern security headers:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: SAMEORIGIN`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - Obsolete, buggy mechanisms (`X-XSS-Protection`) are removed.
3. **Trace Correlation:** Generates or validates unique `X-Trace-Id` on each request, propagated to all log entries and audit records.
4. **Token Bucket Rate Limiting:** 100 requests per minute per IP address (`MemoryRateLimitStore` / `RateLimiter`). Emits RFC-compliant `Retry-After` headers and logs `RATE_LIMIT_TRIGGERED` audit events on exhaustion.
5. **Cookie Parsing:** Parses incoming cookies (`cookie-parser`) securely for HttpOnly session credentials.
6. **Tenant Context Extraction (Stage 1):** Resolves public storefront context from domain, subdomain, or explicit headers without trusting client identity.
7. **Authentication & Session Extraction (Stage 2):** 
   - Inspects HttpOnly `sooda_session` cookie first.
   - Falls back to `Authorization: Bearer <token>` for programmatic API callers.
   - Computes SHA-256 hash of opaque token to look up active database session.
   - Enforces TTL expiration (`expires_at > now`).
   - Validates account status (`ACTIVE` only; blocks `LOCKED`, `INACTIVE`, `SUSPENDED`).
   - Refreshes session `last_seen_at` touch timestamp.
   - Resolves authorized tenant memberships from `tenant_memberships` table.
   - Attaches immutable `req.principal` to request context.
8. **RBAC & Cross-Tenant Boundary Guards:**
   - `requireAuth`: Enforces that `req.principal` exists and is non-anonymous.
   - `requireRole(...)`: Validates that `req.principal.role` satisfies required permissions.
   - `requireTenantScope`: Enforces multi-tenant isolation; validates that caller is either `PLATFORM_ADMIN` or possesses an active membership for the target tenant. Cross-tenant access triggers `CROSS_TENANT_ACCESS_BLOCKED` and halts with 403 `TENANT_MISMATCH`.
9. **Fail-Closed 404 Catch-All:** Any unmounted `/api/*` route immediately halts with JSON 404, preventing inadvertent fallback to client-side SPA routing.

---

## 2. Comprehensive Route Security Matrix

| # | HTTP Method | Route Path | Authentication | Allowed Roles | Tenant Scope | Production Availability | Sensitive Data Exposure | Rate Limiting | Authorization Mechanism & Defenses |
|---|---|---|---|---|---|---|---|---|---|
| **01** | `POST` | `/api/auth/login` | **Public** (Credentials Body) | `ANONYMOUS`, All | Global / Tenant Independent | **Active (Prod & Dev)** | None. Issues `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=604800` cookie (`Secure` in prod). Raw session token is strictly withheld from JSON response (`authType: 'COOKIE'`). Password hashes and raw passwords never returned. | Active (100 req/min) | Argon2id verification with constant-time dummy verify on nonexistent users. Atomic database transaction commits session creation and `LOGIN_SUCCESS` audit event; rolls back completely on audit failure. Account lockout after 5 failed attempts (15-min lock). Inactive accounts rejected with 403 `ACCOUNT_INACTIVE`. Audit logs `LOGIN_SUCCESS`, `LOGIN_FAILURE`, or `ACCOUNT_LOCKED`. |
| **02** | `POST` | `/api/auth/token` | **Public** (Credentials Body) | `ANONYMOUS`, All | Global / Tenant Independent | **Active (Prod & Dev)** | Low. Returns opaque Bearer session token in JSON (`authType: 'BEARER'`) for programmatic API clients; sets NO cookies. | Active (100 req/min) | Programmatic client equivalent of `/api/auth/login`. Atomic transaction wraps session persistence and audit log. Enforces identical Argon2id hashing, dummy verify, and lockout controls. |
| **03** | `POST` | `/api/auth/logout` | **Session Token** (Cookie / Bearer) | Authenticated Users | Current Session | **Active (Prod & Dev)** | None. | Active (100 req/min) | Atomically marks session as `is_revoked = 1` in SQLite database and commits `SESSION_REVOKED` and `LOGOUT` audit records. Clears HttpOnly cookie with `SameSite=Strict`, `Path=/`. Subsequent requests with token return 401. |
| **04** | `GET` | `/api/auth/me` | **Session Token** (Cookie / Bearer) | Authenticated Users | User Context & Tenant Memberships | **Active (Prod & Dev)** | Low. Exposes authenticated principal (`id`, `email`, `fullName`, `role`, `status`, `memberships`). Password hashes strictly excluded. | Active (100 req/min) | `requireAuth`. Retrieves current verified identity from `req.principal`. Emits 401 `AUTHENTICATION_REQUIRED` if unauthenticated or session revoked. |
| **05** | `GET` | `/api/auth/roles` | **Session Token** (Bearer) | `PLATFORM_ADMIN` | Global / Platform | **Active (Prod & Dev)** | Medium. Exposes full platform RBAC capability matrix. | Active (100 req/min) | `requireAuth` + `requireRole(PLATFORM_ADMIN)`. Unauthorized calls return 403 `FORBIDDEN` and emit `UNAUTHORIZED_ACCESS_BLOCKED` audit log. |
| **06** | `GET` | `/api/health` | **Public** (None) | `ANONYMOUS`, All | Global / Platform | **Active (Prod & Dev)** | None. Exposes platform operational status, version, store count, default currency. | Active (100 req/min) | Read-only unauthenticated health check. |
| **07** | `GET` | `/api/tenant/resolve` | **Public** (None) | `ANONYMOUS`, All | Tenant Storefront (Public) | **Active (Prod & Dev)** | None. Exposes public storefront metadata (`name`, `slug`, `currency`, `domain`, `status`). Zero private tenant configurations, secrets, or banking data. | Active (100 req/min) | Regex input sanitization `/^[a-z0-9_-]+$/i` rejecting SQL injection or directory traversal. Isolated via `StorefrontService.resolvePublicStorefront()`. |
| **08** | `GET` | `/api/tenant/settings` | **Session Token** (Cookie / Bearer) | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Strict Tenant Isolation (`tenant_memberships` or Platform Admin) | **Active (Prod & Dev)** | High. Exposes tenant operational settings, support email, contact phone, and configuration. | Active (100 req/min) | `requireAuth` + `requireTenantScope` + `TenantSettingsService.getSettings()`. Forged tenant headers or query params trigger `CROSS_TENANT_ACCESS_BLOCKED` audit event and return 403 `TENANT_MISMATCH`. |
| **09** | `PATCH` | `/api/tenant/settings` | **Session Token** (Cookie / Bearer) | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Strict Tenant Isolation (`tenant_memberships` or Platform Admin) | **Active (Prod & Dev)** | High. Mutates tenant operational configuration. | Active (100 req/min) | `requireAuth` + `requireTenantScope` + `TenantSettingsService.updateSettings()`. Audit logged with before/after state. Cross-tenant mutation blocked with 403 `TENANT_MISMATCH`. |
| **10** | `DELETE` | `/api/tenant/settings` | **Session Token** (Cookie / Bearer) | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Strict Tenant Isolation (`tenant_memberships` or Platform Admin) | **Active (Prod & Dev)** | High. Soft-deletes tenant operational configuration. | Active (100 req/min) | `requireAuth` + `requireTenantScope` + `TenantSettingsService.deleteSettings()`. Audit logged. Cross-tenant deletion blocked with 403 `TENANT_MISMATCH`. |
| **11** | `GET` | `/api/audit/recent` | **Session Token** (Cookie / Bearer) | `PLATFORM_ADMIN`, `MERCHANT_OWNER` | Multi-Level: Global for Platform Admin; strictly scoped to verified tenant membership for Merchant | **Active (Prod & Dev)** | Medium-High. Exposes recent security audit log events. | Active (100 req/min) | `requireAuth` + role-based partitioning. Platform Admin accesses platform-wide events; Merchant accesses only events matching their verified tenant. Missing tenant context returns 403 `FORBIDDEN`. |
| **12** | `GET` | `/api/audit/stream` | **Session Token** (Cookie / Bearer) | `PLATFORM_ADMIN`, `MERCHANT_OWNER` | Multi-Level: Global for Platform Admin; strictly scoped to verified tenant membership for Merchant | **Active (Prod & Dev)** | Medium-High. Exposes live audit stream. Cryptographic chain verification details stripped for non-admins. | Active (100 req/min) | `requireAuth` + role-based partitioning. Non-admin principals have cryptographic verification suppressed (`integrity: null`). |
| **13** | `GET` | `/api/audit/verify-integrity` | **Session Token** (Cookie / Bearer) | `PLATFORM_ADMIN` | Global Cryptographic Chain | **Active (Prod & Dev)** | Medium. Exposes SHA-256 chain verification status and error reports. | Active (100 req/min) | `requireAuth` + `requireRole(PLATFORM_ADMIN)`. Tamper-evident audit chain validator. Non-admin or anonymous calls return 401/403. |
| **14** | `GET` | `/api/tenants` | **Session Token** (Cookie / Bearer) | `PLATFORM_ADMIN` | Global Tenant Catalog | **Active (Prod & Dev)** | High. Exposes full platform tenant catalog. | Active (100 req/min) | `requireAuth` + `requireRole(PLATFORM_ADMIN)`. Unauthorized calls return 401/403. |
| **15** | `GET` | `/api/tests/auth` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Auth Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes Phase 1 authentication test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. Cannot be enabled via headers, parameters, or environment overrides. |
| **16** | `GET` | `/api/tests/phase0` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Phase 0 Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes Phase 0 unit/integration test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. |
| **17** | `GET` | `/api/tests/security` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Security Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes security test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. |
| **18** | `GET` | `/api/tests/remediation` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Remediation Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes remediation test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. |
| **19** | `ALL` | `/api/*` | **Catch-All Fail-Closed** | Any | N/A | **Active (Prod & Dev)** | None. Returns standard error JSON `{ error: { code: 'NOT_FOUND' } }`. | Active | Intercepts any unmapped API path, preventing accidental fallback to frontend HTML. |

---

## 3. Authentication & Tenant Isolation Verification

### Cross-Tenant Interception Workflow (`requireTenantScope`)
1. User authenticates via `/api/auth/login` as `user_merchant_albaraka_owner` (`tenant_id = 'tenant_store_albaraka'`).
2. Server issues session token and establishes `tenant_memberships` in database.
3. User issues request `GET /api/tenant/settings?tenantId=tenant_store_nilecrafts` with `Authorization: Bearer <token>`.
4. `SessionService.validateSession` authenticates the token, retrieves the user, and attaches `req.principal` with memberships: `[{ tenantId: 'tenant_store_albaraka', role: 'MERCHANT_OWNER' }]`.
5. `requireTenantScope` checks if `req.principal.role === PLATFORM_ADMIN`:
   - Returns `false`.
6. `requireTenantScope` checks if `req.principal.memberships` includes `tenant_store_nilecrafts`:
   - Returns `false`.
7. `requireTenantScope` logs `CROSS_TENANT_ACCESS_BLOCKED` to the tamper-evident audit chain.
8. Request terminates immediately with HTTP 403 `TENANT_MISMATCH`. Target tenant data is never accessed or queried.
