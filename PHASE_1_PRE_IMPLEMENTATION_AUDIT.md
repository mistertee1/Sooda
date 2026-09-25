# Phase 1 Pre-Implementation Audit: Authentication & Account System

**Document Version:** 1.0.0  
**Phase:** Phase 1 — Authentication & Account System  
**Evaluation Standard:** Production-Grade SaaS Security & Multi-Tenancy  
**Date:** 2026-09-13  
**Status:** COMPLETE (MANDATORY GATE BEFORE IMPLEMENTATION)

---

## 1. Executive Summary

Phase 0 established the structural and architectural foundations for the Sooda SaaS E-Commerce Platform:
- Logical multi-tenant data partitioning in a persistent SQLite engine with enforced foreign keys (`PRAGMA foreign_keys = ON`).
- Cryptographically chained (SHA-256) tamper-evident audit logging verifying integrity from genesis to head on startup with strict fail-closed semantics.
- Application-level RBAC separating `PLATFORM_ADMIN`, `MERCHANT_OWNER`, `MERCHANT_STAFF`, and `STORE_CUSTOMER`.
- Modern security response headers, sliding-window IP rate limiting, and structured error responses suppressing internal details in production.

However, **Phase 0 contained an explicit authentication placeholder**: identity was resolved purely via a static development fixture (`DEV_TEST_PRINCIPALS_FIXTURE`) from Bearer tokens, which was locked out in production (`NODE_ENV === 'production'`) to prevent hardcoded backdoors.

Phase 1 establishes the **true production-grade authentication and account system**. This audit examines existing code, boundaries, gaps, risks, and maps the exact implementation requirements before modifying the codebase.

---

## 2. Existing Authentication-Related Code

### 2.1 `src/core/auth/index.ts`
- **`ROLE_PERMISSIONS`**: Complete mapping of `SystemRole` enum values to explicit `Permission` grants.
- **`AuthorizationPolicy`**: Static evaluation logic for `can(user, permission, targetTenantId)` and `assertAuthorized()`.
- **`AuthenticatedPrincipal`**: Interface defining an authenticated caller:
  ```typescript
  export interface AuthenticatedPrincipal {
    id: string;
    email: string;
    role: SystemRole;
    tenantId: string | null;
    fullName: string;
  }
  ```
- **`DEV_TEST_PRINCIPALS_FIXTURE`**: Static test identities (`token_platform_admin`, `token_albaraka_owner`, `token_nilecrafts_owner`).
- **`AuthenticationService.verifyToken(tokenHeader, options)`**: Extracts Bearer token. Returns `null` unconditionally in production. Resolves test fixture only in development/test.

### 2.2 `src/core/domain/index.ts`
- Defines `SystemRole` (`PLATFORM_ADMIN`, `MERCHANT_OWNER`, `MERCHANT_STAFF`, `STORE_CUSTOMER`).
- Defines `User` interface with scalar `tenantId?: string | null` and `isActive: boolean`.
- **Missing**: Password hash, password salt, credential algorithm metadata, login identifier normalization, account status taxonomy (`ACTIVE`, `INACTIVE`, `SUSPENDED`), and security metadata (failed logins, lockout timestamp, password changed timestamp).

### 2.3 `src/core/database/index.ts`
- **Migration 001 (`users` table)**:
  - Columns: `id`, `email`, `phone`, `full_name`, `role`, `is_active`, `preferred_language`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`.
  - Constraints: `id PRIMARY KEY`, `email UNIQUE`.
  - Indexes: `idx_users_email`, `idx_users_tenant`.
  - **Limitations**: No password columns; `email` uniqueness is case-sensitive and unnormalized; no `sessions` table; no `tenant_memberships` table.
- **Seed Data**: Populates `user_platform_admin`, `user_merchant_albaraka_owner`, `user_merchant_nilecrafts_owner`.

### 2.4 `server.ts`
- Stage 2 Middleware extracts `req.headers['authorization']` and assigns `req.principal`.
- Security guards: `requireAuth`, `requireRole`, `requireTenantScope`.
- **Missing**: Cookie parser, session lookup, login/logout routes, password verification, CSRF validation.

### 2.5 `src/modules/identity/index.ts`
- Contains stub `IIdentityModuleService` interface with placeholder methods (`getUserById`, `getUserByEmail`, `verifyToken`).

---

## 3. Existing Security Boundaries

| Boundary | Mechanism | Current Enforcement |
| :--- | :--- | :--- |
| **Request Size** | Express JSON & URL-encoded parser | `limit: '1mb'` |
| **Security Headers** | Custom middleware | `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, `Strict-Transport-Security`, `CSP` |
| **Rate Limiting** | `RateLimiter` + `MemoryRateLimitStore` | 100 requests / 60s window per IP on `/api` routes (429 on breach) |
| **Request Tracing** | `X-Trace-Id` generator | Unique trace ID per request, propagated to audit events |
| **RBAC Gate** | `requireRole(...allowedRoles)` | Compares `principal.role`; records `UNAUTHORIZED_ACCESS_BLOCKED` on failure (403) |
| **Tenant Boundary** | `requireTenantScope` | Compares `principal.tenantId` to target tenant; records `CROSS_TENANT_ACCESS_BLOCKED` (403) |
| **Audit Log** | `AuditLogService` (SHA-256 chained) | Full chain integrity check on startup; fails closed on write/read errors |
| **Error Handling** | `formatErrorResponse` + `AppError` | Suppresses internal error details and stack traces in production |

---

## 4. Existing Tenant Boundaries

The platform operates on a **Single Shared Database with Logical Partitioning** by `tenantId`:
1. **Tenant Identification**: `TenantResolver` detects store slug from hostname subdomain (`*.sooda.sd`), explicit `x-tenant-id` header, or query slug.
2. **Tenant Context Resolution**: Stage 1 middleware populates `req.tenantContext` with `isAuthorized: false`. Tenant resolution is strictly distinct from authorization.
3. **Tenant Ownership Assertion**: `TenantResolver.assertTenantOwnership` verifies that the caller's tenant ID matches the target tenant ID. Platform Admin is exempt.
4. **Data Isolation**: Storefront data (`/api/tenant/resolve`) exposes only public attributes. Private settings (`/api/tenant/settings`) are guarded by `requireTenantScope`.

---

## 5. Existing Roles and Privilege Taxonomy

| Role | Intended Scope | Capabilities | Limitations |
| :--- | :--- | :--- | :--- |
| **`PLATFORM_ADMIN`** | Platform-Wide | Manage tenants, inspect metrics, platform audit verification, all-tenant settings inspection. | Segregated from merchant store operations; cannot create store orders. |
| **`MERCHANT_OWNER`** | Single Tenant | Full store management: settings, theme, staff, products, orders, payment configurations. | Cannot access other merchants' tenants; cannot access platform admin endpoints. |
| **`MERCHANT_STAFF`** | Single Tenant | Store operations: products read/update, orders read/update. | Cannot modify store settings, themes, or banking configurations. |
| **`STORE_CUSTOMER`** | Storefront Shopper | View public catalog, checkout, view own order history. | Cannot access any merchant management or platform APIs. |

---

## 6. Gaps Identified

1. **G-1 (Missing Credential Architecture)**: No mechanism to store password hashes, salts, or cost parameters. Plaintext passwords must never be stored.
2. **G-2 (Missing Normalized Login Identifier)**: Case differences (e.g. `User@Example.com` vs `user@example.com`) can lead to duplicate accounts or login bypass without database-enforced normalized uniqueness.
3. **G-3 (Missing Persistent Session Store)**: No database table or model for server-managed sessions. Memory-only sessions would be lost across server restarts or clustered workers.
4. **G-4 (Conflated User-to-Tenant Relationship)**: The scalar `users.tenant_id` column ties a user permanently to one tenant. A distinct `tenant_memberships` table is needed to represent multi-tenant access, tenant-scoped roles, and tenant-level status.
5. **G-5 (Missing Authentication Endpoints)**: No HTTP endpoints for `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, or session inspection.
6. **G-6 (Account Enumeration Risk)**: No uniform error handling for failed authentication; distinct errors ("email not found" vs "bad password") allow attackers to enumerate users.
7. **G-7 (Missing Account Status Lifecycle)**: No enforcement of `ACTIVE`, `INACTIVE`, `SUSPENDED` account states blocking authentication.
8. **G-8 (Missing CSRF Strategy for Cookies)**: Cookie-based sessions require explicit `HttpOnly`, `SameSite`, and anti-CSRF token / custom header validation for mutating requests.
9. **G-9 (Lack of Auth-Specific Rate Limiting)**: Login endpoints require a much stricter rate limiter (5 attempts per minute) than the general 100/min API limiter to defend against credential stuffing.
10. **G-10 (Audit Action Gaps)**: Need explicit audit events: `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `SESSION_CREATED`, `SESSION_REVOKED`, `ACCOUNT_DISABLED`.

---

## 7. Security Risks and Attack Vectors

| Attack Vector | Threat Description | Prevention Strategy |
| :--- | :--- | :--- |
| **Credential Stuffing / Brute Force** | Automated dictionary attack against login. | Auth-specific rate limiting (5 attempts/min per IP/account) + exponential backoff + audit logging. |
| **Account Enumeration** | Timing or error message differences revealing valid emails. | Constant-time password verification (dummy hash on missing account) + generic `AUTHENTICATION_FAILED` (401). |
| **Session Fixation** | Attacker presets session ID before victim logs in. | Issue a fresh, random cryptographic session ID upon successful login; destroy prior session. |
| **Session Hijacking** | XSS or network eavesdropping stealing session tokens. | Store session token in `HttpOnly`, `Secure` (in prod), `SameSite=Lax` cookie + store only SHA-256 hash of token in DB. |
| **CSRF** | Malicious site triggers authenticated state-changing requests. | `SameSite=Lax` cookies + mandatory `X-Requested-With` or `X-CSRF-Token` header check on mutating methods (POST/PATCH/DELETE). |
| **Cross-Tenant Escalation** | Merchant A sends `x-tenant-id: tenant_b` in headers. | Identity and authorized tenants are strictly extracted from the server-side session; client headers never dictate authorization. |
| **Privilege Escalation** | Client passes `{ role: 'PLATFORM_ADMIN' }` in request body. | Roles are fetched exclusively from server database records; request body roles are ignored. |
| **Secret Leakage** | Password hashes or session tokens leaking into logs or errors. | Strip password hashes and tokens from all serialization, logs, errors, and audit metadata. |

---

## 8. Detailed Implementation Plan

### Step 1: Password Security Module (`src/core/security/password.ts`)
- Implement `PasswordService` using RFC 9106 **Argon2id** (`@node-rs/argon2`).
- Configurable parameters: `timeCost: 3`, `memoryCost: 65536` (64MB), `parallelism: 1`, `outputLen: 32`.
- Secure salt generation (16 cryptographically random bytes).
- Constant-time verification to eliminate timing side-channels.
- Dummy password hashing on non-existent users during login to prevent timing-based user enumeration.

### Step 2: Database Schema Migration 003 (`003_authentication_and_accounts`)
- Alter or migrate `users`:
  - Add `normalized_email` TEXT NOT NULL UNIQUE.
  - Add `password_hash` TEXT.
  - Add `password_algo` TEXT NOT NULL DEFAULT 'argon2id'.
  - Add `status` TEXT NOT NULL DEFAULT 'ACTIVE'.
  - Add `failed_login_attempts` INTEGER NOT NULL DEFAULT 0.
  - Add `locked_until` TEXT.
  - Add `last_login_at` TEXT.
- Create `sessions` table:
  - `id` TEXT PRIMARY KEY (UUID).
  - `user_id` TEXT NOT NULL (FK -> users).
  - `session_token_hash` TEXT NOT NULL UNIQUE (SHA-256 hash of opaque token).
  - `created_at` TEXT NOT NULL.
  - `expires_at` TEXT NOT NULL.
  - `last_seen_at` TEXT NOT NULL.
  - `ip_address` TEXT.
  - `user_agent` TEXT.
  - `is_revoked` INTEGER NOT NULL DEFAULT 0.
  - Indexes on `session_token_hash`, `user_id`, `expires_at`.
- Create `tenant_memberships` table:
  - `id` TEXT PRIMARY KEY.
  - `user_id` TEXT NOT NULL (FK -> users).
  - `tenant_id` TEXT NOT NULL (FK -> stores).
  - `role` TEXT NOT NULL.
  - `status` TEXT NOT NULL DEFAULT 'ACTIVE'.
  - `created_at` TEXT NOT NULL.
  - `updated_at` TEXT NOT NULL.
  - `UNIQUE(user_id, tenant_id)`.
- Update `seedFoundation()`:
  - Seed users with valid Argon2id hashed passwords.
  - Seed initial `tenant_memberships` for `user_merchant_albaraka_owner` and `user_merchant_nilecrafts_owner`.

### Step 3: Session Management Engine (`src/core/auth/session.ts`)
- Opaque session token generation using `crypto.randomBytes(32).toString('hex')` (256 bits of entropy).
- Database persists only the SHA-256 hash of the session token.
- Session lookup verifies:
  1. Token hash matches active session.
  2. `is_revoked === 0`.
  3. `expires_at > NOW`.
  4. Associated user `status === 'ACTIVE'`.
- Session invalidation (`revokeSession`, `revokeAllUserSessions`).
- Sliding window expiration update on activity.

### Step 4: Authentication Domain & Services
- Update `src/core/domain/index.ts` with `AccountStatus`, `TenantMembership`, `Session` interfaces.
- Update `src/core/observability/index.ts` with `AuditAction`:
  - `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `SESSION_CREATED`, `SESSION_REVOKED`, `ACCOUNT_DISABLED`.
- Update `src/core/auth/index.ts`:
  - Reusable server-side guards: `requireAuth`, `requireRole`, `requireTenantAccess`, `requirePlatformAdmin`.
  - Seamless fallback to `DEV_TEST_PRINCIPALS_FIXTURE` in non-production environments to keep Phase 0 regression tests green.

### Step 5: Authentication HTTP Endpoints (`server.ts`)
- Implement `cookie-parser` middleware.
- POST `/api/auth/login`:
  - Normalized email + password validation.
  - Auth rate-limiting check (5 attempts per minute).
  - Account status check (`ACTIVE`).
  - Session creation + rotation.
  - Sets `sooda_session` cookie (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=604800`).
  - Emits `LOGIN_SUCCESS` or `LOGIN_FAILURE` audit events.
  - Returns sanitized user profile and session token (for non-browser API clients).
- POST `/api/auth/logout`:
  - Revokes session in database.
  - Clears `sooda_session` cookie.
  - Emits `LOGOUT` and `SESSION_REVOKED` audit events.
- GET `/api/auth/me`:
  - Returns authenticated user details, role, authorized tenant memberships, and active tenant context.
- POST `/api/auth/switch-tenant`:
  - Validates that user has an active membership for the requested tenant.
  - Switches active tenant context for the session.

### Step 6: CSRF Defense
- For cookie-authenticated mutating requests (POST, PUT, PATCH, DELETE):
  - Enforce `SameSite=Lax` on cookie.
  - Require custom header `X-Requested-With: XMLHttpRequest` or `X-CSRF-Token` to defeat cross-site form submissions.

### Step 7: Automated Security & Regression Testing
- Create `src/tests/authentication.test.ts` covering all 11 mandatory categories.
- Ensure all 94 existing Phase 0 tests continue passing without regression.

---

## 9. Files Expected to Change

| File | Action | Purpose |
| :--- | :--- | :--- |
| `PHASE_1_PRE_IMPLEMENTATION_AUDIT.md` | CREATE | Complete pre-implementation audit report (this document). |
| `src/core/security/password.ts` | CREATE | Argon2id password hashing, salting, constant-time verification. |
| `src/core/auth/session.ts` | CREATE | Server-side session storage, token hashing, rotation, lifecycle. |
| `src/core/domain/index.ts` | MODIFY | Add AccountStatus, TenantMembership, Session, User credential types. |
| `src/core/database/index.ts` | MODIFY | Migration 003, session CRUD, membership CRUD, Argon2id seeded credentials. |
| `src/core/observability/index.ts` | MODIFY | Add Phase 1 security audit actions (`LOGIN_SUCCESS`, `LOGIN_FAILURE`, etc.). |
| `src/core/auth/index.ts` | MODIFY | Integrate session authenticator, tenant membership authorization. |
| `server.ts` | MODIFY | Mount cookie-parser, CSRF protection, auth routes (`/api/auth/*`), auth rate limiter. |
| `src/tests/authentication.test.ts` | CREATE | Comprehensive Phase 1 authentication and account test suite. |
| `package.json` | MODIFY | Add `test:auth` script and update `test` pipeline. |
| `PHASE_1_AUTHENTICATION_ARCHITECTURE.md` | CREATE | Architecture design documentation for Phase 1. |
| `PHASE_1_ROUTE_SECURITY_MATRIX.md` | CREATE | Detailed security decision matrix for all API routes. |
| `PHASE_1_SECURITY_REVIEW.md` | CREATE | Second-pass threat model and attacker-perspective review. |
| `ARCHITECTURE.md` | MODIFY | Update system architecture to document Phase 1 authentication. |

---

## 10. Audit Sign-Off

All existing components, boundaries, constraints, and risks have been mapped. The architecture preserves all Phase 0 security guarantees (zero plaintext secrets, fail-closed audit logging, strict tenant isolation, no test backdoors in production).

**Audit Status:** APPROVED TO PROCEED WITH PHASE 1 IMPLEMENTATION.
