/**
 * Pluggable Rate Limiting Store Abstraction
 * 
 * ARCHITECTURAL SPECIFICATION:
 * - IRateLimitStore: Abstract interface defining the contract for rate limit counters.
 * - MemoryRateLimitStore: IMPLEMENTED for single-instance development and automated testing.
 * - DistributedRateLimitStore: PRODUCTION REQUIREMENT.
 *   In production deployments (multi-container Cloud Run / Kubernetes / container cluster),
 *   rate limiting must synchronize state across replicas via an atomic distributed store
 *   (e.g., Redis using atomic sliding-window Lua scripts or token-bucket keys).
 *   Process-memory stores cannot synchronize request counts across separate container pods.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  totalLimit: number;
}

export interface IRateLimitStore {
  readonly isDistributed: boolean;
  readonly storeName: string;
  incrementAndCheck(key: string, limit: number, windowMs: number): Promise<RateLimitResult> | RateLimitResult;
  reset(key?: string): Promise<void> | void;
}

/**
 * In-Memory Sliding Window Rate Limit Store
 * 
 * STATUS: DEVELOPMENT & TEST ONLY.
 * KNOWN LIMITATION: Process-isolated. Not shared across multiple server processes or container replicas.
 */
export class MemoryRateLimitStore implements IRateLimitStore {
  public readonly isDistributed = false;
  public readonly storeName = 'MemoryRateLimitStore (Development / Test Only)';
  private requests = new Map<string, number[]>();

  public incrementAndCheck(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const validTimestamps = timestamps.filter((t) => now - t < windowMs);

    if (validTimestamps.length >= limit) {
      this.requests.set(key, validTimestamps);
      const oldest = validTimestamps[0];
      const resetMs = Math.max(0, windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
        totalLimit: limit,
      };
    }

    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    return {
      allowed: true,
      remaining: Math.max(0, limit - validTimestamps.length),
      resetMs: windowMs,
      totalLimit: limit,
    };
  }

  public reset(key?: string): void {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }
}

/**
 * Production Distributed Rate Limit Store Specification
 * 
 * STATUS: DESIGN SPECIFICATION / PRODUCTION REQUIREMENT.
 * Documents the required Redis architecture for Phase 1+ multi-container deployment.
 */
export interface DistributedRateLimitConfig {
  redisUrl: string;
  keyPrefix?: string;
  enableFailOpenOnOutage?: boolean;
}

/**
 * RateLimiter Engine
 * Accepts any IRateLimitStore implementation. Defaults to MemoryRateLimitStore.
 */
export class RateLimiter {
  private readonly store: IRateLimitStore;
  private readonly defaultMaxRequests: number;
  private readonly defaultWindowMs: number;

  constructor(
    store?: IRateLimitStore,
    maxRequests = 100,
    windowMs = 60000
  ) {
    this.store = store || new MemoryRateLimitStore();
    this.defaultMaxRequests = maxRequests;
    this.defaultWindowMs = windowMs;
  }

  public getStore(): IRateLimitStore {
    return this.store;
  }

  public isAllowed(clientKey: string, customLimit?: number, customWindowMs?: number): RateLimitResult {
    const limit = customLimit ?? this.defaultMaxRequests;
    const windowMs = customWindowMs ?? this.defaultWindowMs;
    return this.store.incrementAndCheck(clientKey, limit, windowMs) as RateLimitResult;
  }

  public reset(key?: string): void {
    this.store.reset(key);
  }
}
