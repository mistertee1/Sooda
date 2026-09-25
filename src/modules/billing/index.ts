/**
 * Billing Module (Architectural Boundary - Phase 12)
 * SaaS Subscription plans for merchants (Free, Starter, Growth, Enterprise) and platform billing cycles.
 */

import { BaseEntity } from '../core/index.ts';

export interface SubscriptionPlanEntity extends BaseEntity {
  nameAr: string;
  nameEn: string;
  tierCode: 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  monthlyFeeSdg: number;
  maxProducts: number;
  maxStaff: number;
  customDomainAllowed: boolean;
}

export interface IBillingModuleService {
  getAvailablePlans(): Promise<SubscriptionPlanEntity[]>;
  getMerchantSubscription(merchantId: string): Promise<{ planTier: string; renewalDate: string } | null>;
}
