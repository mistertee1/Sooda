/**
 * Marketplace Architectural Placeholder — Phase 2
 *
 * This module defines only the future boundary for marketplace discovery.
 * It is NOT a functional marketplace and must not be mounted by Phase 2
 * routes, UI, search, catalog, checkout, or tenant authorization flows.
 *
 * Ownership invariant for future phases:
 *   Store -> Product
 *   Marketplace -> indexes/discovers eligible Store/Product records
 *
 * The Marketplace is never a merchant tenant and never owns merchant
 * products. Any future implementation must consume tenant-authorized data
 * through explicit platform services without bypassing store isolation.
 */

export interface MarketplaceIndexedProduct {
  storeId: string;
  storeSlug: string;
  storeNameAr: string;
  productId: string;
  titleAr: string;
  slug: string;
  price: number;
  currency: string;
  city: string;
}

/**
 * Future-phase contract only. No implementation is provided in Phase 2.
 */
export interface IMarketplaceModuleService {
  searchMarketplace(query: string, filters?: { city?: string; minPrice?: number; maxPrice?: number }): Promise<MarketplaceIndexedProduct[]>;
  listFeaturedStores(): Promise<Array<{ storeId: string; slug: string; nameAr: string }>>;
}
