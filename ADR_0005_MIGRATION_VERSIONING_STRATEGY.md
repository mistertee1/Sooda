# ADR 0005: Database Migration & Versioning Strategy
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Schema Evolution  

## Context and Problem Statement
Schema evolution across multi-tenant environments requires strict, reproducible versioning. Ad-hoc schema updates, unversioned DDL statements, and manual database patching cause drift between staging, development, and production.

## Decision Drivers
- Deterministic, ordered migration execution.
- Idempotent migration runners.
- Comprehensive audit logging of migration execution.
- Atomic schema updates where supported.

## Decision Outcome
We implemented a dedicated migration manager in `src/core/database/index.ts`:

### Migration Engine Architecture
1. **Version Tracking Table:**
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
     version TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     applied_at TEXT NOT NULL
   );
   ```
2. **Ordered Migrations Pipeline:**
   - `001_initial_schema`: Establishes `stores`, `store_settings`, `audit_events`, indexes, and foreign keys.
   - `002_soft_delete_and_tracing`: Adds `deleted_at`, `trace_id`, `ip_address`, `user_agent`, and performance indexes.
3. **Execution Semantics:**
   - Migrations are checked in ascending order.
   - Applied migrations are recorded with ISO timestamps.
   - If a migration has already been executed, it is skipped idempotently.
   - The migration runner executes automatically on database initialization.

## Consequences
### Positive
- Fresh environments bootstrap cleanly from zero state.
- Roll-forward schema migrations are tracked and auditable.
