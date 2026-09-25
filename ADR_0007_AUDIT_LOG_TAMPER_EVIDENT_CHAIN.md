# ADR 0007: Cryptographic Tamper-Evident Audit Chain Architecture
**Status:** Accepted  
**Date:** September 2026  
**Context:** Sooda SaaS E-Commerce Platform — Audit & Non-Repudiation  

## Context and Problem Statement
Multi-tenant e-commerce platforms handle financial transactions, permission grants, store updates, and security events. Standard database audit logs are vulnerable to:
1. Direct database tampering by malicious insiders or SQL injection.
2. Inconsistent JSON serialization producing divergent hashes across architectures.
3. Unordered or missing events in sequence.

## Decision Drivers
- High cryptographic assurance using standard SHA-256.
- Deterministic JSON canonicalization (handling unordered dictionary keys, nested objects, and arrays).
- Complete field coverage: every column and metadata property must be part of the cryptographic hash.
- Monotonic sequence numbering chaining back to a known genesis hash.

## Decision Outcome
We implemented a **Cryptographic SHA-256 Hash Chaining Audit Ledger**:

### 1. Genesis Hash & Monotonic Chaining
- Genesis hash is fixed: `0000000000000000000000000000000000000000000000000000000000000000`.
- Every event references the hash of the preceding event:
  `event[i].previousHash === event[i-1].hash`
- Monotonic sequence numbering: `sequenceNumber = i + 1`.

### 2. Deterministic Canonical Serialization (`src/core/audit/canonical.ts`)
- All 16 fields are canonicalized into a strict pipe-delimited format:
  ```ts
  payload = [
    seq, timestamp, tenantId, actorId, actorRole, action,
    entityType, entityId, resource, result, traceId,
    storeId, ipAddress, userAgent, canonicalMetadata, previousHash
  ].join('|');
  ```
- Metadata is serialized using a recursive key-sorting canonicalizer (`canonicalizeValue`), guaranteeing that unordered keys (e.g. `{b: 2, a: 1}`) produce identical strings (`{"a":1,"b":2}`) and identical hashes.
- Mutation of any single field or nested metadata value alters the cryptographic hash.

### 3. Comprehensive Verification (`verifyIntegrity()`)
- Recalculates hashes from genesis to head.
- Intercepts sequence gaps, broken chain links, and tampered records.
- Verified across 26 adversarial test cases (`AUD-T01` to `AUD-T22`).

## Consequences
### Positive
- Absolute non-repudiation and immediate tamper detection.
- Complete independence from database storage engine.
