/**
 * Shipping Module (Architectural Boundary - Phase 8)
 * Sudan delivery zones (Khartoum, Omdurman, Port Sudan, etc.), merchant delivery fees, courier routing.
 */

import { TenantScopedEntity } from '../core/index.ts';

export interface ShippingZoneEntity extends TenantScopedEntity {
  nameAr: string;
  nameEn?: string;
  cities: string[];
  baseRate: number;
  estimatedDeliveryDays: number;
  isActive: boolean;
}

export interface IShippingModuleService {
  getZones(tenantId: string): Promise<ShippingZoneEntity[]>;
  calculateShippingRate(tenantId: string, city: string): Promise<number>;
}
