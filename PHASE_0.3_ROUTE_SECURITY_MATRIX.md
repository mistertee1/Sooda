# PHASE 0.3 — HTTP API ROUTE SECURITY MATRIX
**Sooda SaaS E-Commerce Platform**  
**Phase:** 0.3 / 0.4 Foundation Gate  
**Security Posture:** Zero-Trust, Multi-Tenant Isolated, Fail-Closed  
**Generated & Verified:** September 2026

---

## 1. Overview & Security Architecture

The Sooda platform employs a **defense-in-depth security pipeline** for all incoming HTTP requests. Every request traversing `/api/*` passes through sequential security middleware stages before reaching application logic:

1. **Payload Size Guard:** Request body constrained to 1MB (`express.json({ limit: '1mb' })`) preventing payload-bomb memory exhaustion.
2. **Hardened HTTP Headers:** RFC-compliant headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000`, and `Permissions-Policy`. Obsolete mechanisms (`X-XSS-Protection`) are purged.
3. **Trace Correlation:** Unique `X-Trace-Id` generated or propagated on every request and recorded in audit events.
4. **Token Bucket Rate Limiting:** 100 req/min per IP (`MemoryRateLimitStore` / `RateLimiter`), emitting `Retry-After` on exhaustion and auditing `RATE_LIMIT_TRIGGERED`.
5. **Tenant Context Resolution:** Stage 1 resolves tenant from domain/subdomain/header without trusting client identity.
6. **Authentication & Principal Extraction:** Stage 2 extracts cryptographic Bearer token via `AuthenticationService.verifyToken()`.
7. **RBAC & Cross-Tenant Boundary Enforcement:** `requireAuth`, `requireRole(...)`, and `requireTenantScope` enforce role capabilities and strict tenant isolation.
8. **Fail-Closed 404 Catch-All:** Any unmounted or unknown route under `/api/*` immediately returns JSON 404.

---

## 2. Comprehensive Route Security Matrix

| # | HTTP Method | Route Path | Authentication | Allowed Roles | Tenant Scope | Production Availability | Sensitive Data Exposure | Rate Limiting | Authorization Mechanism & Defenses |
|---|---|---|---|---|---|---|---|---|---|
| **01** | `GET` | `/api/health` | **Public** (None) | `ANONYMOUS`, All | Global / Platform | **Active (Prod & Dev)** | None. Exposes platform status, version, store count, default currency. Zero credentials or tenant secrets. | Active (100 req/min) | Unrestricted public probe. Read-only health check. |
| **02** | `GET` | `/api/tenant/resolve` | **Public** (None) | `ANONYMOUS`, All | Tenant Storefront (Public) | **Active (Prod & Dev)** | None. Exposes public storefront metadata (`name`, `slug`, `currency`, `domain`, `status`). Zero private tenant configurations, secrets, or banking data. | Active (100 req/min) | Input validation via regex `/^[a-z0-9_-]+$/i` rejecting injection attacks. Segregated via `StorefrontService.resolvePublicStorefront()`. |
| **03** | `GET` | `/api/auth/roles` | **Bearer Token** | `PLATFORM_ADMIN` | Global / Platform | **Active (Prod & Dev)** | Medium. Exposes full platform RBAC permission matrix. | Active (100 req/min) | `requireAuth` + `requireRole(PLATFORM_ADMIN)`. Merchant or anonymous attempts return 401/403 and trigger `UNAUTHORIZED_ACCESS_BLOCKED` audit log. |
| **04** | `GET` | `/api/tenant/settings` | **Bearer Token** | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Strict Tenant Isolation (`req.principal.tenantId === targetTenantId` or Platform Admin) | **Active (Prod & Dev)** | High. Exposes tenant operational settings, support email, contact phone, and configuration. | Active (100 req/min) | `requireAuth` + `requireTenantScope` + `TenantSettingsService.getSettings()`. Forged `x-tenant-id` or query param triggers `CROSS_TENANT_ACCESS_BLOCKED` and returns 403 `TENANT_MISMATCH`. |
| **05** | `PATCH` | `/api/tenant/settings` | **Bearer Token** | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Strict Tenant Isolation (`req.principal.tenantId === targetTenantId` or Platform Admin) | **Active (Prod & Dev)** | High. Mutates tenant operational configuration. | Active (100 req/min) | `requireAuth` + `requireTenantScope` + `TenantSettingsService.updateSettings()`. Audit logged with before/after state. Cross-tenant mutation blocked with 403 `TENANT_MISMATCH`. |
| **06** | `DELETE` | `/api/tenant/settings` | **Bearer Token** | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Strict Tenant Isolation (`req.principal.tenantId === targetTenantId` or Platform Admin) | **Active (Prod & Dev)** | High. Soft-deletes tenant operational configuration. | Active (100 req/min) | `requireAuth` + `requireTenantScope` + `TenantSettingsService.deleteSettings()`. Audit logged. Cross-tenant deletion blocked with 403 `TENANT_MISMATCH`. |
| **07** | `GET` | `/api/audit/recent` | **Bearer Token** | `PLATFORM_ADMIN`, `MERCHANT_OWNER` | Multi-Level: Global for Platform Admin; strictly scoped to `req.principal.tenantId` for Merchant | **Active (Prod & Dev)** | Medium-High. Exposes recent security audit log events. | Active (100 req/min) | `requireAuth` + role-based partitioning. Platform Admin sees platform-wide events; Merchant sees only their own tenant events. Missing tenant context returns 403 `FORBIDDEN`. |
| **08** | `GET` | `/api/audit/stream` | **Bearer Token** | `PLATFORM_ADMIN`, `MERCHANT_OWNER` | Multi-Level: Global for Platform Admin; strictly scoped to `req.principal.tenantId` for Merchant | **Active (Prod & Dev)** | Medium-High. Exposes live audit event stream. Cryptographic verification object is stripped for non-admins. | Active (100 req/min) | `requireAuth` + role-based partitioning. Non-admin principals have cryptographic verification suppressed (`integrity: null`). |
| **09** | `GET` | `/api/audit/verify-integrity` | **Bearer Token** | `PLATFORM_ADMIN` | Global Cryptographic Chain | **Active (Prod & Dev)** | Medium. Exposes SHA-256 chain verification status and error reports. | Active (100 req/min) | `requireAuth` + `requireRole(PLATFORM_ADMIN)`. Audit logged on invocation. Merchant or anonymous attempts return 401/403. |
| **10** | `GET` | `/api/tenants` | **Bearer Token** | `PLATFORM_ADMIN` | Global Tenant Registry | **Active (Prod & Dev)** | High. Exposes full platform tenant catalog. | Active (100 req/min) | `requireAuth` + `requireRole(PLATFORM_ADMIN)`. Merchant or anonymous attempts return 401/403. |
| **11** | `GET` | `/api/tests/phase0` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Phase 0 Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes unit/integration test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. Cannot be re-enabled by client flags, query params, or headers. |
| **12** | `GET` | `/api/tests/security` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Security Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes security test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. Cannot be re-enabled by client flags, query params, or headers. |
| **13** | `GET` | `/api/tests/remediation` | **Disabled in Prod** (Dev Only) | Development / Local | In-Memory Remediation Test Suite | **DISABLED IN PRODUCTION (404)** | None in Prod (404). Exposes remediation test results in dev. | Exempt in dev | Excluded completely from Express routing table when `NODE_ENV === 'production'`. Cannot be re-enabled by client flags, query params, or headers. |
| **14** | `POST` | `/api/tenant/test-isolation` | **DEPRECATED & PURGED** | None | N/A | **PURGED (404)** | None. Endpoint completely removed from server codebase. | N/A | Hardcoded removal from routing table. Returns 404 in all environments. |
| **15** | `ALL` | `/api/*` | **Catch-All Fail-Closed** | Any | N/A | **Active (Prod & Dev)** | None. Returns standard error JSON `{ error: { code: 'NOT_FOUND' } }`. | Active | Intercepts any unmapped API path and prevents accidental fallback to SPA static HTML index. |

---

## 3. Defense-in-Depth Cross-Tenant Isolation Details

### Case Study: Interception of Cross-Tenant Access (`/api/tenant/settings`)
1. Attacker authenticates with valid credentials as `user_merchant_albaraka_owner` (`tenant_id = 'tenant_store_albaraka'`).
2. Attacker sends `GET /api/tenant/settings?tenantId=tenant_store_nilecrafts` with header `x-tenant-id: tenant_store_nilecrafts`.
3. `requireAuth` validates the Bearer token and assigns `req.principal`.
4. `requireTenantScope` checks `req.principal.role`:
   - It is `MERCHANT_OWNER` (not `PLATFORM_ADMIN`).
5. `requireTenantScope` extracts `targetTenantId = 'tenant_store_nilecrafts'`.
6. `requireTenantScope` executes:
   ```ts
   if (req.principal.tenantId !== targetTenantId) {
     AuditLogService.getInstance().record({
       tenantId: targetTenantId,
       actorId: req.principal.id,
       actorRole: req.principal.role,
       action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
       ...
     });
     return res.status(403).json({
       success: false,
       error: { code: 'TENANT_MISMATCH', message: 'Cross-tenant access blocked.' }
     });
   }
   ```
7. Even if middleware were bypassed, `TenantSettingsService.getSettings()` performs an independent second-layer check:
   ```ts
   if (principal.role !== SystemRole.PLATFORM_ADMIN && principal.tenantId !== targetTenantId) {
     throw new SecurityBoundaryError('Tenant isolation violation', targetTenantId);
   }
   ```
8. The database query is never executed. An immutable audit record is appended to the SHA-256 hash chain with action `CROSS_TENANT_ACCESS_BLOCKED`.
9. The attacker receives HTTP `403 Forbidden` with error code `TENANT_MISMATCH`.

---

## 4. Production Fail-Closed Guarantee

Under `NODE_ENV=production`:
- Test routes (`/api/tests/phase0`, `/api/tests/security`, `/api/tests/remediation`) are **not registered** in the Express routing tree.
- Any request with headers such as `X-Enable-Tests: true`, query params `?enableTests=true`, or cookies `debug=1` will hit the `app.all('/api/*')` catch-all and return **HTTP 404 Not Found**.
- Client cannot induce the server to execute test suites in production.
- Test tokens (`token_platform_admin`, `token_albaraka_owner`) are strictly rejected in production (`allowTestTokens: false`), requiring real cryptographic HMAC signatures.
