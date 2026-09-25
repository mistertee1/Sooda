/**
 * Store Module
 * Represents the primary tenant unit. Holds store configuration, theme branding, and domains.
 */

import { BaseEntity, TenantScopedEntity } from '../core/index.ts';

export interface StoreEntity extends BaseEntity {
  merchantId: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  status: 'ACTIVE' | 'INACTIVE';
  currency: string;
  timezone: string;
}

export interface StoreSettingsEntity extends TenantScopedEntity {
  storeId: string;
  contactEmail: string;
  contactPhone: string;
  allowGuestCheckout: boolean;
  orderNotificationPhone?: string;
  taxEnabled: boolean;
  taxPercentage?: number;
  maintenanceMode: boolean;
}

export interface StoreThemeEntity extends TenantScopedEntity {
  storeId: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  direction: 'rtl' | 'ltr';
  logoUrl?: string;
  bannerUrl?: string;
  activeLayout: string;
}

export interface IStoreModuleService {
  getStoreById(id: string): Promise<StoreEntity | null>;
  getStoreBySlug(slug: string): Promise<StoreEntity | null>;
  getStoreSettings(tenantId: string): Promise<StoreSettingsEntity | null>;
  getStoreTheme(tenantId: string): Promise<StoreThemeEntity | null>;
  updateStoreSettings(tenantId: string, updates: Partial<StoreSettingsEntity>): Promise<StoreSettingsEntity>;
}
