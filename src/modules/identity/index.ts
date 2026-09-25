/**
 * Identity Module
 * Manages user accounts, authentication contracts, roles, and credential verification.
 */

import { BaseEntity } from '../core/index.ts';

export enum SystemRole {
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  MERCHANT_OWNER = 'MERCHANT_OWNER',
  MERCHANT_STAFF = 'MERCHANT_STAFF',
  STORE_CUSTOMER = 'STORE_CUSTOMER',
}

export interface UserAccount extends BaseEntity {
  email: string;
  phone?: string;
  fullName: string;
  role: SystemRole;
  isActive: boolean;
  preferredLanguage: 'ar' | 'en';
  tenantId?: string | null;
}

export interface IIdentityModuleService {
  getUserById(id: string): Promise<UserAccount | null>;
  getUserByEmail(email: string): Promise<UserAccount | null>;
  verifyToken(authHeader?: string): Promise<UserAccount | null>;
}
