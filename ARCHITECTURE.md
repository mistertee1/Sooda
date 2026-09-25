# Technical Architecture & Blueprint: Sooda SaaS Commerce Platform

**Document Version:** 1.3.0 (Phase 0.3 Final Security & Foundation Verification)  
**Classification:** Enterprise Engineering Architecture Document  
**Target Market:** Sudan & Regional Cross-Border Commerce  
**Platform Language Tier:** Arabic (Primary, RTL) & English (Secondary, LTR)  
**Base Currency:** SDG (Sudanese Pound)  

---

## 1. System Overview

**Sooda** is a multi-tenant Software-as-a-Service (SaaS) e-commerce infrastructure built specifically for merchants in Sudan. Inspired by high-reliability cloud commerce engines, Sooda provides merchants with independent digital storefronts, customized local branding, and Sudan-tailored operational workflows (cash, peer-to-peer bank transfers, SMS notifications, and local logistics) without shared cross-tenant security risks.

### Core Architectural Mandates
1. **Strict Multi-Tenant Isolation:** Zero data leakage across tenant boundaries across all tiers (network, application, and database).
2. **Tenant Resolution != Tenant Authorization:** Extracting a tenant from a hostname, subdomain, or header is purely an identity hint. It confers **zero authorization**. Access is granted only when the authenticated actor's verified credentials match the target tenant.
3. **Fail-Closed Security Posture:** Insecure defaults, missing secrets, unauthenticated callers, or tampered audit records fail closed immediately.
4. **Cryptographic Tamper-Evident Ledger:** All security, authentication, and state-modifying operations are appended to an immutable, SHA-256 hash-chained audit ledger with canonical JSON serialization.
5. **No Fabricated Services:** Architectural abstractions represent real systems. Database abstractions run genuine SQLite with real SQL queries and versioned migrations, ready for PostgreSQL in Phase 1 without fake mocks.

---

## 2. High-Level Platform Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Client Layer (Browser / Mobile)                    │
│      Arabic RTL / English LTR | Tailwind CSS v4 Primitives | Cairo      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTPS (Authorization: Bearer <token>)
                                     │ Host / Subdomain / x-tenant-id
┌────────────────────────────────────▼────────────────────────────────────┐
│                    Nginx / Cloud Run Reverse Proxy                      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Port 3000
┌────────────────────────────────────▼────────────────────────────────────┐
│                      Express Backend (server.ts)                        │
│  ├── Stage 1: Security Headers (CSP, nosniff, frame-ancestors, HSTS)    │
│  ├── Stage 2: Request Tracing & Correlation ID Injection (x-trace-id)   │
│  ├── Stage 3: Rate Limiting Defense (Sliding Window, 429 Fail-Closed)   │
│  ├── Stage 4: Tenant Resolution (Identifies context, isAuthorized:false)│
│  ├── Stage 5: Authentication (Bearer Token -> UserPrincipal)            │
│  ├── Stage 6: RBAC & Tenant Scope Enforcement (requireRole, scope)      │
│  └── Stage 7: Route Handlers & Safe Serialization                       │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
┌───────────────────▼──────────────┐   ┌──────────────▼──────────────────┐
│     Security & Audit Engine      │   │    Tenant-Scoped Repositories    │
│  - Canonical Payload Hash (SHA256)   - Base TenantRepository Enforces   │
│  - Monotonic Sequence Chaining   │   │    tenant_id in Every Query      │
│  - Persistent Audit Event Table  │   │  - Soft-Delete (`deleted_at`)    │
└──────────────────────────────────┘   └──────────────┬──────────────────┘
                                                      │
┌─────────────────────────────────────────────────────▼───────────────────┐
│              Database Layer (SQLite node:sqlite DatabaseSync)            │
│       PRAGMA foreign_keys = ON | Versioned schema_migrations             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Defense-in-Depth Tenant Isolation Architecture

Multi-tenancy isolation in Sooda is enforced across three non-bypassable layers:

```
[ Incoming HTTP Request ]
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. HTTP Middleware Layer (server.ts)                                    │
│    - resolveTenantContext(): Identifies tenant; sets isAuthorized=false │
│    - requireAuth(): Rejects unauthenticated requests with 401           │
│    - requireTenantScope(): Rejects mismatched tenant context with 403   │
│      (TENANT_MISMATCH) and records tamper audit event                   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Validated Principal & Scope
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Domain Application Layer (src/core/tenant/index.ts)                  │
│    - TenantApplicationService.assertTenantOwnership():                  │
│      Evaluates actor role & tenant ID before invoking repositories      │
│    - Blocks cross-tenant mutation or read attempts                      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Scoped Execution
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Database Repository Layer (src/core/database/index.ts)               │
│    - Base TenantRepository<T> enforces tenantId parameter in SQL       │
│    - 'WHERE tenant_id = ? AND deleted_at IS NULL' injected into queries │
│    - Rejects cross-tenant entity operations at data access tier         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Cryptographic Audit Trail Architecture

The audit system guarantees non-repudiation, tamper detection, and deterministic sequence ordering.

### Hash Chaining Mechanism
Each audit record incorporates the cryptographic hash of its immediate predecessor:

```
Genesis Hash: 0000000000000000000000000000000000000000000000000000000000000000
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Event #1: SequenceNumber=1                                              │
│ PreviousHash: 00000000...                                               │
│ Canonical Payload: [seq, ts, traceId, tenantId, actorId, role, action,  │
│                     resource, entityType, entityId, result, ip, ua,     │
│                     metadata (sorted keys), prevHash]                   │
│ Hash: SHA-256(canonicalPayload) = H1                                    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Event #2: SequenceNumber=2                                              │
│ PreviousHash: H1                                                        │
│ Hash: SHA-256(canonicalPayloadWithH1) = H2                              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Event #3: SequenceNumber=3                                              │
│ PreviousHash: H2                                                        │
│ Hash: SHA-256(canonicalPayloadWithH2) = H3                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Deterministic Canonical Serialization (`canonical.ts`)
To prevent JSON key ordering discrepancies from causing false-positive verification errors:
1. All payload fields are formatted via `canonicalizeAuditEventPayload()`.
2. Metadata dictionary keys are recursively sorted lexicographically (`canonicalizeJsonValue`).
3. SHA-256 digest is calculated across:
   ```
   sequenceNumber|timestamp|traceId|tenantId|storeId|actorId|actorRole|action|resource|entityType|entityId|result|ipAddress|userAgent|canonicalMetadata|previousHash
   ```
4. Persistent database recovery: Upon application reboot, `AuditLogService` queries `audit_events` for the latest sequence number and head hash, resuming the chain without gap or reset.
5. Tamper detection: Adversarial mutation of any historical field (actor ID, metadata, result status, or previous hash) immediately invalidates all downstream hashes during `verifyIntegrity()`.

---

## 5. Security Gate Catalog

| Gate Identifier | Component / Middleware | Resource Protected | Condition Checked | Error Code | HTTP Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GATE-AUTH-01** | `requireAuth` | All `/api/tenant/*`, `/api/audit/*`, `/api/tenants` | Valid Bearer token present and resolved to active user | `AUTHENTICATION_REQUIRED` / `INVALID_TOKEN` | `401 Unauthorized` |
| **GATE-RBAC-01** | `requireRole` | Platform administration endpoints (`/api/tenants`, `/api/audit/verify-integrity`) | Principal possesses required `SystemRole` (e.g. `PLATFORM_ADMIN`) | `FORBIDDEN` | `403 Forbidden` |
| **GATE-TENANT-01**| `requireTenantScope` | Tenant-scoped data endpoints (`/api/tenant/settings`) | Principal's assigned `tenantId` matches resolved target tenant, or principal is `PLATFORM_ADMIN` | `TENANT_MISMATCH` | `403 Forbidden` |
| **GATE-RATE-01** | `RateLimiter` | All incoming API endpoints | Request frequency within configured window (e.g. 100 req / min) | `RATE_LIMIT_EXCEEDED` | `429 Too Many Requests` |
| **GATE-CONF-01** | `ConfigurationManager` | Server lifecycle boot | `SESSION_SECRET` present and NOT default in `NODE_ENV=production` | Fatal Exception | Process Halt (Exit 1) |
| **GATE-TEST-01** | `server.ts` | Test endpoints (`/api/tests/*`) | `NODE_ENV === 'production'` | `ENDPOINT_NOT_FOUND` | `404 Not Found` |
| **GATE-REPO-01** | `TenantRepository` | Database entity access | `entity.tenantId === targetTenantId` | Domain Violation Exception | Internal Fault |

---

## 6. Production vs. Development Security Posture

| Feature / Behavior | Development (`NODE_ENV !== 'production'`) | Production (`NODE_ENV === 'production'`) |
| :--- | :--- | :--- |
| **Session Secret** | Default fallback permitted for rapid bootstrapping | **Fatal crash** if unset or matching default pattern |
| **Test Endpoints** | Accessible for automated CI and integration tests | **Completely disabled** (returns 404 Not Found) |
| **Error Handling** | Detailed stack traces returned in debug payload | Generic error message, stack traces completely omitted |
| **Security Headers** | Standard local headers | Strict HSTS, nosniff, strict CSP, framed origins blocked |
| **Database Mode** | SQLite file or in-memory | Prepared for persistent Cloud SQL / PostgreSQL cluster |

---

## 7. Known Limitations & Phase 1 Roadmap

### Phase 0 Accomplishments
- Clean, robust multi-tenant foundation running verified in-memory/file SQLite.
- Cryptographic SHA-256 audit ledger with deterministic JSON serialization and tamper detection.
- Fail-closed security architecture across middleware, application services, and repositories.
- Zero mock services; 100% automated test coverage across 21 HTTP security scenarios, 15 remediation tests, and 10 audit tamper tests.

### Phase 1 Roadmap
1. **PostgreSQL Adapter Implementation:** Implement `PostgresDatabaseAdapter` implementing `IDatabaseAdapter`, enabling connection pooling (`min: 5, max: 20`) for multi-container Cloud Run deployment.
2. **Distributed Session Storage:** Migrate in-memory token/session store to Redis with automatic TTL expiration.
3. **Asynchronous Messaging:** Introduce background worker queues for notifications and SMS dispatches.
4. **Merchant Onboarding & Authentication Flow:** Implement registration, credential verification, and merchant dashboard management.
