# PHASE 2 — PRE-IMPLEMENTATION AUDIT
## Merchant Dashboard & Store Management

**Date:** 2026-09-18  
**Author:** Senior Software Engineer  
**System:** SOODA SaaS E-Commerce Multi-Tenant Platform  
**Target Phase:** Phase 2 — Merchant Dashboard & Store Management  
**Status:** AUDIT COMPLETED / APPROVED FOR IMPLEMENTATION  

---

### 1. Executive Summary & Context

The platform has successfully passed **Phase 0 (Foundation / Architecture)** and **Phase 1 (Authentication & Account System)**. The database maintains ACID transactions via SQLite with foreign-key enforcement, cryptographic audit chaining with SHA-256 integrity validation, persistent sessions with SHA-256 hash-at-rest token lookups, and strict RBAC enforcement.

The objective of **Phase 2** is to implement the production-grade merchant dashboard foundation and store management capabilities. The central security invariant is:

$$\text{AUTHENTICATED USER} \longrightarrow \text{TENANT MEMBERSHIP} \longrightarrow \text{AUTHORIZED STORE} \longrightarrow \text{STORE MANAGEMENT OPERATION}$$

Client-controlled identity (such as query parameters, path variables, or custom headers) must **never** establish authority. Store access is governed exclusively through server-side verified persistent relationships.

---

### 2. Detailed Review of Existing Codebase & Assets

#### 2.1 Phase 0 & Phase 1 Architecture
- **Tenant Boundary:** The platform adopts the unified model where `Store` is the primary tenant unit. `tenantId` is an explicit foreign key pointing directly to `stores.id`. This provides logical partitioning across all tenant-scoped tables (`store_settings`, `store_themes`, `domains`, `tenant_memberships`, `audit_events`).
- **Users & Credentials:** The `users` table holds user records with `role` (`SystemRole`), `status` (`AccountStatus`), normalized email, and Argon2id password hash (`password_hash`, `password_algo`).
- **Authentication & Sessions:** Browser logins create an opaque 256-bit cryptographically secure session token stored as an `HttpOnly`, `SameSite=Strict`, `Path=/` cookie (`sooda_session`), hashed via SHA-256 before storage in the `sessions` table. Programmatic clients may use Bearer tokens via `/api/auth/token`.
- **RBAC Policy:** Defined in `/src/core/auth/policy.ts`. Maps `SystemRole` (`PLATFORM_ADMIN`, `MERCHANT_OWNER`, `MERCHANT_STAFF`, `STORE_CUSTOMER`) to granular `Permission` values. Platform admin permissions are strictly segregated and cannot be granted to merchant roles.
- **Tenant Resolution vs. Authorization:** In `TenantResolver` (`/src/core/tenant/index.ts`) and middleware in `server.ts`, resolving a tenant via host header, `x-tenant-id`, or slug creates a `TenantContext` where `isAuthorized` is explicitly set to `false`. Authorization requires evaluating the authenticated principal's memberships against the target store.
- **Audit Service:** `AuditLogService` (`/src/core/observability/index.ts`) implements fail-closed audit event persistence with SHA-256 cryptographic hash-chaining, tracking sequence number, previous hash, timestamp, actor ID/role, tenant ID, entity ID, action, and metadata.

#### 2.2 Existing Store & Tenant Model
1. **Store Entity (`src/core/domain/index.ts`, `stores` table):**
   - Columns: `id` (PK, string), `merchant_id` (FK to `merchants.id`), `slug` (UNIQUE text), `name_ar` (text), `name_en` (text), `status` (`'ACTIVE' | 'PAUSED' | 'ARCHIVED'`), `currency` (`SDG`), `timezone` (`Africa/Khartoum`), `created_at`, `updated_at`, `deleted_at`.
2. **StoreSettings Entity (`store_settings` table):**
   - Columns: `id` (PK), `tenant_id` (FK to `stores.id`), `store_id`, `contact_email`, `contact_phone`, `allow_guest_checkout`, `order_notification_phone`, `tax_enabled`, `tax_percentage`, `maintenance_mode`, `created_at`, `updated_at`, `deleted_at`.
3. **TenantMembership Entity (`tenant_memberships` table):**
   - Columns: `id` (PK), `user_id` (FK to `users.id`), `tenant_id` (FK to `stores.id`), `role` (`SystemRole`), `status` (`AccountStatus`), `created_at`, `updated_at`. Unique constraint on `(user_id, tenant_id)`.

#### 2.3 Existing API Routes & Middlewares
- `GET /api/health` — Platform status and active tenant counts.
- `GET /api/tenant/resolve` — Public storefront metadata resolution (no private settings).
- `POST /api/auth/login` — Browser session login (sets HttpOnly cookie).
- `POST /api/auth/token` — Programmatic Bearer token login.
- `POST /api/auth/logout` — Revokes session and evicts cookie.
- `GET /api/auth/me` — Returns authenticated user profile, role, tenantId, and memberships.
- `GET /api/auth/roles` — Platform admin permission matrix.
- `GET /api/tenant/settings` — Retrieves store settings for authorized tenant.
- `PATCH /api/tenant/settings` — Updates store settings for authorized tenant.
- `DELETE /api/tenant/settings` — Soft deletes store settings for authorized tenant.
- `GET /api/audit/recent` — Scoped audit logs.
- `GET /api/audit/verify-integrity` — Platform admin cryptographic verification.
- `GET /api/tenants` — Platform admin tenant list.

#### 2.4 Existing UI
- Current `App.tsx` contains platform architecture tabs (`architecture`, `tests`, `design-system`, `payments`, `routes`) used during Phase 0 and Phase 1 verification.
- UI components exist under `src/components/ui/`: `Button`, `Input`, `Card`, `Badge`, `Alert`, `Table`, `LoadingSpinner`.
- Arabic typography (Cairo font) and RTL/LTR switching are fully integrated via `I18nService`.

---

### 3. Gap Analysis for Phase 2

| Area | Current State | Required State for Phase 2 | Gap / Action |
| :--- | :--- | :--- | :--- |
| **Store Management Domain** | Minimal store queries in DB (`getStore`, `getStoreBySlug`, `listStores`). No store updating or membership-scoped queries. | Rich store management: `getStoresForUser`, `getStoreById`, `updateStore`, `updateStoreStatus`, slug validation & uniqueness check. | Add database methods, domain interfaces, and a dedicated `StoreManagementService`. |
| **Store Metadata Schema** | `stores` table lacks `description_ar`, `description_en`, and `default_locale`. | Support `description` (Arabic and English) and `default_locale` ('ar' \| 'en') directly on the store profile. | Create Migration 4 (`004_store_profile_enhancements`) to add `description_ar`, `description_en`, and `default_locale` columns. |
| **Store Scoped API** | No dedicated `/api/stores` or `/api/stores/:storeId` endpoints. | REST endpoints: `GET /api/stores`, `GET /api/stores/:storeId`, `PATCH /api/stores/:storeId`, `PATCH /api/stores/:storeId/status`. | Implement store management routes with strict authentication, membership validation, and audit logging. |
| **Slug Security & Immutability** | Slug exists but lacks normalization and strict validation routines. | Slug normalization (lowercase, kebab-case, 3-63 chars, no path traversal), collision checks against reserved words (e.g. `api`, `admin`, `app`, `auth`). | Build server-side `StoreSlugValidator` with reserved slug list and database uniqueness check. |
| **Store Management Authorization** | `requireTenantScope` accepts client-provided `targetTenantId` without verifying membership unless in service layer. | Route logic for store management must resolve user memberships directly from persistent database records. | Create `requireStoreMembership` middleware / policy check ensuring user has active membership on target store. |
| **Merchant Dashboard UI Shell** | `App.tsx` is an architectural inspection/test dashboard. | A production-grade merchant dashboard shell with sidebar navigation (Overview, Store Profile/Settings, and clear disabled/future markers for Products, Orders, Customers), active store switcher/context, Arabic RTL first-class, responsive layout, real API persistence. | Build `MerchantDashboard` component with store settings editor, status toggle, and real backend mutation handling. |
| **Audit Coverage** | `STORE_CREATED` and `STORE_UPDATED` in `AuditAction`, but missing `STORE_STATUS_CHANGED`. | Audit all store updates, slug updates, and store status changes with actor, tenant, changes, and fail-closed persistence. | Add `STORE_STATUS_CHANGED` to `AuditAction` and record tamper-evident audit entries on all store mutations. |
| **Tests** | Phase 0 and Phase 1 test suites exist. | Comprehensive test suite for Phase 2 verifying store retrieval, membership isolation, cross-tenant blocking, slug validation/collision, strict whitelist update semantics, status changes, and audit logs. | Create `src/tests/store_management.test.ts` and wire into `npm run test`. |

---

### 4. Technical Risks & Mitigations

1. **Risk: Cross-Tenant Store Enumeration & Manipulation**
   - *Risk:* An attacker authenticated as Tenant A tries to read or update `GET/PATCH /api/stores/:storeId` for Tenant B.
   - *Mitigation:* The server strictly queries `tenant_memberships` for `(user_id, targetStoreId)`. If no active membership exists (and caller is not `PLATFORM_ADMIN`), the server immediately rejects the request with HTTP 403 `TENANT_MISMATCH` (or 404 if store doesn't exist) and logs `CROSS_TENANT_ACCESS_BLOCKED` to the tamper-evident audit log.
2. **Risk: Mass Assignment / Ownership Hijacking in Store Update**
   - *Risk:* A merchant submits `{ id: "other_id", merchantId: "other_merchant", tenantId: "other" }` in the PATCH payload.
   - *Mitigation:* Server-side Zod validation with `.strict()` and an explicit whitelist of allowed update fields (`nameAr`, `nameEn`, `descriptionAr`, `descriptionEn`, `slug`, `currency`, `timezone`, `defaultLocale`, `contactEmail`, `contactPhone`). Fields like `id`, `merchantId`, `createdAt`, `updatedAt`, `deletedAt`, and `status` are strictly rejected.
3. **Risk: Slug Hijacking & URL Collision**
   - *Risk:* A merchant attempts to change their slug to an existing store's slug or a reserved system route (`api`, `admin`, `dashboard`, `auth`).
   - *Mitigation:* Reserved words list and database uniqueness check with SQLite transactions. Changing a slug affects public URLs, which is guarded and audited as a critical operation.
4. **Risk: Audit Log Failure Swallowing**
   - *Risk:* A store mutation succeeds but audit logging fails, leaving the action unrecorded.
   - *Mitigation:* In accordance with Phase 0/1 architectural rules, audit logging uses fail-closed semantics (`AuditPersistenceError` aborts transactions or returns HTTP 500).

---

### 5. Proposed Changes & File Modification Plan

1. **`src/core/domain/index.ts`**
   - Update `Store` interface with `descriptionAr?: string`, `descriptionEn?: string`, `defaultLocale?: 'ar' | 'en'`.
   - Update `StoreStatus` enum/type (`ACTIVE`, `INACTIVE` / `PAUSED`).
2. **`src/core/database/index.ts`**
   - Add Migration 4 (`004_store_profile_enhancements`) to alter `stores` table:
     - `description_ar TEXT`
     - `description_en TEXT`
     - `default_locale TEXT NOT NULL DEFAULT 'ar'`
   - Implement database store methods:
     - `getStoresForUser(userId: string): Store[]`
     - `getUserStoreMembership(userId: string, storeId: string): TenantMembership | null`
     - `updateStore(id: string, updates: Partial<Store>): Store`
     - `isSlugAvailable(slug: string, currentStoreId?: string): boolean`
3. **`src/core/observability/index.ts`**
   - Add `STORE_STATUS_CHANGED = 'STORE_STATUS_CHANGED'` to `AuditAction`.
4. **`src/core/services/store.service.ts` (New)**
   - Encapsulate store management domain logic, authorization assertion, slug validation, field whitelisting, settings synchronization, and audit logging.
5. **`server.ts`**
   - Add Phase 2 endpoints:
     - `GET /api/stores` — List authorized stores for authenticated user.
     - `GET /api/stores/:storeId` — Get store details (store profile + settings) for authorized store.
     - `PATCH /api/stores/:storeId` — Update store profile & contact settings with strict whitelist.
     - `PATCH /api/stores/:storeId/status` — Activate/deactivate store status with audit.
     - `GET /api/stores/check-slug` — Query slug availability.
6. **`PHASE_2_ROUTE_SECURITY_MATRIX.md` (New)**
   - Full documentation of all Phase 2 endpoints, authentication, roles, tenant membership checks, validation schemas, and expected failure behaviors.
7. **`src/components/dashboard/` (New UI components)**
   - `MerchantDashboard.tsx` — Main dashboard layout with header, store switcher, navigation tabs, and content area.
   - `StoreProfileView.tsx` — Store basic information, slug editor, language/currency/timezone selectors, contact information, and store status toggle.
   - `DashboardOverview.tsx` — Clean merchant overview shell displaying store status, quick links, and clear non-fake indicators.
8. **`src/App.tsx`**
   - Integrate authenticated merchant dashboard experience with login/logout support and persistent session restoration.
9. **`src/tests/store_management.test.ts` (New)**
   - Full automated test suite verifying all Phase 2 requirements, authorization gates, and audit records.
10. **`package.json`**
    - Add `test:stores` script and update `test` pipeline.

---

### 6. Audit Conclusion

The existing architecture provides a clean, well-factored foundation for Phase 2. Implementing store management via a dedicated domain service and secure API routes adheres strictly to the central security invariant without duplicating abstractions or expanding scope into future phases.
