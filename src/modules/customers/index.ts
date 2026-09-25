/**
 * Customers Module (Architectural Boundary - Phase 9)
 * Manages store customer directory, purchase history, and delivery addresses.
 */

import { TenantScopedEntity } from '../core/index.ts';

export interface CustomerEntity extends TenantScopedEntity {
  fullName: string;
  phone: string;
  email?: string;
  defaultCity?: string;
  totalOrdersCount: number;
}

export interface ICustomersModuleService {
  getCustomer(tenantId: string, customerId: string): Promise<CustomerEntity | null>;
  listCustomers(tenantId: string): Promise<CustomerEntity[]>;
}
