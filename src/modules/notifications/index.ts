/**
 * Notifications Module (Architectural Boundary - Phase 10)
 * Multi-channel alerts (SMS, WhatsApp, In-App, Email) tailored to Sudan telecom networks.
 */

import { TenantScopedEntity } from '../core/index.ts';

export type NotificationChannel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';

export interface NotificationPayload {
  recipientPhone?: string;
  recipientEmail?: string;
  templateKey: string;
  variables: Record<string, string | number>;
  channel: NotificationChannel;
}

export interface INotificationsModuleService {
  dispatchNotification(tenantId: string, payload: NotificationPayload): Promise<{ success: boolean; id: string }>;
}
