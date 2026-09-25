# ADR 0003: Role-Based Access Control (RBAC) & Data Boundary Architecture
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Authorization Model  

## Context and Problem Statement
Sooda requires a fine-grained authorization model accommodating diverse personas:
- `PLATFORM_ADMIN`: Platform operators who manage system health, the tenant registry, and global audits.
- `MERCHANT_OWNER`: Business owners who configure stores, payment methods, and staff permissions for their store.
- `MERCHANT_STAFF`: Store employees who process orders and update inventory within their store.
- `CUSTOMER`: End shoppers who browse storefronts and place orders.
- `ANONYMOUS`: Public visitors browsing storefronts or checking platform health.

## Decision Drivers
- Strict prevention of horizontal privilege escalation (merchant to merchant).
- Strict prevention of vertical privilege escalation (merchant to platform admin).
- Explicit permission mapping (`ROLE_PERMISSIONS`) rather than hardcoded string comparisons.
- Full server-side enforcement on every protected endpoint.

## Decision Outcome
We established an authoritative RBAC matrix defined in `src/core/auth/index.ts`:

### Role Hierarchy & Separation
- **Platform Separation:** `PLATFORM_ADMIN` is strictly global and decoupled from individual tenant ownership.
- **Tenant Scoping:** `MERCHANT_OWNER` and `MERCHANT_STAFF` MUST possess a valid `tenantId` in their principal claims. They are strictly prohibited from accessing platform administration routes (`/api/auth/roles`, `/api/tenants`, `/api/audit/verify-integrity`).
- **Endpoint Enforcement:**
  - `requireRole(SystemRole.PLATFORM_ADMIN)` guards platform-level endpoints.
  - Attempted unauthorized access returns HTTP 403 `FORBIDDEN` and logs `UNAUTHORIZED_ACCESS_BLOCKED`.
- **Public Data Boundary:**
  - Public storefront metadata is segregated via `StorefrontService.resolvePublicStorefront()`.
  - Sensitive merchant settings (tax IDs, contact phone, payout configuration) are accessible only via authenticated, tenant-scoped endpoints (`/api/tenant/settings`).

## Consequences
### Positive
- Centralized role capability definition.
- Automated security integration tests (`SEC-02`, `SEC-03`, `SEC-14`, `SEC-15`) verify that unauthorized roles are denied with 401/403.
