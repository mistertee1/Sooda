# Sooda SaaS Platform: Phase 0 Database Status Report

**Document Status:** Verified against Real Codebase  
**Phase:** Phase 0 (Foundation & Technical Blueprint)  
**Date:** September 2026  
**Classification:** Engineering Architecture & Infrastructure Reality  

---

## 1. Executive Summary & Active Engine

| Dimension | Real Implementation State |
| :--- | :--- |
| **Active Engine** | **SQLite** in-process via Node.js native `node:sqlite` (`DatabaseSync`) |
| **Adapter Pattern** | Abstract `IDatabaseAdapter` backed by concrete `SQLiteDatabaseAdapter` |
| **Runtime Mode** | File-backed for persistent server mode (`data/sooda.db`); in-memory (`:memory:`) for isolated unit/integration tests |
| **Foreign Keys** | Strictly enforced (`PRAGMA foreign_keys = ON;`) on every connection |
| **PostgreSQL Adapter** | **NOT YET IMPLEMENTED** (Deferred to Phase 1 containerized multi-node orchestration) |

> **CRITICAL ARCHITECTURAL HONESTY NOTE:**  
> There is **no** active PostgreSQL or Cloud SQL database running in Phase 0. No fake or stub PostgreSQL adapter has been fabricated. The current implementation leverages SQLite wrapped behind a clean, strict `IDatabaseAdapter` contract to establish all schemas, migrations, relations, repositories, and cryptographic audit tables in Phase 0 before introducing network-distributed database clusters in Phase 1.

---

## 2. Active Verified Database Schemas

All schemas are initialized via versioned DDL migrations and enforced with strict relational constraints:

### 1. `schema_migrations`
Tracks monotonic migration version history.
- `version` (INTEGER PRIMARY KEY)
- `name` (TEXT NOT NULL)
- `applied_at` (TEXT NOT NULL)

### 2. `platforms`
Global SaaS platform tenant registry and default currency/locale settings.
- `id` (TEXT PRIMARY KEY) - e.g., `'platform_sooda_core'`
- `name` (TEXT NOT NULL)
- `code` (TEXT UNIQUE NOT NULL)
- `primary_domain` (TEXT NOT NULL)
- `status` (TEXT NOT NULL) - `'ACTIVE' | 'MAINTENANCE' | 'SUSPENDED'`
- `version` (TEXT NOT NULL)
- `default_currency` (TEXT NOT NULL DEFAULT 'SDG')
- `supported_languages` (TEXT NOT NULL) - JSON array `['ar', 'en']`
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 3. `users`
Cross-tenant and platform-level identity principals.
- `id` (TEXT PRIMARY KEY)
- `email` (TEXT UNIQUE NOT NULL)
- `phone` (TEXT NULL)
- `full_name` (TEXT NOT NULL)
- `role` (TEXT NOT NULL) - `'PLATFORM_ADMIN' | 'MERCHANT_OWNER' | 'STORE_MANAGER' | 'SUPPORT_AGENT' | 'CUSTOMER'`
- `is_active` (INTEGER NOT NULL DEFAULT 1)
- `preferred_language` (TEXT NOT NULL DEFAULT 'ar')
- `tenant_id` (TEXT NULL) - NULL for platform administrators; strictly populated for tenant users
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 4. `merchants`
Commercial legal entity profile for merchants.
- `id` (TEXT PRIMARY KEY)
- `owner_user_id` (TEXT NOT NULL, FK -> `users.id`)
- `business_name` (TEXT NOT NULL)
- `trade_name_ar` (TEXT NOT NULL)
- `commercial_registration_number` (TEXT NULL)
- `country_code` (TEXT NOT NULL DEFAULT 'SD')
- `city` (TEXT NOT NULL)
- `phone_number` (TEXT NOT NULL)
- `status` (TEXT NOT NULL DEFAULT 'ACTIVE')
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 5. `stores`
Individual digital storefronts (each store represents a distinct `tenantId`).
- `id` (TEXT PRIMARY KEY) - Acts as `tenantId` (e.g. `'tenant_store_albaraka'`)
- `merchant_id` (TEXT NOT NULL, FK -> `merchants.id`)
- `slug` (TEXT UNIQUE NOT NULL)
- `name_ar` (TEXT NOT NULL)
- `name_en` (TEXT NOT NULL)
- `status` (TEXT NOT NULL DEFAULT 'ACTIVE')
- `currency` (TEXT NOT NULL DEFAULT 'SDG')
- `timezone` (TEXT NOT NULL DEFAULT 'Africa/Khartoum')
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 6. `store_settings`
Private merchant operational settings and configurations (strict tenant isolation required).
- `id` (TEXT PRIMARY KEY)
- `tenant_id` (TEXT NOT NULL, FK -> `stores.id`)
- `store_id` (TEXT NOT NULL, FK -> `stores.id`)
- `contact_email` (TEXT NOT NULL)
- `contact_phone` (TEXT NOT NULL)
- `allow_guest_checkout` (INTEGER NOT NULL DEFAULT 1)
- `order_notification_phone` (TEXT NULL)
- `tax_enabled` (INTEGER NOT NULL DEFAULT 0)
- `tax_percentage` (REAL NULL)
- `maintenance_mode` (INTEGER NOT NULL DEFAULT 0)
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 7. `store_themes`
Visual branding configuration per storefront.
- `id` (TEXT PRIMARY KEY)
- `tenant_id` (TEXT NOT NULL, FK -> `stores.id`)
- `store_id` (TEXT NOT NULL, FK -> `stores.id`)
- `primary_color` (TEXT NOT NULL DEFAULT '#0F766E')
- `accent_color` (TEXT NOT NULL DEFAULT '#D97706')
- `font_family` (TEXT NOT NULL DEFAULT 'Cairo')
- `direction` (TEXT NOT NULL DEFAULT 'rtl')
- `logo_url` (TEXT NULL), `banner_url` (TEXT NULL)
- `active_layout` (TEXT NOT NULL DEFAULT 'modern')
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 8. `domains`
Custom domain and subdomain routing mappings.
- `id` (TEXT PRIMARY KEY)
- `tenant_id` (TEXT NOT NULL, FK -> `stores.id`)
- `store_id` (TEXT NOT NULL, FK -> `stores.id`)
- `hostname` (TEXT UNIQUE NOT NULL)
- `is_primary` (INTEGER NOT NULL DEFAULT 1)
- `is_custom` (INTEGER NOT NULL DEFAULT 0)
- `ssl_status` (TEXT NOT NULL DEFAULT 'PENDING')
- `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL), `deleted_at` (TEXT NULL)

### 9. `audit_events`
Persistent cryptographic hash-chained audit ledger.
- `id` (TEXT PRIMARY KEY)
- `sequence_number` (INTEGER UNIQUE NOT NULL)
- `timestamp` (TEXT NOT NULL)
- `trace_id` (TEXT NULL)
- `tenant_id` (TEXT NULL)
- `store_id` (TEXT NULL)
- `actor_id` (TEXT NOT NULL)
- `actor_role` (TEXT NOT NULL)
- `action` (TEXT NOT NULL)
- `resource` (TEXT NOT NULL)
- `entity_type` (TEXT NOT NULL)
- `entity_id` (TEXT NOT NULL)
- `result` (TEXT NOT NULL DEFAULT 'SUCCESS')
- `ip_address` (TEXT NULL)
- `user_agent` (TEXT NULL)
- `metadata` (TEXT NULL) - Canonical deterministic JSON string
- `previous_hash` (TEXT NOT NULL)
- `hash` (TEXT NOT NULL)

---

## 3. Migration Runner Mechanism

The database engine executes automated forward migrations upon initialization:
- **Table:** `schema_migrations`
- **Method:** `Database.prototype.runMigrations()`
- **Behavior:**
  1. Inspects `schema_migrations` for highest applied version.
  2. Executes unapplied migration scripts inside a serialized atomic block.
  3. Records version number, script name, and UTC timestamp upon completion.
  4. Migration 1 (`001_initial_schema`): Creates core relational tables (`platforms`, `users`, `merchants`, `stores`, `store_settings`, `store_themes`, `domains`, indexes).
  5. Migration 2 (`002_audit_events_table`): Creates the persistent `audit_events` table with monotonic sequence numbering and indexes.

---

## 4. Foundation Seed Data State

The database seeds a deterministic set of foundation records upon initialization:

### Platform Administrator
- **User ID:** `user_platform_admin`
- **Email:** `admin@sooda.sd`
- **Role:** `PLATFORM_ADMIN`
- **Tenant Context:** `null` (Global platform scope)

### Tenant A (Khartoum Store)
- **Store / Tenant ID:** `tenant_store_albaraka`
- **Slug:** `albaraka`
- **Store Name (AR):** متجر البركة الخرطوم
- **Merchant Legal Entity:** `merchant_albaraka_sd` (Business: شركة البركة للمواد الاستهلاكية)
- **Owner User:** `user_merchant_albaraka_owner` (`owner@albaraka.sd`)
- **Primary Domain:** `albaraka.sooda.sd`
- **Settings ID:** `settings_tenant_store_albaraka`
- **Theme Primary Color:** `#0F766E` (Deep Teal), Font: `'Cairo'`, Direction: `'rtl'`

### Tenant B (Port Sudan Store)
- **Store / Tenant ID:** `tenant_store_nilecrafts`
- **Slug:** `nilecrafts`
- **Store Name (AR):** متجر حرف النيل بورتسودان
- **Merchant Legal Entity:** `merchant_nilecrafts_sd` (Business: حرف النيل للتحف والمصنوعات اليدوية)
- **Owner User:** `user_merchant_nilecrafts_owner` (`owner@nilecrafts.sd`)
- **Primary Domain:** `nilecrafts.sooda.sd`
- **Settings ID:** `settings_tenant_store_nilecrafts`
- **Theme Primary Color:** `#1E3A8A` (Deep Blue), Font: `'Cairo'`, Direction: `'rtl'`

---

## 5. What Is NOT Yet Implemented (Phase 0 Boundaries)

The following enterprise database capabilities are intentionally out of scope for Phase 0 and are explicitly deferred to Phase 1:

1. **PostgreSQL Adapter:** No remote PostgreSQL wire driver (`pg` / `postgres.js`) is initialized in Phase 0.
2. **Connection Pooling:** In-process SQLite relies on serial database locks; dynamic connection pool management (`pg-pool` or external pgbouncer) is deferred.
3. **Read Replicas & Query Routing:** All read and write operations hit the primary database adapter.
4. **Distributed 2-Phase Commit (2PC):** Multi-database distributed transactions are not supported; all consistency is local transaction-scoped.
5. **Row-Level Security (RLS) at DB Engine Level:** SQLite does not support native engine-level RLS policies; multi-tenancy is enforced in the software repository layer (`TenantRepository`) and Domain Model assertions.

---

## 6. Phase 1 Transition Plan: Migration to PostgreSQL

When moving from Phase 0 to Phase 1 (multi-node containerized deployment on Cloud Run or Kubernetes):

```
┌────────────────────────────────────────────────────────┐
│               IDatabaseAdapter (Contract)              │
├──────────────────────────┬─────────────────────────────┤
│   SQLiteDatabaseAdapter  │   PostgresDatabaseAdapter   │
│   (Phase 0 Dev & Test)   │   (Phase 1 Multi-Container) │
└──────────────────────────┴─────────────────────────────┘
```

1. **Implement `PostgresDatabaseAdapter`:**
   - Implement `query<T>(sql, params)`, `queryOne<T>(sql, params)`, `execute(sql, params)`, and `transaction<T>(fn)`.
   - Parameter mapping: Convert `?` placeholder convention to PostgreSQL `$1, $2, ...` positional syntax.
2. **Connection Pooling:**
   - Configure connection pool with `min: 5, max: 20` connections per container.
   - Configure SSL connection (`ssl: { rejectUnauthorized: true }`).
3. **Migration Engine Parity:**
   - Port migration scripts to standard SQL syntax compatible with both SQLite and PostgreSQL.
   - Maintain `schema_migrations` table parity.
4. **Data Portability & Zero Data Loss:**
   - Export SQLite seed/foundation state into idempotent SQL insert scripts.
   - Run verification hash checks on audit logs to ensure SHA-256 chain integrity is preserved across the migration.
