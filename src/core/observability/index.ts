/**
 * Observability Foundation
 * Structured Logging, Request Tracing, and Audit Logging Foundation
 * Includes SHA-256 cryptographic hash-chaining for event integrity verification.
 * Zero-dependency RFC 6234 compliant implementation for isomorphic compatibility.
 */

import {
  canonicalizeAuditEventPayload,
  computeAuditEventHash,
  type CanonicalAuditEventFields,
} from '../audit/canonical.ts';
import { AuditPersistenceError, AuditIntegrityError } from '../errors/index.ts';

export { AuditPersistenceError, AuditIntegrityError };

function sha256(ascii: string): string {
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

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] =
        (bytes[offset + i * 4] << 24) |
        (bytes[offset + i * 4 + 1] << 16) |
        (bytes[offset + i * 4 + 2] << 8) |
        bytes[offset + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const toHex = (n: number) => n.toString(16).padStart(8, '0');
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
}

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogContext {
  traceId?: string;
  tenantId?: string;
  storeId?: string;
  userId?: string;
  userRole?: string;
  ipAddress?: string;
  path?: string;
  method?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    code?: string;
    stack?: string;
  };
}

export class StructuredLogger {
  private readonly defaultContext: LogContext;

  constructor(defaultContext: LogContext = {}) {
    this.defaultContext = defaultContext;
  }

  public child(extraContext: LogContext): StructuredLogger {
    return new StructuredLogger({ ...this.defaultContext, ...extraContext });
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.defaultContext, ...context },
      ...(error
        ? {
            error: {
              name: error.name,
              message: error.message,
              stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
            },
          }
        : {}),
    };

    // Output formatted JSON for production log aggregators
    const jsonStr = JSON.stringify(entry);
    if (level === LogLevel.ERROR) {
      console.error(jsonStr);
    } else if (level === LogLevel.WARN) {
      console.warn(jsonStr);
    } else {
      console.log(jsonStr);
    }

    return entry;
  }

  public debug(msg: string, ctx?: LogContext): StructuredLogEntry {
    return this.log(LogLevel.DEBUG, msg, ctx);
  }

  public info(msg: string, ctx?: LogContext): StructuredLogEntry {
    return this.log(LogLevel.INFO, msg, ctx);
  }

  public warn(msg: string, ctx?: LogContext, err?: Error): StructuredLogEntry {
    return this.log(LogLevel.WARN, msg, ctx, err);
  }

  public error(msg: string, err?: Error, ctx?: LogContext): StructuredLogEntry {
    return this.log(LogLevel.ERROR, msg, ctx, err);
  }
}

export const logger = new StructuredLogger();

// ================= AUDIT LOGGING FOUNDATION =================

/**
 * Audit Database Abstraction Interface
 * Decouples AuditLogService from the concrete Database engine, preventing
 * server-side node:sqlite imports from leaking into client browser bundles.
 */
export interface IAuditDatabase {
  insertAuditEvent(event: any): void;
  getLatestAuditEvent(): any | null;
  getAllAuditEventsChronological(): any[];
  clearAuditEvents?(): void;
}

export enum AuditServiceStatus {
  UNINITIALIZED = 'UNINITIALIZED',
  READY = 'READY',
  UNAVAILABLE = 'UNAVAILABLE',
}

let globalAuditDbProvider: (() => IAuditDatabase | null) | null = null;

export function registerAuditDatabaseProvider(provider: () => IAuditDatabase | null): void {
  globalAuditDbProvider = provider;
}

export function clearAuditDatabaseProvider(): void {
  globalAuditDbProvider = null;
}

export enum AuditAction {
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  LOGOUT = 'LOGOUT',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ALL_SESSIONS_REVOKED = 'ALL_SESSIONS_REVOKED',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  TENANT_SWITCHED = 'TENANT_SWITCHED',
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_UPDATED = 'TENANT_UPDATED',
  TENANT_SETTINGS_ACCESSED = 'TENANT_SETTINGS_ACCESSED',
  TENANT_SETTINGS_UPDATED = 'TENANT_SETTINGS_UPDATED',
  RATE_LIMIT_TRIGGERED = 'RATE_LIMIT_TRIGGERED',
  WORKFLOW_FAILED_COMPENSATED = 'WORKFLOW_FAILED_COMPENSATED',
  STORE_CREATED = 'STORE_CREATED',
  STORE_UPDATED = 'STORE_UPDATED',
  STORE_STATUS_CHANGED = 'STORE_STATUS_CHANGED',
  PERMISSION_GRANTED = 'PERMISSION_GRANTED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  CROSS_TENANT_ACCESS_BLOCKED = 'CROSS_TENANT_ACCESS_BLOCKED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  UNAUTHORIZED_ACCESS_BLOCKED = 'UNAUTHORIZED_ACCESS_BLOCKED',
}

/**
 * AuditEvent Schema
 * Represents a tamper-evident audit record in the cryptographically chained audit log.
 */
export interface AuditEvent {
  id: string;
  sequenceNumber: number;
  timestamp: string;
  traceId?: string;
  tenantId?: string;
  storeId?: string;
  actorId: string;
  actorRole: string;
  action: AuditAction | string;
  resource?: string;
  entityType: string;
  entityId: string;
  result?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

/**
 * Cryptographically Chained Audit Log Service
 * 
 * ARCHITECTURAL CLASSIFICATION:
 * - Tamper-evident audit mechanism backed by persistent database storage (audit_events table).
 * - Survives application restart: Reconstructs sequence number and head hash from persistent records.
 * - Integrity Verification: Re-queries stored records and validates sequence continuity,
 *   hash calculations, and chain links from genesis to head.
 * - Note on Terminology: Described strictly as a "cryptographically chained audit log"
 *   or "tamper-evident audit mechanism", NOT as "tamper-proof".
 */
export class AuditLogService {
  private static instance: AuditLogService;
  private events: AuditEvent[] = [];
  private sequenceCounter = 0;
  private lastHash = '0000000000000000000000000000000000000000000000000000000000000000'; // Genesis hash
  private db: IAuditDatabase | null = null;
  private status: AuditServiceStatus = AuditServiceStatus.UNINITIALIZED;
  private lastError: Error | null = null;
  private failureSimulator: ((action: string, event: unknown) => Error | null) | null = null;

  private constructor(db?: IAuditDatabase) {
    this.initDatabase(db);
  }

  public getStatus(): AuditServiceStatus {
    return this.status;
  }

  public isReady(): boolean {
    return this.status === AuditServiceStatus.READY;
  }

  public getLastError(): Error | null {
    return this.lastError;
  }

  public initDatabase(db?: IAuditDatabase): void {
    let candidateDb: IAuditDatabase | null = null;
    try {
      candidateDb = db !== undefined ? db : (globalAuditDbProvider ? globalAuditDbProvider() : null);
    } catch (providerErr: any) {
      this.status = AuditServiceStatus.UNAVAILABLE;
      this.lastError = providerErr instanceof Error ? providerErr : new Error(String(providerErr));
      this.db = null;
      logger.error('[AUDIT] Failed to resolve audit database provider.', this.lastError);
      return;
    }

    if (!candidateDb || (candidateDb as any).isClosed) {
      this.db = candidateDb || null;
      this.status = AuditServiceStatus.UNAVAILABLE;
      this.lastError = new Error('No active durable audit database available');
      return;
    }

    this.db = candidateDb;

    try {
      // 1. Startup verification: AuditLogService MUST NOT enter READY until the persisted audit
      // chain has been verified from genesis through the current head.
      const integrity = this.verifyIntegrity(this.db);
      if (!integrity.valid) {
        this.status = AuditServiceStatus.UNAVAILABLE;
        this.lastError = new AuditIntegrityError(
          `Startup audit chain verification failed: ${integrity.errors.join('; ')}`
        );
        logger.error('[AUDIT] Startup audit chain verification failed. Service set to UNAVAILABLE (fail-closed).', this.lastError);
        return;
      }

      // 2. Persisted head consistency check
      const latest = this.db.getLatestAuditEvent();
      if (integrity.verifiedCount > 0) {
        if (!latest) {
          this.status = AuditServiceStatus.UNAVAILABLE;
          this.lastError = new AuditIntegrityError(
            'Persisted head inconsistency: getLatestAuditEvent returned null for non-empty verified audit chain'
          );
          logger.error('[AUDIT] Startup head consistency check failed.', this.lastError);
          return;
        }

        if (latest.sequenceNumber !== integrity.verifiedCount) {
          this.status = AuditServiceStatus.UNAVAILABLE;
          this.lastError = new AuditIntegrityError(
            `Persisted head inconsistency: latest row sequence #${latest.sequenceNumber} does not match verified count #${integrity.verifiedCount}`
          );
          logger.error('[AUDIT] Startup head consistency check failed.', this.lastError);
          return;
        }

        if (integrity.headHash && latest.hash !== integrity.headHash) {
          this.status = AuditServiceStatus.UNAVAILABLE;
          this.lastError = new AuditIntegrityError(
            `Persisted head inconsistency: latest row hash ${latest.hash} does not match verified head hash ${integrity.headHash}`
          );
          logger.error('[AUDIT] Startup head consistency check failed.', this.lastError);
          return;
        }

        this.sequenceCounter = Number(latest.sequenceNumber);
        this.lastHash = String(latest.hash);
      } else {
        if (latest) {
          this.status = AuditServiceStatus.UNAVAILABLE;
          this.lastError = new AuditIntegrityError(
            `Persisted head inconsistency: latest row exists (#${latest.sequenceNumber}) but chronological chain was empty`
          );
          logger.error('[AUDIT] Startup head consistency check failed.', this.lastError);
          return;
        }

        this.sequenceCounter = 0;
        this.lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
      }

      this.status = AuditServiceStatus.READY;
      this.lastError = null;
    } catch (readErr: any) {
      // FAIL-CLOSED POLICY:
      // A configured durable database exists but could not be initialized/read.
      // 1. Preserve failure state
      // 2. Do not pretend the chain starts at genesis
      // 3. Do not allow successful audit recording
      // 4. Expose the failure through typed error/state
      // 5. Ensure callers cannot mistake the service for a healthy zero-event audit chain
      this.status = AuditServiceStatus.UNAVAILABLE;
      this.lastError = readErr instanceof Error ? readErr : new Error(String(readErr));
      logger.error('[AUDIT] Failed to read audit database head state. Service set to UNAVAILABLE (fail-closed).', this.lastError);
    }
  }

  public static getInstance(db?: IAuditDatabase): AuditLogService {
    if (!AuditLogService.instance) {
      AuditLogService.instance = new AuditLogService(db);
    } else if (db && AuditLogService.instance.db !== db) {
      AuditLogService.instance.initDatabase(db);
    } else if (
      !AuditLogService.instance.db ||
      (AuditLogService.instance.db as any).isClosed ||
      AuditLogService.instance.status !== AuditServiceStatus.READY
    ) {
      AuditLogService.instance.initDatabase(db);
    }
    return AuditLogService.instance;
  }

  public static resetInstance(db?: IAuditDatabase): AuditLogService {
    AuditLogService.instance = new AuditLogService(db);
    return AuditLogService.instance;
  }

  private calculateHash(fields: CanonicalAuditEventFields, previousHash: string): string {
    const payload = canonicalizeAuditEventPayload(fields, previousHash);
    return computeAuditEventHash(payload, previousHash);
  }

  public getSequenceNumber(): number {
    return this.sequenceCounter;
  }

  public getLastHash(): string {
    return this.lastHash;
  }

  public setFailureSimulator(simulator: ((action: string, event: unknown) => Error | null) | null): void {
    this.failureSimulator = simulator;
    if (!simulator) {
      const activeDb = this.db || (globalAuditDbProvider ? globalAuditDbProvider() : null);
      if (activeDb && !(activeDb as any).isClosed) {
        this.status = AuditServiceStatus.READY;
        this.lastError = null;
        this.syncHeadState(activeDb);
      }
    }
  }

  /**
   * Resynchronizes authoritative head state (sequenceCounter and lastHash)
   * directly against the durable database, purging any rolled-back in-memory events.
   */
  public syncHeadState(dbOverride?: IAuditDatabase): void {
    const activeDb = dbOverride || this.db || globalAuditDbProvider?.() || null;
    if (!activeDb || (activeDb as any).isClosed) {
      return;
    }

    try {
      const latest = activeDb.getLatestAuditEvent();
      if (latest) {
        this.sequenceCounter = Number(latest.sequenceNumber);
        this.lastHash = String(latest.hash);
      } else {
        this.sequenceCounter = 0;
        this.lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
      }
      // Purge any in-memory events that were rolled back in the database
      this.events = this.events.filter((e) => e.sequenceNumber <= this.sequenceCounter);
      this.status = AuditServiceStatus.READY;
      this.lastError = null;
    } catch (err: any) {
      this.status = AuditServiceStatus.UNAVAILABLE;
      this.lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  public record(event: Omit<AuditEvent, 'id' | 'sequenceNumber' | 'timestamp' | 'previousHash' | 'hash'>): AuditEvent {
    // 1. Resolve active database and verify health
    let activeDb = this.db;
    const isStale = !activeDb || (activeDb as any).isClosed;
    if (isStale) {
      try {
        const candidate = globalAuditDbProvider?.() || null;
        if (candidate && !(candidate as any).isClosed) {
          this.initDatabase(candidate);
          activeDb = this.db;
        }
      } catch {
        // Fallback if db provider throws
      }
    } else if (this.status !== AuditServiceStatus.READY) {
      try {
        this.initDatabase(activeDb);
        activeDb = this.db;
      } catch {
        // Still unavailable
      }
    }

    // 2. FAIL-CLOSED CHECK: NO DATABASE = NO SUCCESSFUL AUDIT RECORD
    if (!activeDb || (activeDb as any).isClosed || this.status !== AuditServiceStatus.READY) {
      const reason = this.lastError?.message
        ? `Database unavailable (${this.lastError.message})`
        : 'No durable audit database is available';

      logger.error(`[AUDIT] Security audit persistence failed: ${reason}. Operation aborted (fail-closed).`, this.lastError || undefined, {
        action: String(event.action),
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actorId,
      });

      throw new AuditPersistenceError(
        `Security audit persistence failed for event (${event.action}): ${reason}`
      );
    }

    // 3. Register rollback hook with active database if inside a transaction boundary
    if (typeof (activeDb as any).onRollback === 'function') {
      (activeDb as any).onRollback(() => {
        this.syncHeadState(activeDb!);
      });
    }

    // 4. Check failure simulator (for negative testing and fault injection)
    if (this.failureSimulator) {
      const simErr = this.failureSimulator(String(event.action), event);
      if (simErr) {
        this.status = AuditServiceStatus.UNAVAILABLE;
        this.lastError = simErr;
        logger.error(`[AUDIT] Injected audit persistence failure for action ${event.action}`, simErr);
        throw simErr instanceof AuditPersistenceError
          ? simErr
          : new AuditPersistenceError(
              `Security audit persistence failed for event (${event.action}): ${simErr.message}`
            );
      }
    }

    // 5. Compute candidate values in staging (WITHOUT mutating authoritative state)
    const candidateSeq = this.sequenceCounter + 1;
    const timestamp = new Date().toISOString();
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const previousHash = this.lastHash;
    const resource = event.resource !== undefined && event.resource !== null ? event.resource : `${event.entityType}:${event.entityId}`;
    const result = event.result !== undefined && event.result !== null ? event.result : 'SUCCESS';
    const effectiveActorId = event.actorId || (event as any).userId || 'system';
    const effectiveActorRole = event.actorRole || (event as any).userRole || 'SYSTEM';

    const candidateHash = this.calculateHash(
      {
        sequenceNumber: candidateSeq,
        timestamp,
        tenantId: event.tenantId ?? null,
        actorId: effectiveActorId,
        actorRole: effectiveActorRole,
        action: String(event.action),
        entityType: event.entityType,
        entityId: event.entityId,
        resource,
        result,
        traceId: event.traceId ?? null,
        storeId: event.storeId ?? null,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        metadata: event.metadata ?? null,
      },
      previousHash
    );

    const candidateEvent: AuditEvent = {
      ...event,
      id,
      actorId: effectiveActorId,
      actorRole: effectiveActorRole,
      resource,
      result,
      sequenceNumber: candidateSeq,
      timestamp,
      previousHash,
      hash: candidateHash,
    };

    // 6. Attempt durable persistence to database BEFORE updating authoritative in-memory state
    try {
      activeDb.insertAuditEvent({
        id,
        sequenceNumber: candidateSeq,
        timestamp,
        traceId: event.traceId,
        tenantId: event.tenantId,
        storeId: event.storeId,
        actorId: effectiveActorId,
        actorRole: effectiveActorRole,
        action: String(event.action),
        resource,
        entityType: event.entityType,
        entityId: event.entityId,
        result,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata,
        previousHash,
        hash: candidateHash,
      });
    } catch (dbErr: any) {
      // ATOMICITY GUARANTEE & FAIL-CLOSED:
      // In-memory sequenceCounter and lastHash remain UNCHANGED.
      // The candidate event is NOT added to this.events.
      this.status = AuditServiceStatus.UNAVAILABLE;
      this.lastError = dbErr instanceof Error ? dbErr : new Error(String(dbErr));
      logger.error('[AUDIT] Failed to persist audit event to database. In-memory state unchanged.', this.lastError, {
        candidateSeq,
        previousHash,
      });
      throw new AuditPersistenceError(
        `Security audit persistence failed for event #${candidateSeq} (${event.action}): ${dbErr?.message || 'Database insert failed'}`
      );
    }

    // 7. Commit authoritative in-memory state ONLY AFTER successful durable persistence
    this.sequenceCounter = candidateSeq;
    this.lastHash = candidateHash;
    this.events.unshift(candidateEvent);
    this.status = AuditServiceStatus.READY;
    this.lastError = null;

    // Keep memory cache capped for UI streaming
    if (this.events.length > 500) {
      this.events.pop();
    }

    logger.info(`[AUDIT] #${candidateSeq} ${candidateEvent.action} on ${resource}`, {
      tenantId: candidateEvent.tenantId,
      userId: candidateEvent.actorId,
      userRole: candidateEvent.actorRole,
      hash: candidateEvent.hash.substring(0, 10),
    });

    return candidateEvent;
  }

  /**
   * Verifies the cryptographic integrity of the persistent audit chain from genesis to head.
   * Reads directly from database records to ensure full verification of stored audit trail.
   */
  public verifyIntegrity(dbOverride?: IAuditDatabase): {
    valid: boolean;
    errors: string[];
    verifiedCount: number;
    headHash?: string;
    headSequence?: number;
  } {
    const errors: string[] = [];
    const activeDb = dbOverride || this.db || globalAuditDbProvider?.() || null;

    if (!activeDb || (activeDb as any).isClosed) {
      return {
        valid: false,
        errors: ['No active durable audit database available for integrity verification'],
        verifiedCount: 0,
      };
    }

    let records: Array<{
      sequence_number: number;
      timestamp: string;
      tenant_id?: string;
      actor_id: string;
      actor_role: string;
      action: string;
      resource?: string;
      entity_type: string;
      entity_id: string;
      result?: string;
      trace_id?: string;
      store_id?: string;
      ip_address?: string;
      user_agent?: string;
      metadata?: string;
      previous_hash: string;
      hash: string;
    }> = [];

    try {
      records = activeDb.getAllAuditEventsChronological();
    } catch (readErr: any) {
      return {
        valid: false,
        errors: [`Audit database records are inaccessible: ${readErr?.message || 'Read error'}`],
        verifiedCount: 0,
      };
    }

    const seenSequences = new Set<number>();
    let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const expectedSeq = i + 1;

      // 1. Duplicate sequence detection
      if (seenSequences.has(row.sequence_number)) {
        errors.push(`Duplicate sequence number detected: #${row.sequence_number}`);
      }
      seenSequences.add(row.sequence_number);

      // 2. Sequence number ordering and gap detection
      if (row.sequence_number !== expectedSeq) {
        errors.push(
          `Ordering inconsistency at record index ${i}: expected sequence #${expectedSeq}, got #${row.sequence_number}`
        );
      }

      // 3. Genesis link and previousHash chain link detection
      if (row.previous_hash !== expectedPrevHash) {
        if (i === 0) {
          errors.push(
            `Event #1 broken genesis link: expected genesis prevHash ${expectedPrevHash.substring(0, 8)}, got ${row.previous_hash.substring(0, 8)}`
          );
        } else {
          errors.push(
            `Event #${row.sequence_number} broken chain link: expected prevHash ${expectedPrevHash.substring(0, 8)}, got ${row.previous_hash.substring(0, 8)}`
          );
        }
      }

      // 4. Recalculate hash across all security-sensitive fields using canonical representation
      const calculated = this.calculateHash(
        {
          sequenceNumber: row.sequence_number,
          timestamp: row.timestamp,
          tenantId: row.tenant_id ?? null,
          actorId: row.actor_id,
          actorRole: row.actor_role,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          resource: row.resource ?? null,
          result: row.result ?? null,
          traceId: row.trace_id ?? null,
          storeId: row.store_id ?? null,
          ipAddress: row.ip_address ?? null,
          userAgent: row.user_agent ?? null,
          metadata: row.metadata ?? null,
          previousHash: row.previous_hash,
        },
        row.previous_hash
      );

      if (calculated !== row.hash) {
        errors.push(
          `Event #${row.sequence_number} tampered record: hash recalculation mismatch (expected ${calculated.substring(0, 8)}, stored ${row.hash.substring(0, 8)})`
        );
      }

      expectedPrevHash = row.hash;
    }

    return {
      valid: errors.length === 0,
      errors,
      verifiedCount: records.length,
      headHash: records.length > 0 ? records[records.length - 1].hash : undefined,
      headSequence: records.length > 0 ? records[records.length - 1].sequence_number : 0,
    };
  }

  public query(filter: { tenantId?: string; actorId?: string; action?: string; limit?: number }): AuditEvent[] {
    return this.events.filter((e) => {
      if (filter.tenantId && e.tenantId !== filter.tenantId) return false;
      if (filter.actorId && e.actorId !== filter.actorId) return false;
      if (filter.action && e.action !== filter.action) return false;
      return true;
    }).slice(0, filter.limit || 50);
  }

  public getRecent(limit = 20): AuditEvent[] {
    return [...this.events.slice(0, limit)];
  }

  public reset(clearDb = false): void {
    this.events.length = 0;
    if (clearDb && this.db) {
      try {
        if (this.db.clearAuditEvents) {
          this.db.clearAuditEvents();
        } else {
          (this.db as any).rawDb?.exec?.('DELETE FROM audit_events;');
        }
      } catch {
        // Safe clear
      }
    }
    this.initDatabase(this.db || undefined);
  }
}
