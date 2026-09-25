# PHASE 2 — ROUTE SECURITY MATRIX
## Merchant Dashboard & Store Management Endpoints

**Date:** 2026-09-18  
**Author:** Senior Software Engineer  
**Security Invariant:**  
$$\text{AUTHENTICATED USER} \longrightarrow \text{TENANT MEMBERSHIP} \longrightarrow \text{AUTHORIZED STORE} \longrightarrow \text{STORE MANAGEMENT OPERATION}$$

---

### Endpoint Matrix

| Method | Endpoint | Access Level | Authentication | Allowed Roles | Tenant / Store Authorization Constraint | Request Validation | Audit Event Emitted | Expected Rejection Responses |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/stores` | Protected | Session Cookie (`sooda_session`) or Bearer Token | `MERCHANT_OWNER`, `MERCHANT_STAFF`, `PLATFORM_ADMIN` | Derived server-side from active `tenant_memberships` associated with `user.id`. Platform Admin retrieves all platform stores. | None (ignores client-supplied tenant params). | None (read query) | 401 `AUTHENTICATION_REQUIRED`<br>403 `FORBIDDEN` (if `STORE_CUSTOMER`) |
| `GET` | `/api/stores/:storeId` | Protected | Session Cookie or Bearer Token | `MERCHANT_OWNER`, `MERCHANT_STAFF`, `PLATFORM_ADMIN` | Caller must possess an active `tenant_membership` where `tenant_id === storeId` (or `PLATFORM_ADMIN`). Client cannot forge authorization via path param. | `storeId`: `^[a-z0-9_-]{1,64}$` | `TENANT_SETTINGS_ACCESSED` (if sensitive) | 401 `AUTHENTICATION_REQUIRED`<br>404 `NOT_FOUND` (if store doesn't exist)<br>403 `TENANT_MISMATCH` (cross-tenant)<br>403 `FORBIDDEN` (`STORE_CUSTOMER`) |
| `PATCH` | `/api/stores/:storeId` | Protected | Session Cookie or Bearer Token | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Caller must possess an active `tenant_membership` with role `MERCHANT_OWNER` on `storeId` (or `PLATFORM_ADMIN`). Staff access denied. | Strict Zod schema. Rejects unknown keys and protected fields (`id`, `merchantId`, `status`, `createdAt`, `updatedAt`, `deletedAt`). Validates: `nameAr`, `nameEn`, `descriptionAr`, `descriptionEn`, `slug`, `currency`, `timezone`, `defaultLocale`, `contactEmail`, `contactPhone`. | `STORE_UPDATED` (with updated fields and actor details in tamper-evident chain) | 401 `AUTHENTICATION_REQUIRED`<br>403 `FORBIDDEN` (if `MERCHANT_STAFF` or `STORE_CUSTOMER`)<br>403 `TENANT_MISMATCH` (cross-tenant)<br>400 `VALIDATION_ERROR` (invalid input or prohibited fields)<br>409 `SLUG_ALREADY_EXISTS` (slug conflict) |
| `PATCH` | `/api/stores/:storeId/status` | Protected | Session Cookie or Bearer Token | `MERCHANT_OWNER`, `PLATFORM_ADMIN` | Caller must possess an active `tenant_membership` on `storeId` with owner authority (or `PLATFORM_ADMIN`). | Strict payload: `{ status: 'ACTIVE' \| 'INACTIVE' }` (Phase 2 minimal lifecycle model). | `STORE_STATUS_CHANGED` (recording old & new status, actor, tenant) | 401 `AUTHENTICATION_REQUIRED`<br>403 `FORBIDDEN`<br>403 `TENANT_MISMATCH`<br>400 `VALIDATION_ERROR` |
| `GET` | `/api/stores/check-slug` | Protected | Session Cookie or Bearer Token | `MERCHANT_OWNER`, `MERCHANT_STAFF`, `PLATFORM_ADMIN` | Caller must be authenticated merchant/admin. If `currentStoreId` is provided, caller must have active membership on `currentStoreId`. Prevents cross-tenant slug availability enumeration. | Query params: `slug` (string, 3-63 chars, valid slug regex), optional `currentStoreId` (string). | `CROSS_TENANT_ACCESS_BLOCKED` (if caller probes unauthorized store ID) | 401 `AUTHENTICATION_REQUIRED`<br>403 `FORBIDDEN` (if `STORE_CUSTOMER`)<br>403 `TENANT_MISMATCH` (if unauthorized `currentStoreId`)<br>400 `INVALID_INPUT` (malformed slug syntax) |

---

### Detailed Endpoint Security Specifications

#### 1. `GET /api/stores`
- **Purpose:** Return the list of stores that the authenticated user is authorized to manage.
- **Authorization Enforcement:** The endpoint executes:
  ```sql
  SELECT s.* FROM stores s
  INNER JOIN tenant_memberships tm ON tm.tenant_id = s.id
  WHERE tm.user_id = ? AND tm.status = 'ACTIVE' AND s.deleted_at IS NULL
  ```
  If caller is `PLATFORM_ADMIN`, all active stores are returned.
- **Client Forgery Defense:** The endpoint takes **zero** tenant input from the request body or query. It is impossible for a user to query another merchant's stores.

#### 2. `GET /api/stores/:storeId`
- **Purpose:** Retrieve full store details and settings for the specified store.
- **Authorization Enforcement:**
  1. Validates `storeId` format (`^[a-z0-9_-]{1,64}$`).
  2. Queries store from database. Returns 404 `NOT_FOUND` if nonexistent.
  3. If caller is not `PLATFORM_ADMIN`, verifies persistent active membership:
     ```sql
     SELECT id, role, status FROM tenant_memberships
     WHERE user_id = ? AND tenant_id = ? AND status = 'ACTIVE'
     ```
  4. If no active membership is found, immediately logs `CROSS_TENANT_ACCESS_BLOCKED` to the tamper-evident audit log and returns HTTP 403 `TENANT_MISMATCH`.

#### 3. `PATCH /api/stores/:storeId`
- **Purpose:** Mutate authorized store profile attributes and contact settings.
- **Authorization Enforcement:** Requires `Permission.STORE_MANAGE_SETTINGS`. Restricted to `MERCHANT_OWNER` of the store and `PLATFORM_ADMIN`.
- **Field Whitelist & Mass Assignment Prevention:**
  - Allowed fields:
    - `nameAr` (2-100 characters, trimmed)
    - `nameEn` (2-100 characters, trimmed)
    - `descriptionAr` (optional, 0-500 characters)
    - `descriptionEn` (optional, 0-500 characters)
    - `slug` (normalized, 3-63 characters, kebab-case, uniqueness verified)
    - `currency` (ISO currency code, e.g. 'SDG', 'USD')
    - `timezone` (valid IANA timezone string)
    - `defaultLocale` ('ar' | 'en')
    - `contactEmail` (valid email format)
    - `contactPhone` (valid phone format)
  - Forbidden fields: Any attempt to supply `id`, `merchantId`, `tenantId`, `status`, `createdAt`, `updatedAt`, `deletedAt`, or any unlisted key results in immediate rejection with HTTP 400 `VALIDATION_ERROR`.
- **Slug Security:** If `slug` is updated:
  1. Normalization: lowercase, trimmed.
  2. Regex: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
  3. Reserved word check: Rejected if slug matches system routes (`api`, `admin`, `dashboard`, `auth`, `login`, `register`, `store`, `static`, `assets`).
  4. Uniqueness check: Verified against `stores` table excluding current `storeId`.
- **Audit Logging:** Emits `STORE_UPDATED` with previous and new values in the tamper-evident cryptographic hash chain. Fail-closed: if audit writing fails, the mutation is aborted.

#### 4. `PATCH /api/stores/:storeId/status`
- **Purpose:** Update store lifecycle status (`ACTIVE` vs `INACTIVE`).
- **Authorization Enforcement:** Restricted to `MERCHANT_OWNER` of the store and `PLATFORM_ADMIN`.
- **Validation:** Strict minimal model: only accepted values are `'ACTIVE'` and `'INACTIVE'`. `'PAUSED'` or `'ARCHIVED'` are rejected with HTTP 400 `VALIDATION_ERROR`.
- **Audit Logging:** Emits `STORE_STATUS_CHANGED` with `oldStatus`, `newStatus`, `actorId`, `tenantId`.

#### 5. `GET /api/stores/check-slug`
- **Purpose:** Utility check for slug availability in merchant management UI.
- **Authorization Enforcement:** Requires authenticated merchant or platform admin (`MERCHANT_OWNER`, `MERCHANT_STAFF`, `PLATFORM_ADMIN`). Denies `STORE_CUSTOMER` with HTTP 403 `FORBIDDEN`.
- **Cross-Tenant Protection:** If `currentStoreId` query param is provided, verifies that caller has active membership on `currentStoreId` (or is `PLATFORM_ADMIN`). If a tenant attempts to specify a foreign store ID, immediately logs `CROSS_TENANT_ACCESS_BLOCKED` and returns HTTP 403 `TENANT_MISMATCH`.
- **Validation:** Validates candidate slug against syntax rules, reserved words, and database collisions.
