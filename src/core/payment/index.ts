/**
 * Phase 7 Payment Architecture Preparation (Abstract Domain & Contracts)
 * 
 * IMPORTANT ARCHITECTURAL DIRECTIVES:
 * 1. Payment processing is NOT part of Phase 0. No payment processing is executed.
 * 2. This module strictly defines the abstract domain types, lifecycle state machine,
 *    and transition contracts for Phase 7.
 * 3. The platform is NOT the financial recipient (merchant-direct model).
 * 4. No fake integrations, banks, or external payment gateways are fabricated.
 */

import { TenantScopedEntity, BaseEntity } from '../domain/index.ts';

// Lifecycle State Machine
export enum PaymentStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAYMENT_SUBMITTED = 'PAYMENT_SUBMITTED',
  PAYMENT_UNDER_REVIEW = 'PAYMENT_UNDER_REVIEW',
  PAYMENT_VERIFIED = 'PAYMENT_VERIFIED',
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
}

// Abstract Entity: PaymentMethod
// Configured directly by the merchant in their dashboard
export interface PaymentMethod extends TenantScopedEntity {
  storeId: string;
  nameAr: string;
  nameEn: string;
  paymentType: 'MANUAL_BANK_TRANSFER' | 'CASH_ON_DELIVERY' | 'WALLET_TRANSFER';
  accountHolderName?: string;
  accountIdentifier?: string; // e.g. Account number or IBAN
  paymentInstructionsAr: string;
  paymentInstructionsEn?: string;
  isActive: boolean;
  displayOrder: number;
}

// Abstract Entity: PaymentTransaction
// Represents a payment lifecycle instance linked to a tenant order
export interface PaymentTransaction extends TenantScopedEntity {
  orderId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  submissionReference?: string;
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
  rejectionReason?: string | null;
}

// Abstract Entity: PaymentSubmissionProof
// Customer-submitted proof of direct transfer
export interface PaymentSubmissionProof extends TenantScopedEntity {
  transactionId: string;
  orderId: string;
  payerName: string;
  payerContact: string;
  referenceCode?: string;
  proofAttachmentUrl: string;
  submittedAt: string;
}

// Abstract Entity: PaymentVerificationRecord
// Merchant human audit record
export interface PaymentVerificationRecord extends TenantScopedEntity {
  transactionId: string;
  orderId: string;
  auditorUserId: string;
  decision: 'VERIFIED' | 'REJECTED';
  reason?: string;
  verifiedAt: string;
}

/**
 * State Transition Guard for Phase 7
 * Enforces valid state transitions according to the platform specification.
 */
export class PaymentLifecycleGuard {
  private static readonly ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
    [PaymentStatus.PENDING_PAYMENT]: [PaymentStatus.PAYMENT_SUBMITTED],
    [PaymentStatus.PAYMENT_SUBMITTED]: [
      PaymentStatus.PAYMENT_UNDER_REVIEW,
      PaymentStatus.PAYMENT_VERIFIED,
      PaymentStatus.PAYMENT_REJECTED,
    ],
    [PaymentStatus.PAYMENT_UNDER_REVIEW]: [
      PaymentStatus.PAYMENT_VERIFIED,
      PaymentStatus.PAYMENT_REJECTED,
    ],
    [PaymentStatus.PAYMENT_VERIFIED]: [], // Terminal state
    [PaymentStatus.PAYMENT_REJECTED]: [PaymentStatus.PAYMENT_SUBMITTED], // Customer can re-submit
  };

  public static canTransition(current: PaymentStatus, target: PaymentStatus): boolean {
    return this.ALLOWED_TRANSITIONS[current]?.includes(target) ?? false;
  }
}

