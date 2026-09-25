# PHASE 2 — STORE ARCHITECTURE SPECIFICATION
## Merchant Dashboard & Store Management Domain Design

**System:** SOODA SaaS E-Commerce Multi-Tenant Platform  
**Phase:** Phase 2 — Merchant Dashboard & Store Management  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-09-18  

---

### 1. Architectural Invariants

Phase 2 governs the merchant's view and control of store operations. It is founded on five uncompromising architectural invariants:

1. **Authoritative Identity Invariant:**
   $$\text{Client-controlled identity MUST NEVER establish authority.}$$
   Any client attempt to supply identity or tenancy headers (`X-User-Id`, `X-Tenant-ID`, query string `?tenantId=...`, or body fields) is ignored or rejected. Authority is established strictly through server-verified, cryptographic session cookies (`sooda_session`) mapped to persistent database memberships.

2. **Resolution vs. Authorization Separation:**
   Resolving a store slug (e.g. `GET /api/tenant/resolve?slug=albaraka`) produces an **unauthorized** storefront context. Management operations (`/api/stores/*`) require explicit, positive authorization through `tenant_memberships`:
   $$\text{User} \longrightarrow \text{TenantMembership} \ (\text{status} = \text{'ACTIVE'}) \longrightarrow \text{Store}$$

3. **Mass-Assignment Immunity:**
   Database update payloads are passed through strict Zod schemas (`.strict()`). The schema acts as a compile-time and runtime whitelist: primary keys (`id`, `merchantId`, `tenantId`), ownership records, audit stamps (`createdAt`, `updatedAt`, `deletedAt`), and lifecycle status cannot be modified via profile update endpoints.

4. **Fail-Closed Transactional Audit Logging:**
   All mutations (`STORE_UPDATED`, `STORE_STATUS_CHANGED`) are executed inside atomic database transactions (`db.transaction(...)`). The cryptographic audit record is appended *within the transaction boundary*. If the audit log service fails or throws (`AuditPersistenceError`), the database transaction is rolled back, guaranteeing zero partial or un-audited state mutations.

5. **Currency Abstraction Preservation:**
   All business logic respects the Phase 0 currency abstraction (`CurrencyManager`). The default currency is `SDG` (Sudanese Pound). All currency updates are validated through `CurrencyManager.getCurrency(code)` against the currency registry, preventing hardcoding throughout the domain.

---

### 2. Domain Model & Entities

```
+-----------------------------------+
|              users                |
| id (PK)                           |
| email, role, status               |
+-----------------------------------+
                  ^
                  | 1:N
+-----------------------------------+        1:N        +-----------------------------------+
|        tenant_memberships         | ----------------> |              stores               |
| id (PK)                           |                   | id (PK, tenant boundary)          |
| user_id (FK -> users.id)          |                   | merchant_id (FK -> merchants.id)  |
| tenant_id (FK -> stores.id)       |                   | slug (UNIQUE)                     |
| role (MERCHANT_OWNER | STAFF)     |                   | name_ar, name_en                  |
| status (ACTIVE | SUSPENDED)       |                   | status (ACTIVE | INACTIVE | PAUSED)|
+-----------------------------------+                   | currency (SDG default)            |
                                                        | timezone, default_locale          |
                                                        +-----------------------------------+
                                                                          |
                                                                          | 1:1
                                                                          v
                                                        +-----------------------------------+
                                                        |          store_settings           |
                                                        | id (PK)                           |
                                                        | tenant_id (FK -> stores.id)       |
                                                        | contact_email, contact_phone      |
                                                        | allow_guest_checkout              |
                                                        | order_notification_phone          |
                                                        | tax_enabled, tax_percentage       |
                                                        +-----------------------------------+
```

#### Entity Definitions

- **Store:**
  The fundamental tenant isolation boundary. The `id` is a unique immutable identifier (e.g. `tenant_store_albaraka`). The `slug` is a globally unique, URL-safe string conforming to `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- **StoreSettings:**
  Tenant-scoped operational settings referencing `tenant_id` (`stores.id`). Stores contact email, contact phone, checkout permissions, and tax configuration.
- **TenantMembership:**
  Explicit junction associating an authenticated user with a tenant store. Roles:
  - `MERCHANT_OWNER`: Full store management rights, profile mutation, and status transition rights.
  - `MERCHANT_STAFF`: Read access to store settings, operational view, but prohibited from modifying store settings or status.
  - `PLATFORM_ADMIN`: Global supervisory bypass across all stores with explicit platform audit logging.

---

### 3. Application Services & Business Logic

#### 3.1 `StoreManagementService` (`src/core/services/store.service.ts`)
Encapsulates all store read and mutation operations:

- `listStoresForUser(principal)`:
  Queries stores directly authorized by the caller's active memberships. For `PLATFORM_ADMIN`, returns all stores.
- `getStoreById(storeId, principal, traceId)`:
  Validates store existence and evaluates `AuthorizationPolicy.canManageStore(principal, storeId)`. If unauthorized, records `CROSS_TENANT_ACCESS_BLOCKED` to the audit log and throws `TenantMismatchError`.
- `updateStore(storeId, payload, principal, traceId)`:
  1. Authorizes caller with `Permission.STORE_MANAGE_SETTINGS` on `storeId`.
  2. Parses and validates input with `UpdateStoreSchema.strict()`.
  3. If `slug` is present: validates format, checks against `RESERVED_SLUGS`, and checks for database collisions via `StoreSlugValidator`.
  4. If `currency` is present: validates through `CurrencyManager.getCurrency(currency)`.
  5. Opens atomic transaction:
     - Updates `stores` table with allowed profile fields.
     - Updates `store_settings` table with allowed contact fields.
     - Writes `STORE_UPDATED` event via `AuditLogService.record(...)` with old and new values.
     - Commits transaction; on any error (validation, DB, or audit failure), automatically rolls back.
- `updateStoreStatus(storeId, payload, principal, traceId)`:
  1. Authorizes caller with `Permission.STORE_MANAGE_SETTINGS`.
  2. Parses status via `UpdateStoreStatusSchema.strict()`.
  3. Opens atomic transaction, applies status, records `STORE_STATUS_CHANGED` in audit log, and commits.

#### 3.2 `StoreSlugValidator`
Guarantees URL routing stability:
- Syntax: Lowercase alphanumeric with single hyphen separators (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
- Reserved platform words: Rejects slugs matching `admin`, `api`, `dashboard`, `auth`, `login`, `register`, `store`, `cart`, `checkout`, `settings`, `help`, etc.
- Collision prevention: Executes parameterized check `SELECT id FROM stores WHERE slug = ? AND id != ?`.

---

### 4. Currency Abstraction & Localization

- **Currency Management:**
  The platform preserves the Phase 0 `CurrencyManager`. Currency codes must exist in `SYSTEM_CURRENCIES` (`SDG`, `USD`, `SAR`, `AED`). The default currency is strictly `SDG` (Sudanese Pound: `ج.س`).
- **Formatting:**
  Amounts are formatted according to locale:
  - Arabic (RTL): `١٥,٠٠٠ ج.س`
  - English (LTR): `SDG 15,000.00`
- **Internationalization (i18n):**
  Full bilingual support with Arabic as first-class primary:
  - Font: Cairo / sans-serif with proper typographic weights.
  - Direction: Explicit `dir="rtl"` and `dir="ltr"` container management.
  - UI labels, error messages, and form helpers provided in both Arabic and English.

---

### 5. UI Architecture: Merchant Dashboard

The merchant dashboard (`src/components/dashboard/MerchantDashboard.tsx`) is designed for operational reliability and accessibility:

1. **Dashboard Shell & Layout:**
   - Responsive, mobile-first sidebar/header layout.
   - Live store status badge (`ACTIVE` green, `PAUSED` yellow, `INACTIVE` gray).
   - Tenant switcher showing only stores authorized for the authenticated merchant.
   - Locale switcher (العربية / English) with instantaneous layout flip.

2. **Overview Tab:**
   - Quick telemetry: store status, default currency (`SDG`), primary timezone, contact email.
   - Fast status toggle (`Active` / `Paused`) with confirmation dialog and permission guard.

3. **Store Profile & Settings Tab:**
   - Bilingual store names (`nameAr`, `nameEn`) with validation feedback.
   - Store slug editor with real-time availability checking (`/api/stores/check-slug`).
   - Currency selection with fallback to `SDG`.
   - Contact email and phone inputs with regex validation.
   - Interactive feedback toasts on update success or failure.

4. **Security & Audit Log Tab:**
   - Scoped audit event viewer showing real-time ledger records for the current tenant.
   - Hash chain display (`SHA-256`) showing tamper-evident sequence numbers and actor IDs.
   - Verification status indicator.

5. **Security Test Suite Tab:**
   - One-click browser execution of the 20 Phase 2 mandatory security tests against the live API.
   - Tabular presentation of test results, assertions, expected vs. actual outcomes.
