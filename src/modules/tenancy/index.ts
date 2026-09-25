/**
 * Tenancy Module
 * Handles tenant boundary resolution, host-to-tenant mapping, and isolation context.
 * 
 * CRITICAL RULE:
 * Tenant resolution only extracts context (e.g. store ID, slug).
 * It NEVER confers authorization to act on that tenant.
 */

export interface TenantContext {
  tenantId: string;
  storeSlug: string;
  storeName: string;
  isActive: boolean;
  currency: string;
  merchantId: string;
  readonly isAuthorized: false; // Explicitly false upon resolution
}

export interface ITenancyModuleService {
  resolveFromHost(host?: string): Promise<TenantContext | null>;
  resolveFromSlug(slug: string): Promise<TenantContext | null>;
  assertOwnership(actorTenantId: string | undefined, targetTenantId: string, isPlatformAdmin?: boolean): void;
}
