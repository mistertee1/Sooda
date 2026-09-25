import { SystemRole, AccountStatus } from '../../core/domain/index.ts';
import { AuthenticatedPrincipal } from '../../core/auth/index.ts';

/**
 * Isolated test/development fixture containing test principals.
 * STRICTLY ISOLATED TO TEST AND DEVELOPMENT HARNESSES.
 * NEVER IMPORTED INTO PRODUCTION SOURCE OR BUNDLES.
 */
export const DEV_TEST_PRINCIPALS_FIXTURE: Record<string, AuthenticatedPrincipal> = {
  token_platform_admin: {
    id: 'user_platform_admin',
    email: 'admin@sooda.sd',
    role: SystemRole.PLATFORM_ADMIN,
    status: AccountStatus.ACTIVE,
    tenantId: null,
    fullName: 'مدير المنصة العام (Test Principal)',
    memberships: [],
  },
  token_albaraka_owner: {
    id: 'user_merchant_albaraka_owner',
    email: 'owner@albaraka.sd',
    role: SystemRole.MERCHANT_OWNER,
    status: AccountStatus.ACTIVE,
    tenantId: 'tenant_store_albaraka',
    fullName: 'أحمد البشير (Test Principal)',
    memberships: [
      {
        id: 'membership_albaraka_owner',
        userId: 'user_merchant_albaraka_owner',
        tenantId: 'tenant_store_albaraka',
        role: SystemRole.MERCHANT_OWNER,
        status: AccountStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
  token_albaraka_staff: {
    id: 'user_merchant_albaraka_staff',
    email: 'staff@albaraka.sd',
    role: SystemRole.MERCHANT_STAFF,
    status: AccountStatus.ACTIVE,
    tenantId: 'tenant_store_albaraka',
    fullName: 'عثمان الفاضل (Test Principal)',
    memberships: [
      {
        id: 'membership_albaraka_staff',
        userId: 'user_merchant_albaraka_staff',
        tenantId: 'tenant_store_albaraka',
        role: SystemRole.MERCHANT_STAFF,
        status: AccountStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
  token_nilecrafts_owner: {
    id: 'user_merchant_nilecrafts_owner',
    email: 'owner@nilecrafts.sd',
    role: SystemRole.MERCHANT_OWNER,
    status: AccountStatus.ACTIVE,
    tenantId: 'tenant_store_nilecrafts',
    fullName: 'سارة عبد الله (Test Principal)',
    memberships: [
      {
        id: 'membership_nilecrafts_owner',
        userId: 'user_merchant_nilecrafts_owner',
        tenantId: 'tenant_store_nilecrafts',
        role: SystemRole.MERCHANT_OWNER,
        status: AccountStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
};
