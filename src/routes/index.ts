/**
 * Routing Architecture & Protection Strategy
 * Prepares and registers route contracts for future phases.
 * Enforces route authorization boundaries without implementing future business logic.
 */

import { SystemRole, Permission, User } from '../core/domain/index.ts';
import { AuthorizationPolicy } from '../core/auth/policy.ts';

export enum RouteAccessLevel {
  PUBLIC = 'PUBLIC',
  AUTHENTICATED = 'AUTHENTICATED',
  MERCHANT_TENANT = 'MERCHANT_TENANT',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
}

export interface RouteDefinition {
  path: string;
  nameKey: string;
  accessLevel: RouteAccessLevel;
  requiredRole?: SystemRole[];
  requiredPermission?: Permission;
  descriptionAr: string;
  descriptionEn: string;
}

export const PLATFORM_ROUTES: RouteDefinition[] = [
  // Public Routes
  {
    path: '/',
    nameKey: 'home',
    accessLevel: RouteAccessLevel.PUBLIC,
    descriptionAr: 'الصفحة الترحيبية ومقدمة منصة سُودا',
    descriptionEn: 'Landing and Platform Overview',
  },
  {
    path: '/login',
    nameKey: 'login',
    accessLevel: RouteAccessLevel.PUBLIC,
    descriptionAr: 'تسجيل الدخول للتجار ومسؤولي المتاجر',
    descriptionEn: 'Merchant & Staff Authentication',
  },
  {
    path: '/register',
    nameKey: 'register',
    accessLevel: RouteAccessLevel.PUBLIC,
    descriptionAr: 'إنشاء حساب تاجر جديد ومتجر إلكتروني',
    descriptionEn: 'Merchant Store Registration',
  },
  {
    path: '/forgot-password',
    nameKey: 'forgotPassword',
    accessLevel: RouteAccessLevel.PUBLIC,
    descriptionAr: 'استعادة كلمة المرور عبر البريد أو الهاتف',
    descriptionEn: 'Password Recovery Flow',
  },

  // Store Front Public Route
  {
    path: '/store',
    nameKey: 'store',
    accessLevel: RouteAccessLevel.PUBLIC,
    descriptionAr: 'واجهة المتجر العامة للمتسوقين (معزولة بنطاق المستأجر)',
    descriptionEn: 'Tenant-isolated Public Customer Storefront',
  },

  // Merchant Dashboard & Operations (Requires Tenant Isolation + Merchant Role)
  {
    path: '/dashboard',
    nameKey: 'dashboard',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER, SystemRole.MERCHANT_STAFF],
    requiredPermission: Permission.STORE_VIEW_ANALYTICS,
    descriptionAr: 'لوحة قيادة المتجر والمؤشرات الرئيسية للتاجر',
    descriptionEn: 'Merchant Operations & Store KPI Dashboard',
  },
  {
    path: '/products',
    nameKey: 'products',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER, SystemRole.MERCHANT_STAFF],
    requiredPermission: Permission.PRODUCTS_READ,
    descriptionAr: 'إدارة كتالوج المنتجات والمخزون والتصنيفات',
    descriptionEn: 'Catalog, Products & Inventory Management',
  },
  {
    path: '/orders',
    nameKey: 'orders',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER, SystemRole.MERCHANT_STAFF],
    requiredPermission: Permission.ORDERS_READ,
    descriptionAr: 'استعراض وإدارة طلبات المتجر وحالات التنفيذ',
    descriptionEn: 'Order Processing & Status Pipeline',
  },
  {
    path: '/customers',
    nameKey: 'customers',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER, SystemRole.MERCHANT_STAFF],
    descriptionAr: 'سجل عملاء المتجر وتاريخ المشتريات',
    descriptionEn: 'Tenant Customer Directory & History',
  },
  {
    path: '/payments',
    nameKey: 'payments',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER],
    requiredPermission: Permission.PAYMENTS_MANAGE_METHODS,
    descriptionAr: 'إعدادات الحسابات البنكية ومراجعة إيصالات الدفع اليدوي',
    descriptionEn: 'Merchant Payment Accounts & Receipt Review',
  },
  {
    path: '/shipping',
    nameKey: 'shipping',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER],
    descriptionAr: 'مناطق الشحن والمدن والتوصيل في السودان',
    descriptionEn: 'Shipping Zones, Rates & Local Delivery',
  },
  {
    path: '/settings',
    nameKey: 'settings',
    accessLevel: RouteAccessLevel.MERCHANT_TENANT,
    requiredRole: [SystemRole.MERCHANT_OWNER],
    requiredPermission: Permission.STORE_MANAGE_SETTINGS,
    descriptionAr: 'إعدادات المتجر والهوية والمظهر والنطاقات',
    descriptionEn: 'Store Configuration, Domain & Branding',
  },

  // Platform Admin (Strictly Segregated from Merchant Access)
  {
    path: '/admin',
    nameKey: 'admin',
    accessLevel: RouteAccessLevel.PLATFORM_ADMIN,
    requiredRole: [SystemRole.PLATFORM_ADMIN],
    requiredPermission: Permission.PLATFORM_MANAGE_ALL,
    descriptionAr: 'إدارة المنصة الشاملة والمستأجرين والخطط',
    descriptionEn: 'Global Platform Admin & Tenant Supervision',
  },
];

export class RouteGuard {
  /**
   * Asserts whether a given user can access a designated route definition.
   */
  public static canAccess(
    route: RouteDefinition,
    user: Pick<User, 'id' | 'role' | 'tenantId'> | null | undefined,
    activeTenantId?: string
  ): { allowed: boolean; reason?: string } {
    // 1. Public route check
    if (route.accessLevel === RouteAccessLevel.PUBLIC) {
      return { allowed: true };
    }

    // 2. Authentication check
    if (!user) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // 3. Platform Admin route check
    if (route.accessLevel === RouteAccessLevel.PLATFORM_ADMIN) {
      if (user.role !== SystemRole.PLATFORM_ADMIN) {
        return { allowed: false, reason: 'Requires Platform Admin privileges' };
      }
      return { allowed: true };
    }

    // 4. Role restriction
    if (route.requiredRole && !route.requiredRole.includes(user.role)) {
      return { allowed: false, reason: `Role '${user.role}' is not permitted for this route` };
    }

    // 5. Permission restriction
    if (route.requiredPermission) {
      if (!AuthorizationPolicy.can(user, route.requiredPermission, activeTenantId)) {
        return { allowed: false, reason: `User lacks permission '${route.requiredPermission}'` };
      }
    }

    // 6. Tenant-scoped route validation
    if (route.accessLevel === RouteAccessLevel.MERCHANT_TENANT) {
      if (user.role === SystemRole.PLATFORM_ADMIN) {
        return { allowed: true }; // Admin can inspect
      }

      const directMatch = user.tenantId && (!activeTenantId || user.tenantId === activeTenantId);
      const membershipMatch = (user as any).memberships?.some(
        (m: any) => (!activeTenantId || m.tenantId === activeTenantId) && (m.status === 'ACTIVE' || !m.status)
      );

      if (!directMatch && !membershipMatch) {
        return { allowed: false, reason: 'User is not bound to a merchant store tenant' };
      }
    }

    return { allowed: true };
  }
}
