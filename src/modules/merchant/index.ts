/**
 * Merchant Module
 * Handles legal commercial registration, business profiles, and KYC data in Sudan.
 */

import { BaseEntity } from '../core/index.ts';

export interface MerchantProfile extends BaseEntity {
  ownerUserId: string;
  businessName: string;
  tradeNameAr: string;
  commercialRegistrationNumber?: string;
  countryCode: string; // "SD"
  city: string; // e.g. Khartoum, Port Sudan, Omdurman
  phoneNumber: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
}

export interface IMerchantModuleService {
  getMerchantById(id: string): Promise<MerchantProfile | null>;
  getMerchantByOwnerId(ownerUserId: string): Promise<MerchantProfile | null>;
}
