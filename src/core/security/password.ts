/**
 * Password Security Module
 * 
 * Cryptographic implementation using RFC 9106 Argon2id via @node-rs/argon2.
 * 
 * SECURITY GUARANTEES:
 * 1. Plaintext passwords are NEVER stored, logged, or serialized.
 * 2. Uses Argon2id (memory-hard, resistant to GPU/ASIC cracking and side-channel attacks).
 * 3. Constant-time verification to prevent timing side-channel analysis.
 * 4. Dummy hash verification executed on failed lookups to prevent user enumeration via response timing.
 * 5. Configurable cost parameters (memory, time, parallelism).
 */

import { hash, verify } from '@node-rs/argon2';
import crypto from 'node:crypto';

export enum Argon2Algorithm {
  Argon2d = 0,
  Argon2i = 1,
  Argon2id = 2,
}

export interface PasswordHashOptions {
  algorithm?: Argon2Algorithm | number;
  memoryCost?: number; // In KiB (default: 65536 = 64MiB)
  timeCost?: number;   // Number of iterations (default: 3)
  parallelism?: number; // Number of threads (default: 1)
  outputLen?: number;  // Output hash length (default: 32 bytes)
}

export const DEFAULT_ARGON2_OPTIONS: PasswordHashOptions = {
  algorithm: Argon2Algorithm.Argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};

// Pre-computed dummy hash to run dummy verification in constant time when an account is not found
// This prevents timing-based user enumeration attacks.
let dummyHashCache: string | null = null;

export class PasswordService {
  /**
   * Generates a secure, salted Argon2id hash for the given plaintext password.
   * Enforces strict length boundaries to prevent DoS via CPU exhaustion on giant payloads.
   */
  public static async hashPassword(
    plaintext: string,
    options: PasswordHashOptions = DEFAULT_ARGON2_OPTIONS
  ): Promise<string> {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Password must be a non-empty string');
    }

    // Defend against algorithmic complexity DoS via oversized passwords
    if (plaintext.length > 256) {
      throw new Error('Password exceeds maximum allowed length of 256 characters');
    }

    if (plaintext.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    return await hash(plaintext, {
      algorithm: (options.algorithm ?? Argon2Algorithm.Argon2id) as any,
      memoryCost: options.memoryCost ?? DEFAULT_ARGON2_OPTIONS.memoryCost,
      timeCost: options.timeCost ?? DEFAULT_ARGON2_OPTIONS.timeCost,
      outputLen: options.outputLen ?? DEFAULT_ARGON2_OPTIONS.outputLen,
    });
  }

  /**
   * Verifies a plaintext password against a stored Argon2id hash.
   * Safe against timing attacks.
   */
  public static async verifyPassword(
    storedHash: string,
    candidatePlaintext: string
  ): Promise<boolean> {
    if (!storedHash || !candidatePlaintext) {
      return false;
    }

    // Limit input length to mitigate DoS
    if (candidatePlaintext.length > 256) {
      return false;
    }

    try {
      return await verify(storedHash, candidatePlaintext);
    } catch {
      // In case of corrupt hash or malformed input, fail closed
      return false;
    }
  }

  /**
   * Performs dummy verification against a valid Argon2id hash structure.
   * Call this when a user lookup returns null to ensure response times are
   * indistinguishable between "user does not exist" and "wrong password".
   */
  public static async performDummyVerification(candidatePlaintext: string): Promise<void> {
    try {
      if (!dummyHashCache) {
        // Compute dummy hash once on initialization
        dummyHashCache = await hash('dummy-entropy-string-for-constant-timing-defense', {
          algorithm: Argon2Algorithm.Argon2id as any,
          memoryCost: DEFAULT_ARGON2_OPTIONS.memoryCost,
          timeCost: DEFAULT_ARGON2_OPTIONS.timeCost,
          outputLen: DEFAULT_ARGON2_OPTIONS.outputLen,
        });
      }
      await verify(dummyHashCache, candidatePlaintext || 'dummy-candidate');
    } catch {
      // Intentionally swallowed; return timing parity without throwing
    }
  }

  /**
   * Generates a high-entropy random password string suitable for initial seeding or resets.
   */
  public static generateSecureRandomSecret(byteLength = 32): string {
    return crypto.randomBytes(byteLength).toString('hex');
  }
}

export const hashPassword = (plaintext: string, options?: PasswordHashOptions) =>
  PasswordService.hashPassword(plaintext, options);

export const verifyPassword = (storedHash: string, candidatePlaintext: string) =>
  PasswordService.verifyPassword(storedHash, candidatePlaintext);

export const dummyVerify = (candidatePlaintext = 'dummy-candidate') =>
  PasswordService.performDummyVerification(candidatePlaintext);

