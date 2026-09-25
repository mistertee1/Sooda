/**
 * Audit Module
 * Provides cryptographic, tamper-evident audit logging for all sensitive system operations.
 */

import { BaseEntity } from '../core/index.ts';

export enum AuditAction {
  TENANT_SETTINGS_ACCESSED = 'TENANT_SETTINGS_ACCESSED',
  TENANT_SETTINGS_UPDATED = 'TENANT_SETTINGS_UPDATED',
  CROSS_TENANT_ACCESS_BLOCKED = 'CROSS_TENANT_ACCESS_BLOCKED',
  SECURITY_BREACH_ATTEMPT = 'SECURITY_BREACH_ATTEMPT',
  RATE_LIMIT_TRIGGERED = 'RATE_LIMIT_TRIGGERED',
  WORKFLOW_FAILED_COMPENSATED = 'WORKFLOW_FAILED_COMPENSATED',
}

export interface AuditRecordPayload extends BaseEntity {
  tenantId?: string | null;
  actorId?: string;
  actorRole?: string;
  action: AuditAction | string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  traceId?: string;
  previousHash: string;
  recordHash: string;
}

export interface IAuditModuleService {
  record(entry: Omit<AuditRecordPayload, 'id' | 'createdAt' | 'updatedAt' | 'previousHash' | 'recordHash'>): void;
  verifyChainIntegrity(): { valid: boolean; recordsChecked: number; errors: string[] };
  query(filters: { tenantId?: string; action?: string; limit?: number }): AuditRecordPayload[];
}
