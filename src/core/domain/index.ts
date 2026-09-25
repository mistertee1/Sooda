/**
 * Foundation Domain Entities & Enums
 * Defines the foundational entities for the Sudan SaaS Multi-Tenant Platform.
 */

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null; // Soft-delete support
}

export interface TenantScopedEntity extends BaseEntity {
  tenantId: string; // Foreign key mapping to Tenant/Store ID
}

// Conceptual Entity: Platform
export interface Platform extends BaseEntity {
  name: string;
  code: string; // e.g. "sooda-core"
  primaryDomain: string; // "sooda.sd"
  status: 'ACTIVE' | 'MAINTENANCE' | 'DEGRADED';
  version: string;
  defaultCurrency: string; // 'SDG'
  supportedLanguages: string[]; // ['ar', 'en']
}

// Conceptual Entity: Role & Permissions
export enum SystemRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  MERCHANT_OWNER = 'MERCHANT_OWNER',
  MERCHANT_STAFF = 'MERCHANT_STAFF',
  STORE_CUSTOMER = 'STORE_CUSTOMER',
}

export enum Permission {
  // Platform Admin Permissions (Strictly separated)
  PLATFORM_MANAGE_ALL = 'platform:manage_all',
  PLATFORM_VIEW_METRICS = 'platform:view_metrics',
  PLATFORM_MANAGE_TENANTS = 'platform:manage_tenants',
  PLATFORM_MANAGE_PLANS = 'platform:manage_plans',

  // Merchant Store Owner & Staff Permissions
  STORE_MANAGE_SETTINGS = 'store:manage_settings',
  STORE_CUSTOMIZE_THEME = 'store:customize_theme',
  STORE_MANAGE_STAFF = 'store:manage_staff',
  STORE_VIEW_ANALYTICS = 'store:view_analytics',
  
  // Future domain scopes (prepared for later phases)
  PRODUCTS_CREATE = 'products:create',
  PRODUCTS_READ = 'products:read',
  PRODUCTS_UPDATE = 'products:update',
  PRODUCTS_DELETE = 'products:delete',

  ORDERS_READ = 'orders:read',
  ORDERS_UPDATE = 'orders:update',
  
  PAYMENTS_MANAGE_METHODS = 'payments:manage_methods',
  PAYMENTS_VERIFY_RECEIPTS = 'payments:verify_receipts',

  // Customer Permissions
  CUSTOMER_CHECKOUT = 'customer:checkout',
  CUSTOMER_VIEW_OWN_ORDERS = 'customer:view_own_orders',
}

// Conceptual Entity: Account Status
export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  LOCKED = 'LOCKED',
}

// Conceptual Entity: Tenant Membership
export interface TenantMembership extends BaseEntity {
  userId: string;
  tenantId: string;
  role: SystemRole;
  status: AccountStatus;
}

// Conceptual Entity: Authenticated Session
export interface Session {
  id: string;
  userId: string;
  sessionTokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  isRevoked: boolean;
}

// Conceptual Entity: User Credentials (internal representation; never exposed to API)
export interface UserCredentials {
  userId: string;
  passwordHash: string;
  passwordAlgo: string;
  updatedAt: string;
}

// Conceptual Entity: User (Core User Account)
// In Phase 2, a User represents the foundational UserAccount.
// Future architecture allows a single UserAccount to link to a CustomerProfile (for retail purchasing),
// a MerchantProfile (for business ownership), or both.
export interface User extends BaseEntity {
  email: string;
  normalizedEmail: string;
  phone?: string; // Sudan mobile format: +249 9x/1x
  fullName: string;
  role: SystemRole;
  status: AccountStatus;
  isActive: boolean; // Backwards-compatible flag mirroring status === AccountStatus.ACTIVE
  preferredLanguage: 'ar' | 'en';
  lastLoginAt?: string;
  failedLoginAttempts?: number;
  lockedUntil?: string | null;
  // If merchant or staff, primary associated tenant/store ID:
  tenantId?: string | null;
  // Multiple tenant memberships
  memberships?: TenantMembership[];
}

// UserAccount abstraction: Root identity entity
export type UserAccount = User;

// Conceptual Entity: CustomerProfile (Retail Customer Identity Foundation)
// Architecturally separated from merchant identity.
// A UserAccount may link to a CustomerProfile without having merchant privileges.
export interface CustomerProfile extends BaseEntity {
  userId: string;
  fullName: string;
  phoneNumber?: string;
  defaultCity?: string;
  shippingAddress?: string;
  preferredLanguage?: 'ar' | 'en';
}

// Conceptual Entity: Merchant (Business Profile)
export interface Merchant extends BaseEntity {
  ownerUserId: string;
  businessName: string;
  tradeNameAr: string;
  commercialRegistrationNumber?: string;
  countryCode: string; // "SD"
  city: string; // e.g. "الخرطوم", "أم درمان", "بورتسودان", "كسلا", "مدني"
  phoneNumber: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
}

// MerchantProfile abstraction: Business profile entity
export type MerchantProfile = Merchant;

// StoreMembership abstraction: Associates a UserAccount with a Store
export type StoreMembership = TenantMembership;

// Conceptual Entity: Store (Primary Tenant Unit)
// Strictly minimal state model for Phase 2:
// - ACTIVE: Store is open, accessible via dashboard, and eligible for storefront/catalog indexing.
// - INACTIVE: Store is deactivated/paused, accessible via dashboard for settings, but closed to external commerce.
export type StoreStatus = 'ACTIVE' | 'INACTIVE';

export interface Store extends BaseEntity {
  merchantId: string;
  slug: string; // Unique URL identifier (e.g. "albaraka" -> albaraka.sooda.sd)
  nameAr: string;
  nameEn: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  status: StoreStatus;
  currency: string; // Default 'SDG'
  timezone: string; // 'Africa/Khartoum'
  defaultLocale?: 'ar' | 'en';
}

// Conceptual Entity: StoreSettings
export interface StoreSettings extends TenantScopedEntity {
  storeId: string;
  contactEmail: string;
  contactPhone: string;
  allowGuestCheckout: boolean;
  orderNotificationPhone?: string;
  taxEnabled: boolean;
  taxPercentage?: number;
  maintenanceMode: boolean;
}

// Conceptual Entity: StoreTheme
export interface StoreTheme extends TenantScopedEntity {
  storeId: string;
  primaryColor: string; // e.g. Emerald, Nile Indigo, Earth Sand
  accentColor: string;
  fontFamily: string; // 'Cairo' | 'IBM Plex Sans Arabic' | 'Tajawal'
  direction: 'rtl' | 'ltr';
  logoUrl?: string;
  bannerUrl?: string;
  activeLayout: 'modern' | 'minimal' | 'showcase';
}

// Conceptual Entity: Domain
export interface Domain extends TenantScopedEntity {
  storeId: string;
  hostname: string; // e.g. "albaraka.sooda.sd" or custom domain "albarakashop.sd"
  isPrimary: boolean;
  isCustom: boolean;
  sslStatus: 'PENDING' | 'ACTIVE' | 'FAILED';
  verificationToken?: string;
}
