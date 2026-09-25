/**
 * Orders Module (Architectural Boundary - Phase 6)
 * Orchestrates order placement, order status transitions, fulfillment states, and receipts.
 */

import { TenantScopedEntity } from '../core/index.ts';

export enum OrderStatus {
  PENDING = 'PENDING',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export interface OrderItem {
  productId: string;
  variantId: string;
  title: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderEntity extends TenantScopedEntity {
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  totalAmount: number;
  currency: string;
  shippingAddress: Record<string, string>;
}

export interface IOrdersModuleService {
  getOrder(tenantId: string, orderId: string): Promise<OrderEntity | null>;
  listOrders(tenantId: string, options?: { limit?: number; offset?: number }): Promise<OrderEntity[]>;
}
