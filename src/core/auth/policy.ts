import { SystemRole, Permission, User, AccountStatus, TenantMembership } from '../domain/index.ts';
import { AuthorizationError, TenantMismatchError } from '../errors/index.ts';

// Role -> Permission Mapping
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  [SystemRole.PLATFORM_ADMIN]: [
    Permission.PLATFORM_MANAGE_ALL,
    Permission.PLATFORM_VIEW_METRICS,
    Permission.PLATFORM_MANAGE_TENANTS,
    Permission.PLATFORM_MANAGE_PLANS,
  ],
  [SystemRole.MERCHANT_OWNER]: [
    Permission.STORE_MANAGE_SETTINGS,
    Permission.STORE_CUSTOMIZE_THEME,
    Permission.STORE_MANAGE_STAFF,
    Permission.STORE_VIEW_ANALYTICS,
    Permission.PRODUCTS_CREATE,
    Permission.PRODUCTS_READ,
    Permission.PRODUCTS_UPDATE,
    Permission.PRODUCTS_DELETE,
    Permission.ORDERS_READ,
    Permission.ORDERS_UPDATE,
    Permission.PAYMENTS_MANAGE_METHODS,
    Permission.PAYMENTS_VERIFY_RECEIPTS,
  ],
  [SystemRole.MERCHANT_STAFF]: [
    Permission.PRODUCTS_READ,
    Permission.PRODUCTS_UPDATE,
    Permission.ORDERS_READ,
    Permission.ORDERS_UPDATE,
  ],
  [SystemRole.STORE_CUSTOMER]: [
    Permission.PRODUCTS_READ,
    Permission.CUSTOMER_CHECKOUT,
    Permission.CUSTOMER_VIEW_OWN_ORDERS,
  ],
};

export class AuthorizationPolicy {
  /**
   * Evaluates whether a user has a specific permission.
   * If targetTenantId is supplied, validates tenant boundary.
   */
  public static can(
    user: Pick<User, 'id' | 'role' | 'tenantId'> | null | undefined,
    permission: Permission,
    targetTenantId?: string
  ): boolean {
    if (!user) {
      return false;
    }

    // Check role permission grants
    const permissions = ROLE_PERMISSIONS[user.role] || [];
    const hasPermission = permissions.includes(permission);

    if (!hasPermission) {
      return false;
    }

    // If it's a platform admin, they don't have tenant boundaries for platform actions
    if (user.role === SystemRole.PLATFORM_ADMIN) {
      return true;
    }

    // For Merchant Owner or Staff, if operating on a tenant-scoped resource,
    // they MUST belong to the same tenant (via direct tenantId or active membership)!
    if (targetTenantId) {
      const directMatch = user.tenantId && user.tenantId === targetTenantId;
      const membershipMatch = (user as any).memberships?.some(
        (m: TenantMembership) => m.tenantId === targetTenantId && m.status === AccountStatus.ACTIVE
      );
      if (!directMatch && !membershipMatch) {
        return false;
      }
    }

    return true;
  }

  /**
   * Asserts authorization and throws appropriate strongly-typed error if denied.
   */
  public static assertAuthorized(
    user: Pick<User, 'id' | 'role' | 'tenantId'> | null | undefined,
    requiredPermission: Permission,
    targetTenantId?: string
  ): void {
    if (!user) {
      throw new AuthorizationError('Authentication required to perform this action');
    }

    const permissions = ROLE_PERMISSIONS[user.role] || [];
    if (!permissions.includes(requiredPermission)) {
      throw new AuthorizationError(
        `Role '${user.role}' lacks permission '${requiredPermission}'`
      );
    }

    // Platform admins are exempt from tenant mismatch
    if (user.role === SystemRole.PLATFORM_ADMIN) {
      return;
    }

    // Tenant boundary check
    if (targetTenantId) {
      const directMatch = user.tenantId && user.tenantId === targetTenantId;
      const membershipMatch = (user as any).memberships?.some(
        (m: TenantMembership) => m.tenantId === targetTenantId && m.status === AccountStatus.ACTIVE
      );
      if (!directMatch && !membershipMatch) {
        throw new TenantMismatchError(
          `Cross-tenant access blocked. Actor tenant '${user.tenantId || 'NONE'}' cannot access target '${targetTenantId}'.`
        );
      }
    }
  }

  /**
   * Helper to verify that platform-admin permissions can NEVER be granted to merchant roles.
   */
  public static isPlatformAdminOnly(permission: Permission): boolean {
    const adminPerms = ROLE_PERMISSIONS[SystemRole.PLATFORM_ADMIN];
    const merchantPerms = ROLE_PERMISSIONS[SystemRole.MERCHANT_OWNER];
    return adminPerms.includes(permission) && !merchantPerms.includes(permission);
  }
}
