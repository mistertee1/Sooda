/**
 * Inventory Module (Architectural Boundary - Phase 4)
 * Manages stock levels, reservations, locations, and inventory holds during order flow.
 */

import { TenantScopedEntity } from '../core/index.ts';

export interface InventoryItemEntity extends TenantScopedEntity {
  variantId: string;
  sku: string;
  stockedQuantity: number;
  reservedQuantity: number;
  allowBackorder: boolean;
}

export interface IInventoryModuleService {
  reserveStock(tenantId: string, items: Array<{ variantId: string; quantity: number }>): Promise<boolean>;
  releaseStock(tenantId: string, items: Array<{ variantId: string; quantity: number }>): Promise<boolean>;
  getStockLevel(tenantId: string, variantId: string): Promise<number>;
}
