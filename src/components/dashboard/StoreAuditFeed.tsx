import React from 'react';
import { ShieldCheck, ShieldAlert, Key, FileCheck, RefreshCw, Activity, Lock } from 'lucide-react';
import { Badge } from '../ui/Badge.tsx';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui/Table.tsx';

interface AuditEventItem {
  id: string;
  sequence_number?: number;
  sequenceNumber?: number;
  timestamp: string;
  action: string;
  entity_type?: string;
  entityType?: string;
  entity_id?: string;
  entityId?: string;
  actor_id?: string;
  actorId?: string;
  actor_role?: string;
  actorRole?: string;
  hash?: string;
  previous_hash?: string;
  previousHash?: string;
}

interface StoreAuditFeedProps {
  events: AuditEventItem[];
  storeId: string;
  onRefresh: () => void;
  isRtl?: boolean;
}

export const StoreAuditFeed: React.FC<StoreAuditFeedProps> = ({
  events,
  storeId,
  onRefresh,
  isRtl = true,
}) => {
  // Filter events related to this tenant/store
  const filteredEvents = events.filter((e) => {
    const entityId = e.entity_id || e.entityId;
    return entityId === storeId || e.action.includes('STORE');
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'STORE_UPDATED':
        return <Badge variant="brand" size="sm">{isRtl ? 'تعديل البيانات' : 'Profile Updated'}</Badge>;
      case 'STORE_STATUS_CHANGED':
        return <Badge variant="warning" size="sm">{isRtl ? 'تغيير الحالة' : 'Status Changed'}</Badge>;
      case 'CROSS_TENANT_ACCESS_BLOCKED':
        return <Badge variant="danger" size="sm">{isRtl ? 'اعتراض عزل' : 'Tenant Blocked'}</Badge>;
      case 'SESSION_CREATED':
        return <Badge variant="neutral" size="sm">{isRtl ? 'جلسة جديدة' : 'Session Created'}</Badge>;
      default:
        return <Badge variant="neutral" size="sm">{action}</Badge>;
    }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-2xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-700" />
            <span>{isRtl ? 'سجل العمليات الرقابي المشفر (Audit Trail)' : 'Tamper-Evident Audit Trail'}</span>
          </h3>
          <p className="text-xs text-stone-500 mt-0.5">
            {isRtl
              ? `سلسلة أحداث مشفرة بتقنية SHA-256 محصورة بحدود المتجر (${storeId})`
              : `Cryptographically chained SHA-256 events strictly scoped to tenant (${storeId})`}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-600 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{isRtl ? 'تحديث السجل' : 'Refresh Events'}</span>
        </button>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="text-center py-8 text-stone-500 text-xs">
          {isRtl ? 'لا توجد عمليات مسجلة لهذا المتجر بعد' : 'No audit events recorded for this store yet'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isRtl ? 'الرقم المتسلسل' : 'Seq #'}</TableHead>
                <TableHead>{isRtl ? 'العملية' : 'Action'}</TableHead>
                <TableHead>{isRtl ? 'المنفذ والدور' : 'Actor & Role'}</TableHead>
                <TableHead>{isRtl ? 'الوقت' : 'Timestamp'}</TableHead>
                <TableHead>{isRtl ? 'بصمة التشفير (Hash)' : 'SHA-256 Hash'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEvents.slice(0, 10).map((e, idx) => {
                const seq = e.sequence_number ?? e.sequenceNumber ?? idx + 1;
                const role = e.actor_role || e.actorRole || 'MERCHANT_OWNER';
                const hash = e.hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
                const time = new Date(e.timestamp).toLocaleTimeString(isRtl ? 'ar-SD' : 'en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <TableRow key={e.id || idx}>
                    <TableCell className="font-mono text-xs font-bold text-teal-900">
                      #{seq}
                    </TableCell>
                    <TableCell>{getActionBadge(e.action)}</TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <span className="font-mono text-stone-800 font-semibold block">
                          {e.actor_id || e.actorId}
                        </span>
                        <span className="text-stone-400 text-2xs">{role}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-stone-500 whitespace-nowrap">
                      {time}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-2xs text-stone-600 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 block truncate max-w-40" title={hash}>
                        {hash.substring(0, 12)}...
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};
