# ADR 0002: Multi-Tenancy Isolation Architecture
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Tenant Boundary Enforcement  

## Context and Problem Statement
In a multi-tenant commerce architecture, tenant isolation is the primary security requirement. We must prevent:
1. Cross-tenant data leakage (merchant A accessing merchant B's catalog or orders).
2. Host/subdomain hijacking.
3. IDOR via forged request headers (`x-tenant-id`) or query parameters (`?tenantId=...`).
4. Conflation of *tenant identification* (routing hint) with *tenant authorization* (permission to read/write).

## Decision Drivers
- Non-bypassable boundary validation.
- Zero trust in client-supplied tenant headers or routing hints.
- Independent enforcement at multiple architectural layers (middleware, domain service, database).
- Audit trail for every blocked cross-tenant attempt.

## Decision Outcome
We adopted a **3-Layer Defense-in-Depth Multi-Tenancy Architecture**:

### Layer 1: HTTP Middleware Boundary (`server.ts`)
- `resolveTenantContext`: Resolves the tenant from domain, subdomain, or header solely as a context hint. Sets `isAuthorized: false`.
- `requireAuth`: Authenticates the caller via cryptographic Bearer token and assigns `req.principal`.
- `requireTenantScope`: Verifies that `req.principal.tenantId === targetTenantId`. Platform Admins are exempted; all other roles receive HTTP 403 `TENANT_MISMATCH` if a mismatch is detected, appending an immutable `CROSS_TENANT_ACCESS_BLOCKED` audit log.

### Layer 2: Domain Application Service Layer (`TenantSettingsService`)
- Domain application services explicitly assert caller authority before invoking repositories.
- Re-validates that non-admin callers operate exclusively on entities belonging to their authenticated `tenantId`.

### Layer 3: Database Data Access Layer (`BaseTenantRepository`)
- All tenant-scoped SQL queries inject `WHERE tenant_id = ? AND deleted_at IS NULL`.
- Foreign key constraints (`ON DELETE RESTRICT`) ensure referential integrity.

## Consequences
### Positive
- Cross-tenant access is structurally impossible even if one layer fails or is misconfigured.
- Automated tests (`SEC-04`, `SEC-05`, `SEC-12`, `REM-01..04`) continuously verify that forged headers and query parameters are blocked.
