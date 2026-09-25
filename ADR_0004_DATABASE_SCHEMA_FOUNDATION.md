# ADR 0004: Database Schema Foundation & Storage Strategy
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Database & Storage Architecture  

## Context and Problem Statement
Phase 0 requires a concrete database foundation that can:
1. Support multi-tenant e-commerce data structures (stores, settings, audit trails, migrations).
2. Enforce relational integrity and foreign keys.
3. Operate deterministically across local development, continuous integration, and container preview.
4. Provide a seamless forward path to production Cloud SQL (PostgreSQL) in Phase 1.

## Decision Drivers
- Zero external cloud dependencies during Phase 0 foundation verification.
- Pure SQL standard compliance without proprietary lock-in.
- Referential integrity with strict `PRAGMA foreign_keys = ON`.
- Explicit schema migration tracking.

## Decision Outcome
We implemented a multi-stage database architecture:
- **Engine for Phase 0:** Native `node:sqlite` (`DatabaseSync`), utilizing standard SQLite on local disk (`data/sooda.db` at runtime) or in-memory (`:memory:`) for test isolation.
- **Foreign Keys:** Explicitly enabled on every connection via `PRAGMA foreign_keys = ON;`.
- **Core Entities:**
  - `stores`: Platform tenant catalog.
  - `store_settings`: Tenant operational configurations with soft deletion (`deleted_at`).
  - `audit_events`: Cryptographic SHA-256 hash-chained immutable audit ledger.
  - `schema_migrations`: Migration execution history.
- **Repository Pattern:** Abstracted repository interfaces (`BaseTenantRepository`, `TenantSettingsRepository`, `StorefrontRepository`) decouple business logic from the underlying SQL driver, ensuring that migrating to PostgreSQL/Drizzle in Phase 1 requires zero changes to application service contracts.

## Consequences
### Positive
- Sub-millisecond test execution with 100% test reproducibility in memory.
- Repository abstractions guarantee clean migration to PostgreSQL in Phase 1.

### Operational Notice
- As documented in `PHASE_0_DATABASE_STATUS.md`, local SQLite files in containerized Cloud Run instances are ephemeral. Production persistence in Phase 1 will connect to managed Cloud SQL PostgreSQL.
