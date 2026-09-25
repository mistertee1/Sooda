# Phase 0.3 Pre-Remediation Security & Architectural Audit

**Document Status**: COMPLETED AUDIT BEFORE REMEDIATION  
**Date**: 2026-09-12  
**Platform**: Sooda SaaS Commerce Platform (Phase 0 Foundation)  
**Auditor**: Independent Principal Security Architect & Code Reviewer  

---

## Executive Summary

An exhaustive independent source-code audit was conducted across `server.ts`, `src/core/*`, test suites, configuration management, and workspace artifacts. This audit identified four critical blockers and two architectural hygiene issues that violate the non-negotiable Phase 0 security and production-readiness requirements.

No Phase 1 business features (e.g. merchant onboarding UX, customer carts, orders, product catalogs, payments) were touched. Remediation is strictly focused on hardening foundation components, securing route boundaries, establishing deterministic audit integrity, and ensuring pristine repository hygiene.

---

## Findings Matrix

| Finding ID | Category | Severity | File | Route / Component | Summary |
|---|---|---|---|---|---|
| **AUD-01** | Route Exposure | HIGH | `server.ts` | `GET /api/tenants` | Tenant store registry publicly exposed without authentication or role check. |
| **AUD-02** | Information Leakage | HIGH | `server.ts` | `GET /api/audit/stream` | Audit log entries and integrity state exposed without authentication. |
| **AUD-03** | Test/Debug Route | HIGH | `server.ts` | `POST /api/tenant/test-isolation` | Toy test endpoint allowing arbitrary client-specified tenant parameters. |
| **AUD-04** | Production Route Pollution | HIGH | `server.ts` | `GET /api/tests/*` | Internal test suites exposed as HTTP routes in production routing table. |
| **AUD-05** | Audit Integrity Flaw | CRITICAL | `src/core/observability/index.ts` | `calculateHash()` & `verifyIntegrity()` | Audit hash ignores `resource`, `result`, `traceId`, `storeId`, `ipAddress`, `userAgent`, and `metadata`. |
| **AUD-06** | Repository Hygiene | MEDIUM | `/.gitignore` & `/data/sooda.db` | Storage Artifacts | Runtime SQLite database committed/stored as project content without `.gitignore` rules. |
| **AUD-07** | Secret Fail-Closed | MEDIUM | `src/core/config/index.ts` | `ConfigurationManager` | `sessionSecret` defaulted to static string even when running in production mode without explicit error. |
| **AUD-08** | Database Honesty | INFO | `src/core/database/index.ts` | Database Strategy | PostgreSQL documented as target without dedicated status matrix delineating SQLite dev vs. Postgres prod. |

---

## Detailed Issue Analysis & Remediation Plan

### AUD-01: Public Exposure of Tenant Registry (`GET /api/tenants`)
- **Current Issue**: The endpoint `GET /api/tenants` executes `db.listStores()` and returns active store metadata to any unauthenticated caller.
- **Exact File**: `server.ts:449-455`
- **Security Impact**: Information disclosure. Allows unauthenticated external actors to enumerate all merchants, store slugs, status, and tenant IDs on the platform.
- **Intended Remediation**: 
  - Restrict access to authenticated users with `SystemRole.PLATFORM_ADMIN` via `requireAuth, requireRole(SystemRole.PLATFORM_ADMIN)`.
  - For public tenant discovery, callers must continue using the existing, strictly whitelisted `GET /api/tenant/resolve?slug=<slug>` which exposes only public storefront styling/brand metadata.
- **Verification Method**: Automated HTTP test sending unauthenticated request to `GET /api/tenants` (expecting 401) and merchant request (expecting 403), while platform admin receives 200.

---

### AUD-02: Public Audit Stream Exposure (`GET /api/audit/stream`)
- **Current Issue**: `GET /api/audit/stream` returns recent audit events and integrity results with no authentication gate (`server.ts:458-467`).
- **Exact File**: `server.ts:458-467`
- **Security Impact**: Severe security telemetry leakage. Exposes actor IDs, roles, targeted tenant IDs, cross-tenant security block alerts, and trace IDs to unauthenticated clients.
- **Intended Remediation**:
  - Apply `requireAuth` and enforce tenant scoping:
    - If caller is `SystemRole.PLATFORM_ADMIN`, allow access to platform-wide events.
    - If caller is `SystemRole.MERCHANT_OWNER` or `SystemRole.MERCHANT_STAFF`, filter strictly by caller's `tenantId`.
    - Unauthenticated callers rejected with 401 `AUTHENTICATION_REQUIRED`.
- **Verification Method**: Automated HTTP tests asserting 401 for anonymous access, 403 for merchant attempting cross-tenant audit read, and 200 with scoped logs for authorized callers.

---

### AUD-03: Arbitrary Client-Controlled Tenant Isolation Endpoint (`POST /api/tenant/test-isolation`)
- **Current Issue**: `POST /api/tenant/test-isolation` accepts arbitrary `actorTenantId` and `targetTenantId` payloads in the JSON body, acting as an unauthenticated playground.
- **Exact File**: `server.ts:470-497`
- **Security Impact**: Deceptive testing and unnecessary attack surface. Real tenant isolation must be tested through authenticated API calls with token credentials, never through client-provided actor identity overrides.
- **Intended Remediation**: Completely remove `POST /api/tenant/test-isolation` from the server. Replace frontend demo trigger with authenticated API call tests.
- **Verification Method**: Assert `POST /api/tenant/test-isolation` returns 404 in production and development routing tables.

---

### AUD-04: Test Suite HTTP Endpoints in Server Router (`GET /api/tests/*`)
- **Current Issue**: Routes `/api/tests/phase0`, `/api/tests/security`, and `/api/tests/remediation` are registered unconditionally in `createApp()`.
- **Exact File**: `server.ts:500-539`
- **Security Impact**: Production route pollution, potential denial-of-service via resource-heavy automated test execution, and violation of the isolation principle between production runtime and test runners.
- **Intended Remediation**:
  - Enforce that `/api/tests/*` endpoints can NEVER be registered when `NODE_ENV === 'production'`.
  - Add fail-closed check: If `isProduction` is true, routes are strictly omitted from Express route registration.
  - If registered in dev/test, they must fail closed if environment detection is indeterminate.
  - Test suites must be primarily executed via CLI (`npm test`).
- **Verification Method**: HTTP integration test verifying that when `NODE_ENV=production`, `/api/tests/phase0` returns 404.

---

### AUD-05: Audit Hash Integrity Does Not Cover All Security-Sensitive Fields
- **Current Issue**: In `src/core/observability/index.ts`, `calculateHash()` computes:
  ```ts
  `${seq}|${timestamp}|${tenantId || 'NONE'}|${actorId}|${actorRole}|${action}|${entityType}|${entityId}|${previousHash}`
  ```
  It completely ignores:
  - `resource`
  - `result`
  - `traceId`
  - `storeId`
  - `ipAddress`
  - `userAgent`
  - `metadata`
- **Exact File**: `src/core/observability/index.ts:325-338` & `verifyIntegrity():486-495`
- **Security Impact**: Tamper-evidence bypass. An attacker with database access can modify the outcome (`result`), target `resource`, `metadata`, `ipAddress`, or `traceId` without breaking the cryptographic chain!
- **Intended Remediation**:
  - Implement a dedicated canonical audit representation in `src/core/audit/canonical.ts`.
  - Canonicalization algorithm requirements:
    1. Deterministic sorting of metadata keys recursively.
    2. Explicit canonical formatting of null/undefined (`null` string, empty string omitted according to spec).
    3. Deterministic serialization of arrays (maintaining order).
    4. Numeric and boolean stable representations.
    5. UTF-8 byte encoding before SHA-256 calculation.
    6. Hash formula: `currentHash = SHA256(canonicalPayload + "|" + previousHash)`.
  - Update `verifyIntegrity()` to read all fields from persistent storage and canonicalize before hashing.
  - Update `getAllAuditEventsChronological()` in database layer to return all fields.
- **Verification Method**: Real tamper tests mutating metadata, resource, result, tenantId, actorId, and previousHash, confirming that verification detects the tampering and fails closed.

---

### AUD-06: Unmanaged Runtime SQLite Database File (`data/sooda.db`)
- **Current Issue**: A SQLite database file `data/sooda.db` is present in the workspace, and `.gitignore` lacks entries for database files.
- **Exact File**: `/.gitignore` & `/data/sooda.db`
- **Security Impact**: Polluting version control with ephemeral test/development runtime data; risks carrying test fixtures or dirty state across deployments.
- **Intended Remediation**:
  - Add `data/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`, and `*.sqlite` to `.gitignore`.
  - Remove committed/stale `data/sooda.db`.
  - Ensure `Database.getInstance()` initializes directory and schema idempotently on a fresh checkout without needing an existing DB.
- **Verification Method**: Delete `data/sooda.db`, run fresh start test verifying automatic directory creation, migration execution, and foundation seeding.

---

### AUD-07: Configuration Secret Fails Open in Production (`src/core/config/index.ts`)
- **Current Issue**: If `SESSION_SECRET` is unset in `NODE_ENV=production`, `serverConfigSchema` falls back to `'sooda-dev-session-secret-min-32-chars-key-2026'`.
- **Exact File**: `src/core/config/index.ts:74`
- **Security Impact**: Production instance boots with a predictable, publicly known development secret key.
- **Intended Remediation**:
  - In `ConfigurationManager`, if `isProd` and `process.env.SESSION_SECRET` is missing or default, throw a fatal `ConfigurationError` and fail closed immediately.
- **Verification Method**: Unit test verifying `ConfigurationManager` instantiation fails closed in production when `SESSION_SECRET` is unset.

---

### AUD-08: Database Strategy & Adapter Classification
- **Current Issue**: Need transparent, unambiguous documentation on the persistence layer status.
- **Exact File**: `PHASE_0_DATABASE_STATUS.md` (to be created) & `src/core/database/index.ts`
- **Intended Remediation**:
  - Create `PHASE_0_DATABASE_STATUS.md` documenting:
    - Current: SQLite persistent adapter (`SQLiteDatabaseAdapter`) for development, CI/CD, and single-instance environments.
    - Target: PostgreSQL adapter for multi-container horizontal scaling in Phase 1+.
    - Explicit statement: No fake PostgreSQL adapter will be generated.
    - Clean separation of `IDatabaseAdapter` boundary.
- **Verification Method**: Independent review verifying contract separation and absence of mock/fake Postgres adapters.

---

## Pre-Remediation Verification Baseline
- Current tests: 14 Security Integration tests + 15 Blocker Remediation tests pass.
- Known blockers identified above must be resolved without breaking architectural boundaries or expanding functional scope into Phase 1.
