# ADR 0001: Foundation Architecture & Technical Baseline
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Phase 0 Foundation  

## Context and Problem Statement
Sooda is an enterprise-grade, multi-tenant SaaS e-commerce platform designed for merchants in Sudan and regional cross-border commerce. The platform must support independent digital storefronts, customized local branding, Sudanese payment modalities (cash on delivery, bank transfers via Bankily/Fawry/BOK), and high reliability under unstable network conditions.

Before initiating business domain features (merchants, storefronts, checkout, orders), a rigorous Phase 0 architectural foundation is required to guarantee:
1. Multi-tenant isolation at all tiers.
2. Cryptographic auditability and non-repudiation.
3. Fail-closed security posture.
4. Production-grade database migration and seeding foundations.

## Decision Drivers
- **Zero Cross-Tenant Leakage:** A security breach in one store must never compromise another.
- **Fail-Closed Default:** Any missing credential, unauthenticated access, or ambiguous context must fail closed.
- **Sudan Market Requirements:** Dual Arabic (RTL) / English (LTR) UX, SDG currency, local payment flows.
- **Strict Separation of Concerns:** Layered architecture separating HTTP routing, authentication middleware, domain application services, and database repositories.

## Considered Options
- Option 1: Full-stack Next.js with serverless functions and dynamic schema isolation.
- Option 2: Monolithic Node.js Express backend with modular TypeScript domain layers and Vite frontend SPA.
- Option 3: Microservices architecture with separate services for auth, stores, and audit.

## Decision Outcome
**Chosen Option:** Option 2 — Monolithic Node.js Express backend with modular TypeScript domain layers and Vite frontend SPA.
- In containerized environments (Google Cloud Run), a cohesive Node.js/Express service binds to port 3000 behind reverse proxies.
- Provides sub-millisecond in-process boundary enforcement and predictable transaction semantics.
- Foundation modules (`src/core/auth`, `src/core/tenant`, `src/core/audit`, `src/core/database`, `src/core/config`) are cleanly separated and unit-testable without external dependencies.

## Consequences
### Positive
- Strict end-to-end type safety with TypeScript.
- Defense-in-depth security model across HTTP, application service, and repository layers.
- Fast local testing with zero cloud mocking.

### Negative / Trade-offs
- Scaling requires stateless application containers with externalized database persistence (addressed in Phase 1 via Cloud SQL).
