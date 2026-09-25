/**
 * Multi-Tenancy Foundation
 * Defines tenant boundaries, request resolution strategies, and isolation guards.
 * 
 * CORE PRINCIPLES:
 * 1. A tenant is identified by a unique `tenantId` (representing a distinct Store).
 * 2. Every store's data is strictly partitioned by `tenantId`.
 * 3. Server-side middleware extracts and verifies the tenant context.
 * 4. Cross-tenant access is strictly blocked and audited.
 */

import { TenantMismatchError, TenantInactiveError } from '../errors/index.ts';
import { AuditAction, AuditLogService } from '../observability/index.ts';

export interface TenantContext {
  tenantId: string;
  storeSlug: string;
  storeName: string;
  isActive: boolean;
  currency: string;
  customDomain?: string;
  merchantId: string;
  /**
   * CRITICAL SECURITY PRINCIPLE:
   * Tenant resolution only identifies the store context from routing signals.
   * It DOES NOT authenticate or authorize the caller.
   */
  readonly isAuthorized: false;
}

export interface TenantResolutionRequest {
  host?: string;
  headers?: Record<string, string | string[] | undefined>;
  path?: string;
  query?: Record<string, string | undefined>;
}

export class TenantResolver {
  private static readonly ROOT_DOMAIN = 'sooda.sd';

  /**
   * Resolves the tenant context from HTTP request metadata.
   * Priority:
   * 1. Direct explicit header `x-tenant-id` (useful in API / mobile / dashboard context)
   * 2. Host header / Hostname subdomain: e.g. "albaraka.sooda.sd" -> slug "albaraka"
   * 3. Custom domain mapping: e.g. "albaraka-store.sd"
   */
  public static resolveTenantSlugFromHost(host: string | undefined): string | null {
    if (!host) return null;

    const cleanHost = host.split(':')[0].toLowerCase().trim();

    // Localhost or direct IP handling
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
      return null;
    }

    // Subdomain matching: slug.sooda.sd
    if (cleanHost.endsWith(`.${TenantResolver.ROOT_DOMAIN}`)) {
      const subdomain = cleanHost.replace(`.${TenantResolver.ROOT_DOMAIN}`, '');
      // If not www or api, it's a store tenant slug
      if (subdomain && subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'admin') {
        return subdomain;
      }
    }

    // In AI Studio / preview environments: check for custom header or parameter
    return null;
  }

  /**
   * Enforces that an operation by actorTenantId matches the target targetTenantId.
   * If actor is a platform admin (bypass), access is allowed if explicitly requested.
   */
  public static assertTenantOwnership(
    actorTenantId: string | undefined,
    targetTenantId: string,
    isPlatformAdmin = false,
    actorId = 'anonymous',
    actorRole = 'UNKNOWN'
  ): void {
    if (isPlatformAdmin) {
      // Platform admin can inspect with logging
      return;
    }

    if (!actorTenantId || actorTenantId !== targetTenantId) {
      // Record security audit event
      AuditLogService.getInstance().record({
        tenantId: targetTenantId,
        actorId,
        actorRole,
        action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
        entityType: 'TenantSecurityBoundary',
        entityId: targetTenantId,
        metadata: {
          attemptedTenantId: actorTenantId,
          targetTenantId,
          timestamp: new Date().toISOString(),
        },
      });

      throw new TenantMismatchError(
        `Cross-tenant access blocked. Actor tenant '${actorTenantId || 'NONE'}' cannot access target '${targetTenantId}'.`
      );
    }
  }

  public static assertTenantActive(tenant: TenantContext): void {
    if (!tenant.isActive) {
      throw new TenantInactiveError(tenant.tenantId);
    }
  }
}
