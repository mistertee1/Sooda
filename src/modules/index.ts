/**
 * Modular Architecture Index
 * 
 * Defines the 16 architectural modules of the Sooda SaaS Platform:
 * - Core
 * - Identity
 * - Tenancy
 * - Merchant
 * - Store
 * - Catalog
 * - Inventory
 * - Cart
 * - Orders
 * - Payments
 * - Shipping
 * - Customers
 * - Notifications
 * - Marketplace
 * - Billing
 * - Audit
 * 
 * ARCHITECTURAL RULE:
 * A module must never access another module's internal database tables directly.
 * Inter-module communication must traverse:
 * Module Public Interface -> Application Service -> Repository.
 */

export * from './core/index.ts';
export * from './identity/index.ts';
export * from './tenancy/index.ts';
export * from './merchant/index.ts';
export * from './store/index.ts';
export * from './catalog/index.ts';
export * from './inventory/index.ts';
export * from './cart/index.ts';
export * from './orders/index.ts';
export * from './payments/index.ts';
export * from './shipping/index.ts';
export * from './customers/index.ts';
export * from './notifications/index.ts';
export * from './marketplace/index.ts';
export * from './billing/index.ts';
export * from './audit/index.ts';
