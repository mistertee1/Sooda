/**
 * Cart Module (Architectural Boundary - Phase 5)
 * Manages customer shopping baskets, item calculation, and session-level carts.
 */

import { TenantScopedEntity } from '../core/index.ts';

export interface CartLineItem {
  variantId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface CartEntity extends TenantScopedEntity {
  customerId?: string;
  sessionToken: string;
  items: CartLineItem[];
  subtotal: number;
  total: number;
  currency: string;
}

export interface ICartModuleService {
  getCart(tenantId: string, cartId: string): Promise<CartEntity | null>;
  addItem(tenantId: string, cartId: string, item: CartLineItem): Promise<CartEntity>;
  clearCart(tenantId: string, cartId: string): Promise<void>;
}
