/**
 * Application Services Layer
 * 
 * Implements the Clean Architecture pattern:
 * Route / Controller -> Application Service / Use Case -> Domain Logic -> Repository -> Database.
 * 
 * RULES:
 * 1. Business rules and access validation live in Application Services, NEVER in HTTP routes.
 * 2. All tenant operations assert tenant ownership and role permissions.
 * 3. Sensitive operations emit tamper-evident audit records.
 */

import { Database, TenantRepository } from '../database/index.ts';
import { Store, StoreSettings, StoreTheme, SystemRole, Permission } from '../domain/index.ts';
import { AuthorizationPolicy, AuthenticatedPrincipal } from '../auth/index.ts';
import { AuditLogService, AuditAction } from '../observability/index.ts';
import { TenantResolver } from '../tenant/index.ts';
import { AuthorizationError, NotFoundError, TenantMismatchError } from '../errors/index.ts';

export class TenantSettingsService {
  private repo: TenantRepository;

  constructor(private db: Database) {
    this.repo = new TenantRepository(db, 'store_settings');
  }

  /**
   * Retrieves store settings ensuring actor belongs to the requested tenant or is platform admin.
   */
  public async getSettings(
    targetTenantId: string,
    actor: AuthenticatedPrincipal | null,
    traceId?: string
  ): Promise<StoreSettings> {
    if (!actor) {
      throw new AuthorizationError('Authentication required to access store settings');
    }

    // Platform admins can inspect any tenant
    if (actor.role === SystemRole.PLATFORM_ADMIN) {
      const settings = this.db.getStoreSettings(targetTenantId);
      if (!settings) throw new NotFoundError('StoreSettings', targetTenantId);

      AuditLogService.getInstance().record({
        tenantId: targetTenantId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.TENANT_SETTINGS_ACCESSED,
        entityType: 'StoreSettings',
        entityId: targetTenantId,
        traceId,
        metadata: { accessBy: 'PLATFORM_ADMIN' },
      });

      return settings;
    }

    // Merchant verification
    AuthorizationPolicy.assertAuthorized(actor, Permission.STORE_MANAGE_SETTINGS, targetTenantId);

    const settings = this.repo.findStoreSettings(targetTenantId, actor.tenantId!);

    AuditLogService.getInstance().record({
      tenantId: targetTenantId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.TENANT_SETTINGS_ACCESSED,
      entityType: 'StoreSettings',
      entityId: targetTenantId,
      traceId,
    });

    return settings;
  }

  /**
   * Updates store settings with strict ownership and permission enforcement.
   */
  public async updateSettings(
    targetTenantId: string,
    updates: Partial<StoreSettings>,
    actor: AuthenticatedPrincipal | null,
    traceId?: string
  ): Promise<StoreSettings> {
    if (!actor) {
      throw new AuthorizationError('Authentication required to update store settings');
    }

    if (actor.role === SystemRole.PLATFORM_ADMIN) {
      const updated = this.db.updateStoreSettings(targetTenantId, updates);
      AuditLogService.getInstance().record({
        tenantId: targetTenantId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AuditAction.TENANT_SETTINGS_UPDATED,
        entityType: 'StoreSettings',
        entityId: targetTenantId,
        traceId,
        metadata: { updatedFields: Object.keys(updates) },
      });
      return updated;
    }

    AuthorizationPolicy.assertAuthorized(actor, Permission.STORE_MANAGE_SETTINGS, targetTenantId);

    const updated = this.repo.updateStoreSettings(targetTenantId, actor.tenantId!, updates);

    AuditLogService.getInstance().record({
      tenantId: targetTenantId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.TENANT_SETTINGS_UPDATED,
      entityType: 'StoreSettings',
      entityId: targetTenantId,
      traceId,
      metadata: { updatedFields: Object.keys(updates) },
    });

    return updated;
  }

  /**
   * Deletes store settings (soft deletion).
   */
  public async deleteSettings(
    targetTenantId: string,
    actor: AuthenticatedPrincipal | null,
    traceId?: string
  ): Promise<void> {
    if (!actor) {
      throw new AuthorizationError('Authentication required to delete store settings');
    }

    if (actor.role === SystemRole.PLATFORM_ADMIN) {
      this.db.softDeleteStoreSettings(targetTenantId);
      return;
    }

    AuthorizationPolicy.assertAuthorized(actor, Permission.STORE_MANAGE_SETTINGS, targetTenantId);
    this.repo.deleteStoreSettings(targetTenantId, actor.tenantId!);
  }
}

export interface PublicStorefrontProfile {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  currency: string;
  theme?: StoreTheme | null;
}

export class StorefrontService {
  constructor(private db: Database) {}

  /**
   * Resolves public storefront information by slug.
   * STRICTLY SANITIZES data: NO internal emails, phone numbers, or private settings.
   */
  public resolvePublicStorefront(slug: string): PublicStorefrontProfile | null {
    const store = this.db.getStoreBySlug(slug);
    if (!store || store.status !== 'ACTIVE') {
      return null;
    }

    const theme = this.db.getStoreTheme(store.id);

    return {
      id: store.id,
      slug: store.slug,
      nameAr: store.nameAr,
      nameEn: store.nameEn,
      currency: store.currency,
      theme,
    };
  }

  public getStoreTheme(tenantId: string): StoreTheme | null {
    return this.db.getStoreTheme(tenantId);
  }
}

export class PlatformAdministrationService {
  constructor(private db: Database) {}

  public getPlatformMetrics(actor: AuthenticatedPrincipal | null): Record<string, unknown> {
    if (!actor || actor.role !== SystemRole.PLATFORM_ADMIN) {
      throw new AuthorizationError('Platform Admin role required to access global platform metrics');
    }

    const platform = this.db.getPlatform();
    const stores = this.db.listStores();

    return {
      platform,
      totalStoresCount: stores.length,
      activeStoresCount: stores.filter((s) => s.status === 'ACTIVE').length,
      timestamp: new Date().toISOString(),
    };
  }
}

export * from './store.service.ts';
