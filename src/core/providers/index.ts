/**
 * Provider Abstraction Architecture
 * Defines extensible provider interfaces for future integrations without mock or fake implementations.
 * 
 * CORE INTERFACES:
 * - PaymentProvider: manual transfers, local gateways, COD
 * - ShippingProvider: local delivery networks, city courier dispatch
 * - NotificationProvider: SMS gateways (Sudatel, Zain, MTN), WhatsApp, Email
 * - SearchProvider: catalog indexing and full-text search
 * - FileStorageProvider: cloud object storage, local disk storage
 */

export interface BaseProvider {
  readonly identifier: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string;
}

// 1. Payment Provider Contract
export interface PaymentIntentInput {
  tenantId: string;
  orderId: string;
  amount: number;
  currency: string;
  customerPhone?: string;
}

export interface PaymentIntentResult {
  transactionId: string;
  status: string;
  instructionsAr?: string;
  instructionsEn?: string;
}

export interface PaymentProvider extends BaseProvider {
  createPaymentIntent(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  verifyPayment(transactionId: string, referenceData?: unknown): Promise<{ verified: boolean; notes?: string }>;
}

// 2. Shipping Provider Contract
export interface ShippingRateCalculationInput {
  tenantId: string;
  destinationCity: string;
  totalWeightKg?: number;
  packageCount?: number;
}

export interface ShippingProvider extends BaseProvider {
  calculateRate(input: ShippingRateCalculationInput): Promise<{ amount: number; currency: string; estimatedDays: number }>;
  createShipment(orderId: string, address: Record<string, string>): Promise<{ trackingCode?: string; status: string }>;
}

// 3. Notification Provider Contract
export interface NotificationDispatchInput {
  recipient: string; // phone or email
  template: string;
  locale: 'ar' | 'en';
  payload: Record<string, string | number>;
}

export interface NotificationProvider extends BaseProvider {
  dispatch(input: NotificationDispatchInput): Promise<{ messageId: string; delivered: boolean }>;
}

// 4. Search Provider Contract
export interface SearchQueryInput {
  tenantId?: string; // Optional for marketplace cross-store search
  term: string;
  category?: string;
  city?: string;
  limit?: number;
  offset?: number;
}

export interface SearchProvider extends BaseProvider {
  indexItem(id: string, document: Record<string, unknown>): Promise<void>;
  removeItem(id: string): Promise<void>;
  search(query: SearchQueryInput): Promise<{ results: any[]; total: number }>;
}

// 5. File Storage Provider Contract
export interface FileUploadInput {
  tenantId: string;
  filename: string;
  mimeType: string;
  buffer: Uint8Array | Buffer;
  category: 'receipt_proof' | 'store_logo' | 'banner' | 'product_image';
}

export interface FileStorageProvider extends BaseProvider {
  upload(input: FileUploadInput): Promise<{ fileUrl: string; key: string }>;
  delete(key: string): Promise<void>;
}

/**
 * Provider Registry
 * Allows dynamic registration and discovery of providers per tenant or platform.
 */
export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private paymentProviders = new Map<string, PaymentProvider>();
  private shippingProviders = new Map<string, ShippingProvider>();
  private notificationProviders = new Map<string, NotificationProvider>();
  private searchProviders = new Map<string, SearchProvider>();
  private fileStorageProviders = new Map<string, FileStorageProvider>();

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public registerPaymentProvider(provider: PaymentProvider): void {
    this.paymentProviders.set(provider.identifier, provider);
  }

  public getPaymentProvider(identifier: string): PaymentProvider | undefined {
    return this.paymentProviders.get(identifier);
  }

  public registerShippingProvider(provider: ShippingProvider): void {
    this.shippingProviders.set(provider.identifier, provider);
  }

  public getShippingProvider(identifier: string): ShippingProvider | undefined {
    return this.shippingProviders.get(identifier);
  }

  public registerNotificationProvider(provider: NotificationProvider): void {
    this.notificationProviders.set(provider.identifier, provider);
  }

  public getNotificationProvider(identifier: string): NotificationProvider | undefined {
    return this.notificationProviders.get(identifier);
  }

  public registerSearchProvider(provider: SearchProvider): void {
    this.searchProviders.set(provider.identifier, provider);
  }

  public getSearchProvider(identifier: string): SearchProvider | undefined {
    return this.searchProviders.get(identifier);
  }

  public registerFileStorageProvider(provider: FileStorageProvider): void {
    this.fileStorageProviders.set(provider.identifier, provider);
  }

  public getFileStorageProvider(identifier: string): FileStorageProvider | undefined {
    return this.fileStorageProviders.get(identifier);
  }
}
