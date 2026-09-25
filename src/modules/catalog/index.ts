/**
 * Catalog Module (Architectural Boundary - Phase 3)
 * Manages tenant-scoped products, categories, collections, and variants.
 * 
 * OWNERSHIP RULE:
 * Products are owned strictly by Merchant -> Store -> Product.
 * Products are NEVER owned by a global marketplace tenant.
 */

import { TenantScopedEntity } from '../core/index.ts';

export interface ProductEntity extends TenantScopedEntity {
  storeId: string;
  titleAr: string;
  titleEn?: string;
  descriptionAr: string;
  descriptionEn?: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  basePrice: number;
  currency: string;
}

export interface ICatalogModuleService {
  getProduct(tenantId: string, productId: string): Promise<ProductEntity | null>;
  listProducts(tenantId: string, options?: { limit?: number; offset?: number }): Promise<ProductEntity[]>;
}
