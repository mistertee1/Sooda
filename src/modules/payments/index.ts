/**
 * Payments Module (Architectural Boundary - Phase 7)
 * Sudan-focused payment architecture: Direct Bank Transfer (BOK/Fawry), Cash on Delivery, Wallet.
 * 
 * CORE ARCHITECTURAL RULE:
 * The platform is NOT the financial intermediary.
 * Payments flow directly between store customer and merchant bank account / delivery courier.
 */

import { TenantScopedEntity } from '../core/index.ts';

export enum PaymentStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAYMENT_SUBMITTED = 'PAYMENT_SUBMITTED',
  PAYMENT_UNDER_REVIEW = 'PAYMENT_UNDER_REVIEW',
  PAYMENT_VERIFIED = 'PAYMENT_VERIFIED',
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
}

export interface PaymentTransactionEntity extends TenantScopedEntity {
  orderId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  submissionReference?: string;
  proofAttachmentUrl?: string;
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
  rejectionReason?: string | null;
}

export interface IPaymentsModuleService {
  getTransaction(tenantId: string, transactionId: string): Promise<PaymentTransactionEntity | null>;
  listTransactionsForOrder(tenantId: string, orderId: string): Promise<PaymentTransactionEntity[]>;
}
