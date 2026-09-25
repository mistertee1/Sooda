/**
 * Core Module
 * Provides base entity contracts, common utilities, and system-wide foundational primitives.
 */

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface TenantScopedEntity extends BaseEntity {
  tenantId: string;
}

export interface PlatformConfig {
  id: string;
  name: string;
  code: string;
  primaryDomain: string;
  status: 'ACTIVE' | 'MAINTENANCE' | 'DEGRADED';
  version: string;
  defaultCurrency: string;
  supportedLanguages: string[];
}

export interface ICoreModuleService {
  getPlatformInfo(): Promise<PlatformConfig>;
  getSystemHealth(): Promise<{ status: string; timestamp: string }>;
}
