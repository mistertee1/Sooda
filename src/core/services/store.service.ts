/**
 * Store Management Application Service
 * 
 * Implements Phase 2 Merchant Dashboard & Store Management domain logic:
 * 1. Strict multi-tenant store authorization (User -> TenantMembership -> Store).
 * 2. Immutable tenant boundaries with fail-closed access controls.
 * 3. Protected field whitelist for store metadata updates (prevents mass assignment).
 * 4. Slug format validation, reserved routing collision prevention, and uniqueness checks.
 * 5. Store lifecycle status management (ACTIVE, INACTIVE).
 * 6. Cryptographically chained, tamper-evident audit logging for all mutations.
 */

import { z } from 'zod';
import { Database } from '../database/index.ts';
import { Store, StoreSettings, StoreStatus, TenantMembership, SystemRole, Permission, AccountStatus } from '../domain/index.ts';
import { AuthenticatedPrincipal, AuthorizationPolicy } from '../auth/index.ts';
import { AuditLogService, AuditAction } from '../observability/index.ts';
import { CurrencyManager } from '../currency/index.ts';
import {
  ValidationError,
  AuthorizationError,
  NotFoundError,
  TenantMismatchError,
} from '../errors/index.ts';

export const RESERVED_SLUGS = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'cart',
  'cdn',
  'checkout',
  'dashboard',
  'dev',
  'help',
  'login',
  'logout',
  'orders',
  'platform',
  'products',
  'register',
  'root',
  'settings',
  'signup',
  'sooda',
  'static',
  'store',
  'stores',
  'superadmin',
  'support',
  'sysadmin',
  'system',
  'test',
  'webhook',
  'webhooks',
  'www',
]);

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class StoreSlugValidator {
  public static normalize(slug: string): string {
    return slug.trim().toLowerCase();
  }

  public static validate(slug: string): { valid: boolean; reason?: string; normalizedSlug: string } {
    const normalized = this.normalize(slug);

    if (normalized.length < 3 || normalized.length > 63) {
      return {
        valid: false,
        reason: 'Slug must be between 3 and 63 characters in length',
        normalizedSlug: normalized,
      };
    }

    if (!SLUG_REGEX.test(normalized)) {
      return {
        valid: false,
        reason: 'Slug may only contain lowercase alphanumeric characters and single hyphens between words',
        normalizedSlug: normalized,
      };
    }

    if (RESERVED_SLUGS.has(normalized)) {
      return {
        valid: false,
        reason: `'${normalized}' is a reserved platform keyword and cannot be used as a store slug`,
        normalizedSlug: normalized,
      };
    }

    return {
      valid: true,
      normalizedSlug: normalized,
    };
  }
}

// Strict Zod schema for Store profile & contact updates (prevents mass-assignment)
export const UpdateStoreSchema = z
  .object({
    nameAr: z.string().trim().min(2, 'Arabic store name must be at least 2 characters').max(100, 'Arabic store name cannot exceed 100 characters').optional(),
    nameEn: z.string().trim().min(2, 'English store name must be at least 2 characters').max(100, 'English store name cannot exceed 100 characters').optional(),
    descriptionAr: z.string().trim().max(500, 'Arabic description cannot exceed 500 characters').nullable().optional(),
    descriptionEn: z.string().trim().max(500, 'English description cannot exceed 500 characters').nullable().optional(),
    slug: z.string().trim().min(3).max(63).optional(),
    currency: z.string().trim().length(3, 'Currency must be a 3-letter ISO code').toUpperCase().optional(),
    timezone: z.string().trim().min(2).max(64).optional(),
    defaultLocale: z.enum(['ar', 'en']).optional(),
    contactEmail: z.string().trim().email('Invalid contact email address').optional(),
    contactPhone: z.string().trim().min(6, 'Contact phone number must be at least 6 characters').max(30, 'Contact phone number cannot exceed 30 characters').optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
  );

export type UpdateStoreInput = z.infer<typeof UpdateStoreSchema>;

export const UpdateStoreStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE'] as const, {
      message: 'Status must be ACTIVE or INACTIVE',
    }),
  })
  .strict();

export type UpdateStoreStatusInput = z.infer<typeof UpdateStoreStatusSchema>;

export class StoreManagementService {
  constructor(private db: Database) {}

  /**
   * Lists all stores the authenticated principal is authorized to manage.
   * PLATFORM_ADMIN sees all stores.
   * MERCHANT users only see stores where they have an ACTIVE tenant_membership.
   * STORE_CUSTOMER is explicitly denied.
   */
  public async listAuthorizedStores(principal: AuthenticatedPrincipal): Promise<Store[]> {
    if (!principal) {
      throw new AuthorizationError('Authentication required');
    }

    if (principal.role === SystemRole.STORE_CUSTOMER) {
      throw new AuthorizationError('Access denied: customer accounts cannot access merchant stores');
    }

    if (principal.role === SystemRole.PLATFORM_ADMIN) {
      return this.db.listStores();
    }

    return this.db.getStoresForUser(principal.id);
  }

  /**
   * Retrieves full store details, store settings, and actor membership for an authorized store.
   * Cross-tenant access attempts are blocked and audited.
   */
  public async getStore(
    targetStoreId: string,
    principal: AuthenticatedPrincipal,
    traceId?: string
  ): Promise<{ store: Store; settings: StoreSettings | null; membership: TenantMembership | null }> {
    if (!principal) {
      throw new AuthorizationError('Authentication required');
    }

    if (principal.role === SystemRole.STORE_CUSTOMER) {
      throw new AuthorizationError('Access denied: customer accounts cannot manage stores');
    }

    const store = this.db.getStore(targetStoreId);
    if (!store) {
      throw new NotFoundError('Store', targetStoreId);
    }

    let membership: TenantMembership | null = null;

    if (principal.role !== SystemRole.PLATFORM_ADMIN) {
      membership = this.db.getUserStoreMembership(principal.id, targetStoreId);

      if (!membership || membership.status !== AccountStatus.ACTIVE) {
        // Tamper-evident audit of cross-tenant violation attempt
        AuditLogService.getInstance().record({
          tenantId: targetStoreId,
          actorId: principal.id,
          actorRole: principal.role,
          action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
          entityType: 'Store',
          entityId: targetStoreId,
          traceId,
          metadata: { reason: 'No active tenant membership on target store' },
        });

        throw new TenantMismatchError('Access forbidden: you do not have permission to manage this store');
      }
    }

    const settings = this.db.getStoreSettings(targetStoreId);

    return { store, settings, membership };
  }

  /**
   * Updates store profile and contact information with strict whitelist validation,
   * slug collision prevention, and tamper-evident audit chaining.
   */
  public async updateStore(
    targetStoreId: string,
    rawPayload: unknown,
    principal: AuthenticatedPrincipal,
    traceId?: string
  ): Promise<{ store: Store; settings: StoreSettings | null }> {
    if (!principal) {
      throw new AuthorizationError('Authentication required to update store');
    }

    if (principal.role === SystemRole.STORE_CUSTOMER) {
      throw new AuthorizationError('Access denied: customer accounts cannot manage stores');
    }

    const store = this.db.getStore(targetStoreId);
    if (!store) {
      throw new NotFoundError('Store', targetStoreId);
    }

    // Role & Membership Authorization:
    // Store-scoped merchant authority is strictly derived from active target store membership.
    // principal.role must NEVER override membership.role on the target store.
    if (principal.role !== SystemRole.PLATFORM_ADMIN) {
      const membership = this.db.getUserStoreMembership(principal.id, targetStoreId);

      if (!membership || membership.status !== AccountStatus.ACTIVE) {
        AuditLogService.getInstance().record({
          tenantId: targetStoreId,
          actorId: principal.id,
          actorRole: principal.role,
          action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
          entityType: 'Store',
          entityId: targetStoreId,
          traceId,
          metadata: { reason: 'Unauthorized store mutation attempt' },
        });
        throw new TenantMismatchError('Access forbidden: you do not have permission to manage this store');
      }

      // Membership role is the authoritative store-scoped authorization source.
      // Even if user's account role is MERCHANT_OWNER (e.g. for another store),
      // they MUST possess MERCHANT_OWNER membership on this specific target store.
      if (membership.role !== SystemRole.MERCHANT_OWNER) {
        throw new AuthorizationError('Access denied: only store owners may modify store profile and settings');
      }
    }

    // Strict schema parse
    const parseResult = UpdateStoreSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      const details = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      throw new ValidationError('Store update validation failed', details);
    }

    const data = parseResult.data;

    // Validate slug if provided
    let normalizedSlug = store.slug;
    if (data.slug && data.slug !== store.slug) {
      const slugValidation = StoreSlugValidator.validate(data.slug);
      if (!slugValidation.valid) {
        throw new ValidationError(slugValidation.reason || 'Invalid slug format');
      }
      normalizedSlug = slugValidation.normalizedSlug;

      const isAvailable = this.db.isSlugAvailable(normalizedSlug, targetStoreId);
      if (!isAvailable) {
        throw new ValidationError(`Store slug '${normalizedSlug}' is already in use by another store`);
      }
    }

    const storeUpdates: Partial<Store> = {};
    if (data.nameAr !== undefined) storeUpdates.nameAr = data.nameAr;
    if (data.nameEn !== undefined) storeUpdates.nameEn = data.nameEn;
    if (data.descriptionAr !== undefined) storeUpdates.descriptionAr = data.descriptionAr;
    if (data.descriptionEn !== undefined) storeUpdates.descriptionEn = data.descriptionEn;
    if (data.slug !== undefined) storeUpdates.slug = normalizedSlug;
    if (data.currency !== undefined) {
      try {
        CurrencyManager.getCurrency(data.currency);
      } catch {
        throw new ValidationError(`Unsupported currency code '${data.currency}'. Supported currencies: ${Object.keys(CurrencyManager.getDefaultCurrency()).length > 0 ? 'SDG, USD, SAR, AED' : 'SDG'}`);
      }
      storeUpdates.currency = data.currency;
    }
    if (data.timezone !== undefined) storeUpdates.timezone = data.timezone;
    if (data.defaultLocale !== undefined) storeUpdates.defaultLocale = data.defaultLocale;

    const settingsUpdates: Partial<StoreSettings> = {};
    if (data.contactEmail !== undefined) settingsUpdates.contactEmail = data.contactEmail;
    if (data.contactPhone !== undefined) settingsUpdates.contactPhone = data.contactPhone;

    // Execute atomic transaction with audit recording (fail-closed)
    const updatedStore = this.db.transaction(() => {
      let updatedS = store;
      if (Object.keys(storeUpdates).length > 0) {
        updatedS = this.db.updateStore(targetStoreId, storeUpdates);
      }

      if (Object.keys(settingsUpdates).length > 0) {
        this.db.updateStoreSettings(targetStoreId, settingsUpdates);
      }

      // Tamper-evident Audit Logging (fail-closed inside transaction)
      AuditLogService.getInstance().record({
        tenantId: targetStoreId,
        actorId: principal.id,
        actorRole: principal.role,
        action: AuditAction.STORE_UPDATED,
        entityType: 'Store',
        entityId: targetStoreId,
        traceId,
        metadata: {
          updatedFields: [...Object.keys(storeUpdates), ...Object.keys(settingsUpdates)],
          oldSlug: store.slug,
          newSlug: updatedS.slug,
        },
      });

      return updatedS;
    });

    const updatedSettings = this.db.getStoreSettings(targetStoreId);
    return { store: updatedStore, settings: updatedSettings };
  }

  /**
   * Updates store lifecycle status (ACTIVE, INACTIVE) with tamper-evident audit record.
   */
  public async updateStoreStatus(
    targetStoreId: string,
    rawPayload: unknown,
    principal: AuthenticatedPrincipal,
    traceId?: string
  ): Promise<Store> {
    if (!principal) {
      throw new AuthorizationError('Authentication required');
    }

    if (principal.role === SystemRole.STORE_CUSTOMER) {
      throw new AuthorizationError('Access denied: customer accounts cannot manage stores');
    }

    const store = this.db.getStore(targetStoreId);
    if (!store) {
      throw new NotFoundError('Store', targetStoreId);
    }

    // Role & Membership Authorization:
    // Store operational status mutation strictly requires MERCHANT_OWNER membership on the target store.
    // principal.role must NEVER override the target store's membership.role.
    if (principal.role !== SystemRole.PLATFORM_ADMIN) {
      const membership = this.db.getUserStoreMembership(principal.id, targetStoreId);

      if (!membership || membership.status !== AccountStatus.ACTIVE) {
        AuditLogService.getInstance().record({
          tenantId: targetStoreId,
          actorId: principal.id,
          actorRole: principal.role,
          action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
          entityType: 'Store',
          entityId: targetStoreId,
          traceId,
          metadata: { reason: 'Unauthorized status change attempt' },
        });
        throw new TenantMismatchError('Access forbidden: you do not have permission to manage this store');
      }

      // Authoritative check on target store membership role
      if (membership.role !== SystemRole.MERCHANT_OWNER) {
        throw new AuthorizationError('Access denied: only store owners can change store operational status');
      }
    }

    const parseResult = UpdateStoreStatusSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      throw new ValidationError('Invalid store status. Must be ACTIVE or INACTIVE');
    }

    const { status: newStatus } = parseResult.data;
    const oldStatus = store.status;

    if (oldStatus === newStatus) {
      return store;
    }

    const updated = this.db.transaction(() => {
      const u = this.db.updateStore(targetStoreId, { status: newStatus as StoreStatus });

      // Tamper-evident Audit Logging inside transaction (fail-closed)
      AuditLogService.getInstance().record({
        tenantId: targetStoreId,
        actorId: principal.id,
        actorRole: principal.role,
        action: AuditAction.STORE_STATUS_CHANGED,
        entityType: 'Store',
        entityId: targetStoreId,
        traceId,
        metadata: {
          oldStatus,
          newStatus,
        },
      });

      return u;
    });

    return updated;
  }

  /**
   * Validates slug availability for merchant UI live validation.
   * 
   * SECURITY ENFORCEMENT:
   * 1. Requires authenticated principal. Customer accounts are strictly denied.
   * 2. If currentStoreId is provided (e.g. merchant updating their existing store slug),
   *    the server verifies that the principal is authorized to operate on that store.
   * 3. An attacker supplying a forged or foreign store ID is rejected with TenantMismatchError
   *    and audited as CROSS_TENANT_ACCESS_BLOCKED.
   */
  public async checkSlugAvailability(
    slug: string,
    currentStoreId?: string,
    principal?: AuthenticatedPrincipal,
    traceId?: string
  ): Promise<{ available: boolean; normalizedSlug: string; reason?: string }> {
    if (!principal) {
      throw new AuthorizationError('Authentication required to verify store slug availability');
    }

    if (principal.role === SystemRole.STORE_CUSTOMER) {
      throw new AuthorizationError('Access denied: customer accounts cannot manage stores');
    }

    const validation = StoreSlugValidator.validate(slug);
    if (!validation.valid) {
      return {
        available: false,
        normalizedSlug: validation.normalizedSlug,
        reason: validation.reason,
      };
    }

    if (currentStoreId) {
      if (!/^[a-z0-9_-]{1,64}$/i.test(currentStoreId)) {
        throw new ValidationError('Invalid currentStoreId format');
      }

      const store = this.db.getStore(currentStoreId);
      if (!store) {
        throw new NotFoundError('Store', currentStoreId);
      }

      if (principal.role !== SystemRole.PLATFORM_ADMIN) {
        const membership = this.db.getUserStoreMembership(principal.id, currentStoreId);
        if (!membership || membership.status !== AccountStatus.ACTIVE) {
          AuditLogService.getInstance().record({
            tenantId: currentStoreId,
            actorId: principal.id,
            actorRole: principal.role,
            action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
            entityType: 'Store',
            entityId: currentStoreId,
            traceId,
            metadata: {
              reason: 'Unauthorized slug check attempt with foreign currentStoreId',
              attemptedStoreId: currentStoreId,
            },
          });
          throw new TenantMismatchError('Access forbidden: you do not have permission to operate on this store');
        }
      }
    }

    const available = this.db.isSlugAvailable(validation.normalizedSlug, currentStoreId);
    return {
      available,
      normalizedSlug: validation.normalizedSlug,
      reason: available ? undefined : 'This store URL is already taken by another store',
    };
  }
}
