/**
 * Marketplace Module (Architectural Boundary - Phase 11)
 * Sudan Platform Marketplace: Aggregation, Discovery, and Search Index Layer.
 * 
 * CORE STRUCTURAL RULES:
 * 1. Platform -> Marketplace -> Merchant Stores.
 * 2. Product ownership is STRICTLY: Merchant -> Store -> Product.
 * 3. The Marketplace is an index and discovery view across independent stores.
 *    It is NEVER a giant monolithic tenant that usurps store or product ownership.
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

export interface IMarketplaceModuleService {
  searchMarketplace(query: string, filters?: { city?: string; minPrice?: number; maxPrice?: number }): Promise<MarketplaceIndexedProduct[]>;
  listFeaturedStores(): Promise<Array<{ storeId: string; slug: string; nameAr: string }>>;
}
