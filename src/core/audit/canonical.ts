/**
 * Canonical Audit Representation & Cryptographic Hash Calculation
 * 
 * SPECIFICATION:
 * - Guarantees deterministic, collision-resistant hash-chaining across all mutable,
 *   security-sensitive fields of an AuditEvent.
 * - Deterministic serialization of metadata (sorted keys, stable primitives).
 * - Explicit normalization of null/undefined values.
 * - UTF-8 byte encoding before SHA-256 calculation.
 * 
 * Formula:
 * canonicalPayload = canonicalizeAuditEventPayload(event)
 * currentHash = SHA-256(canonicalPayload + "|prev:" + previousHash)
 */

export function sha256(ascii: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f0, 0xc67178f2,
  ];

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // Multi-byte UTF-8 encoding
  const bytes: number[] = [];
  for (let i = 0; i < ascii.length; i++) {
    let code = ascii.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (ascii.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) {
    bytes.push(0);
  }
  for (let i = 7; i >= 0; i--) {
    bytes.push((bitLength >>> (i * 8)) & 0xff);
  }

  for (let i = 0; i < bytes.length; i += 64) {
    const w = new Array(64);
    for (let t = 0; t < 16; t++) {
      w[t] =
        (bytes[i + t * 4] << 24) |
        (bytes[i + t * 4 + 1] << 16) |
        (bytes[i + t * 4 + 2] << 8) |
        bytes[i + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[t] + w[t]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  function hex(n: number): string {
    return (n >>> 0).toString(16).padStart(8, '0');
  }

  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

/**
 * Deterministically canonicalizes any JSON-compatible value.
 * - Recursively sorts object keys lexicographically.
 * - Formats booleans, numbers, and strings with stable representations.
 * - Serializes null and undefined to 'null'.
 * - Preserves array element ordering.
 */
export function canonicalizeValue(val: unknown): string {
  if (val === null || val === undefined) {
    return 'null';
  }
  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'null';
  }
  if (typeof val === 'string') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map((item) => canonicalizeValue(item)).join(',') + ']';
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const parts = sortedKeys.map((key) => {
      return JSON.stringify(key) + ':' + canonicalizeValue(obj[key]);
    });
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(String(val));
}

export interface CanonicalAuditEventFields {
  sequenceNumber: number;
  timestamp: string;
  tenantId?: string | null;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  resource?: string | null;
  result?: string | null;
  traceId?: string | null;
  storeId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | string | null;
  previousHash?: string | null;
}

/**
 * Constructs the canonical JSON string representation of an audit event.
 * 
 * SPECIFICATION:
 * - Deterministic, fixed field names and ordering:
 *   1. sequenceNumber
 *   2. timestamp
 *   3. tenantId
 *   4. actorId
 *   5. actorRole
 *   6. action
 *   7. entityType
 *   8. entityId
 *   9. resource
 *   10. result
 *   11. traceId
 *   12. storeId
 *   13. ipAddress
 *   14. userAgent
 *   15. metadata
 *   16. previousHash
 * - Explicit null representation for optional/nullable fields (NO accidental default substitution).
 * - Distinguishes between null, empty string, and default values (e.g. result=null vs result="" vs result="SUCCESS").
 * - Recursive lexicographical ordering of metadata object keys.
 * - Stable array order preservation.
 * - Multi-byte UTF-8 encoding.
 */
export function canonicalizeAuditEventPayload(
  fields: CanonicalAuditEventFields,
  previousHash?: string | null
): string {
  const prev = previousHash !== undefined ? previousHash : (fields.previousHash ?? null);

  const seq = fields.sequenceNumber;
  const ts = JSON.stringify(fields.timestamp);
  const tenant = fields.tenantId !== undefined && fields.tenantId !== null ? JSON.stringify(fields.tenantId) : 'null';
  const actor = JSON.stringify(fields.actorId);
  const role = JSON.stringify(fields.actorRole);
  const act = JSON.stringify(fields.action);
  const entityType = JSON.stringify(fields.entityType);
  const entityId = JSON.stringify(fields.entityId);
  const resource = fields.resource !== undefined && fields.resource !== null ? JSON.stringify(fields.resource) : 'null';
  const result = fields.result !== undefined && fields.result !== null ? JSON.stringify(fields.result) : 'null';
  const trace = fields.traceId !== undefined && fields.traceId !== null ? JSON.stringify(fields.traceId) : 'null';
  const store = fields.storeId !== undefined && fields.storeId !== null ? JSON.stringify(fields.storeId) : 'null';
  const ip = fields.ipAddress !== undefined && fields.ipAddress !== null ? JSON.stringify(fields.ipAddress) : 'null';
  const ua = fields.userAgent !== undefined && fields.userAgent !== null ? JSON.stringify(fields.userAgent) : 'null';

  let meta = 'null';
  if (fields.metadata !== undefined && fields.metadata !== null) {
    if (typeof fields.metadata === 'string') {
      const trimmed = fields.metadata.trim();
      if (trimmed === '') {
        meta = '""';
      } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          meta = canonicalizeValue(parsed);
        } catch {
          meta = JSON.stringify(fields.metadata);
        }
      } else {
        meta = JSON.stringify(fields.metadata);
      }
    } else {
      meta = canonicalizeValue(fields.metadata);
    }
  }

  const prevSerialized = prev !== null ? JSON.stringify(prev) : 'null';

  return `{"sequenceNumber":${seq},"timestamp":${ts},"tenantId":${tenant},"actorId":${actor},"actorRole":${role},"action":${act},"entityType":${entityType},"entityId":${entityId},"resource":${resource},"result":${result},"traceId":${trace},"storeId":${store},"ipAddress":${ip},"userAgent":${ua},"metadata":${meta},"previousHash":${prevSerialized}}`;
}

/**
 * Computes the cryptographic SHA-256 hash for an audit event chained to previousHash.
 * Guarantees collision resistance and inclusion of previousHash.
 */
export function computeAuditEventHash(payload: string, previousHash?: string): string {
  if (payload.includes('"previousHash":')) {
    return sha256(payload);
  }
  const fallbackPrev = previousHash || '0000000000000000000000000000000000000000000000000000000000000000';
  const fullContent = `${payload}|prev:${fallbackPrev}`;
  return sha256(fullContent);
}
