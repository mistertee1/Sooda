import React from 'react';
import { ShieldCheck, Database, Lock, Globe, DollarSign, Clock, Sparkles } from 'lucide-react';
import { Store, StoreSettings, TenantMembership, SystemRole } from '../../core/domain/index.ts';
import { Badge } from '../ui/Badge.tsx';

interface StoreMetricsProps {
  store: Store;
  settings: StoreSettings | null;
  membership: TenantMembership | null;
  isRtl?: boolean;
}

export const StoreMetrics: React.FC<StoreMetricsProps> = ({
  store,
  settings,
  membership,
  isRtl = true,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Metric 1: Tenancy Boundary */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-2xs hover:border-stone-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">
            {isRtl ? 'حدود المستأجر المشددة' : 'Tenant Isolation Boundary'}
          </span>
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-stone-900 font-mono truncate">
              {store.id}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{isRtl ? 'عزل صارم مُفعّل' : 'Isolation Enforced'}</span>
          </div>
        </div>
      </div>

      {/* Metric 2: Operational Status */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-2xs hover:border-stone-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">
            {isRtl ? 'الحالة التشغيلية' : 'Store Operational Status'}
          </span>
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Database className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-stone-900">
              {store.status === 'ACTIVE'
                ? (isRtl ? 'مفتوح للزبائن' : 'Active & Serving')
                : (isRtl ? 'غير نشط (مغلق)' : 'Inactive / Closed')}
            </span>
            <Badge
              variant={store.status === 'ACTIVE' ? 'success' : 'neutral'}
              size="sm"
            >
              {store.status}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {store.status === 'ACTIVE'
              ? (isRtl ? 'واجهة المتجر تستقبل الزوار والطلبات' : 'Storefront open for visitors and orders')
              : (isRtl ? 'واجهة المتجر مغلقة مؤقتاً أمام الزوار' : 'Storefront closed to external visitors')}
          </p>
        </div>
      </div>

      {/* Metric 3: Currency & Localization */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-2xs hover:border-stone-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">
            {isRtl ? 'العملة والتوطين' : 'Currency & Localization'}
          </span>
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center">
            <DollarSign className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-stone-900 font-mono">
              {store.currency || 'SDG'}
            </span>
            <Badge variant="brand" size="sm">
              {store.defaultLocale === 'ar' ? (isRtl ? 'عربي أولاً' : 'Arabic First') : 'English'}
            </Badge>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-stone-500">
            <Clock className="w-3 h-3 text-stone-400" />
            <span className="font-mono">{store.timezone || 'Africa/Khartoum'}</span>
          </div>
        </div>
      </div>

      {/* Metric 4: Role & Authority */}
      <div className="bg-white border border-stone-200 rounded-xl p-4 shadow-2xs hover:border-stone-300 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-stone-500">
            {isRtl ? 'الصلاحية والوصول' : 'Active Role & Authority'}
          </span>
          <div className="w-8 h-8 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-stone-600" />
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-stone-900">
              {membership?.role === SystemRole.MERCHANT_OWNER
                ? (isRtl ? 'صلاحيات المالك الكاملة' : 'Full Owner Access')
                : (isRtl ? 'صلاحيات تشغيلية' : 'Staff Access')}
            </span>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {membership?.role === SystemRole.MERCHANT_OWNER
              ? (isRtl ? 'مسموح بتعديل الإعدادات والبيانات' : 'Authorized for profile & status mutations')
              : (isRtl ? 'عرض فقط للإعدادات الحساسة' : 'Read-only for protected store settings')}
          </p>
        </div>
      </div>
    </div>
  );
};
