# ADR 0006: Development Environment Strategy & Production Guardrails
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Environment Segregation  

## Context and Problem Statement
A critical failure mode in SaaS development is the accidental leakage of development conveniences into production environments. Examples include:
- Test-runner HTTP endpoints exposed to the public internet.
- Hardcoded fallback JWT secrets used in production.
- Test tokens bypassing authentication in production.
- Client-side bypasses (e.g. `?debug=1`, `X-Dev-Mode: true`).

## Decision Drivers
- **Fail-Closed by Default:** Production must fail closed on missing configuration.
- **Zero Client Bypasses:** Client headers, cookies, query parameters, or request bodies must never enable test or dev modes.
- **Zero Production Credentials in Source:** Real secrets must only be injected via environment variables (`.env`).
- **Clean Artifacts:** Repository snapshots and production build artifacts must exclude local runtime databases (`data/*.db`).

## Decision Outcome
We established strict environment guardrails in `src/core/config/index.ts` and `server.ts`:

### 1. Configuration Validation
- In production (`NODE_ENV === 'production'`), `ConfigurationManager` validates that all critical secrets (`SESSION_SECRET`, `DATABASE_URL`) are present and meet minimum entropy requirements.
- Missing secrets halt server startup with fatal errors.

### 2. Physical Exclusion of Test Routes in Production
- Test runner endpoints (`/api/tests/phase0`, `/api/tests/security`, `/api/tests/remediation`) are only mounted when:
  `!isProduction && process.env.NODE_ENV !== 'production' && serverConfig.allowDevTestTokens`
- A terminal fail-closed catch-all (`app.all('/api/*')`) returns HTTP 404 for any unregistered endpoint.
- Client bypass vectors are completely ignored.

### 3. Clean Source Artifacts
- Runtime database files (`data/sooda.db`, `*.db`) are ignored in `.gitignore` and purged from source distributions.
- Application bootstraps dynamically on fresh checkout via migrations and seed fixtures.

## Consequences
### Positive
- Production security posture cannot be compromised by development convenience code.
- Continuous verification tests (`SEC-22..26`) enforce these guarantees.
