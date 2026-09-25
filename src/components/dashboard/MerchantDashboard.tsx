import React, { useState, useEffect } from 'react';
import {
  Store as StoreIcon,
  Settings,
  ShieldCheck,
  LayoutDashboard,
  ExternalLink,
  Building2,
  RefreshCw,
  AlertTriangle,
  FileText,
  Lock,
  Globe2,
  Phone,
  Mail,
  CheckCircle2,
  ArrowUpRight
} from 'lucide-react';
import { Store, StoreSettings, TenantMembership, SystemRole } from '../../core/domain/index.ts';
import { StoreSwitcher } from './StoreSwitcher.tsx';
import { StoreMetrics } from './StoreMetrics.tsx';
import { StoreSettingsEditor } from './StoreSettingsEditor.tsx';
import { StoreAuditFeed } from './StoreAuditFeed.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';

interface MerchantDashboardProps {
  initialStoreId?: string;
  isRtl?: boolean;
  currentUser?: any;
  onRequireLogin?: () => void;
}

export const MerchantDashboard: React.FC<MerchantDashboardProps> = ({
  initialStoreId = 'tenant_store_albaraka',
  isRtl = true,
  currentUser,
  onRequireLogin,
}) => {
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStoreId, setCurrentStoreId] = useState<string>(currentUser?.tenantId || initialStoreId);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [currentSettings, setCurrentSettings] = useState<StoreSettings | null>(null);
  const [currentMembership, setCurrentMembership] = useState<TenantMembership | null>(null);

  // Active dashboard view tab
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'settings' | 'audit'>('overview');

  // Audit state
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync store ID if currentUser changes
  useEffect(() => {
    if (currentUser?.tenantId) {
      setCurrentStoreId(currentUser.tenantId);
    }
  }, [currentUser?.tenantId]);

  // Fetch authorized stores for authenticated session
  const loadStores = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/stores', {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        const loadedStores = data.stores || [];
        setStores(loadedStores);

        // If current store is not in loaded stores and loaded stores exist, select first
        if (loadedStores.length > 0 && !loadedStores.some((s: Store) => s.id === currentStoreId)) {
          setCurrentStoreId(loadedStores[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load stores:', e);
    }
  };

  // Fetch store details & settings for active store
  const loadStoreDetails = async (storeId: string) => {
    if (!currentUser) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/stores/${storeId}`, {
        credentials: 'include',
      });

      const data = await res.json();

      if (res.ok) {
        setCurrentStore(data.store);
        setCurrentSettings(data.settings);
        setCurrentMembership(data.membership);
      } else {
        setErrorMessage(
          data.code === 'TENANT_MISMATCH'
            ? (isRtl
                ? `تم حظر الوصول: المتجر (${storeId}) خارج نطاق صلاحيات هذا المستخدم. تم فرض العزل التام للمستأجر وتسجيل الواقعة في سجل الرقابة.`
                : `Cross-tenant access blocked: Store (${storeId}) belongs to another tenant. Isolation enforced and audited.`)
            : data.message || 'Failed to load store'
        );
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Error loading store details');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch audit stream
  const loadAudits = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/audit/stream', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.events) setAuditEvents(data.events);
      }
    } catch (e) {
      console.error('Failed to load audit events:', e);
    }
  };

  // Initial load when currentUser is available
  useEffect(() => {
    if (currentUser) {
      loadStores();
      loadAudits();
    }
  }, [currentUser]);

  // Sync on store change
  useEffect(() => {
    if (currentUser && currentStoreId) {
      loadStoreDetails(currentStoreId);
    }
  }, [currentStoreId, currentUser]);

  if (!currentUser) {
    return (
      <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center space-y-4 shadow-2xs">
        <div className="w-14 h-14 bg-teal-50 text-teal-800 rounded-2xl flex items-center justify-center mx-auto border border-teal-200">
          <Lock className="w-7 h-7 text-teal-700" />
        </div>
        <div className="space-y-1 max-w-md mx-auto">
          <h3 className="text-lg font-bold text-stone-900">
            {isRtl ? 'تسجيل الدخول مطلوب لإدارة المتجر' : 'Authentication Required'}
          </h3>
          <p className="text-xs text-stone-500">
            {isRtl
              ? 'تتطلب لوحة قيادة المتجر جلسة عمل نشطة ومحققة الصلاحيات ضمن نطاق المستأجر (Tenant Security Boundary).'
              : 'Store management endpoints require an active, authenticated tenant-scoped session.'}
          </p>
        </div>
        {onRequireLogin && (
          <Button
            variant="brand"
            size="md"
            onClick={onRequireLogin}
            className="cursor-pointer"
          >
            {isRtl ? 'الانتقال إلى تسجيل الدخول' : 'Go to Sign In'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar: Security Context & Store Selector */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Store Switcher & Context */}
          <div className="flex flex-wrap items-center gap-3">
            <StoreSwitcher
              stores={stores}
              currentStoreId={currentStoreId}
              onSelectStore={(id) => setCurrentStoreId(id)}
              userRole={currentMembership?.role || SystemRole.MERCHANT_OWNER}
              isRtl={isRtl}
            />

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-600">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>{isRtl ? 'نظام العزل:' : 'Isolation:'}</span>
              <span className="font-mono font-bold text-stone-900">{currentStoreId}</span>
            </div>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-2 mt-5 border-t border-stone-100 pt-3 overflow-x-auto">
          <button
            type="button"
            onClick={() => setDashboardTab('overview')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              dashboardTab === 'overview'
                ? 'bg-teal-50 text-teal-900 border border-teal-200'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>{isRtl ? 'لوحة التحكم العامة' : 'Store Overview'}</span>
          </button>

          <button
            type="button"
            onClick={() => setDashboardTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              dashboardTab === 'settings'
                ? 'bg-teal-50 text-teal-900 border border-teal-200'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>{isRtl ? 'إعدادات وهوية المتجر' : 'Store Settings & Identity'}</span>
          </button>

          <button
            type="button"
            onClick={() => setDashboardTab('audit')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              dashboardTab === 'audit'
                ? 'bg-teal-50 text-teal-900 border border-teal-200'
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{isRtl ? 'سجل العمليات والأمان' : 'Security & Audit Trail'}</span>
            <Badge variant="brand" size="sm">
              {auditEvents.length}
            </Badge>
          </button>
        </div>
      </div>

      {/* Cross-Tenant Blockade Error Alert */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-bold text-sm text-rose-900">
              {isRtl ? 'تم تطبيق حظر الوصول المتقاطع للمستأجرين' : 'Tenant Security Boundary Enforced'}
            </p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      {currentStore && !errorMessage && (
        <>
          {dashboardTab === 'overview' && (
            <div className="space-y-6">
              {/* Store Hero Banner */}
              <div className="bg-gradient-to-r from-teal-900 via-teal-800 to-stone-900 text-white rounded-2xl p-6 sm:p-8 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2.5">
                      <span className="px-2.5 py-0.5 rounded-full bg-teal-700/80 border border-teal-500/40 text-xs font-mono text-teal-200">
                        {currentStore.slug}.sooda.sd
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        currentStore.status === 'ACTIVE'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}>
                        {currentStore.status}
                      </span>
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
                      {isRtl ? currentStore.nameAr : (currentStore.nameEn || currentStore.nameAr)}
                    </h2>

                    <p className="text-stone-300 text-sm max-w-2xl leading-relaxed">
                      {isRtl
                        ? (currentStore.descriptionAr || 'متجر رقمي سوداني متكامل ضمن منصة سودا للتجارة الإلكترونية.')
                        : (currentStore.descriptionEn || 'Sudanese digital commerce storefront hosted on Sooda platform.')}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDashboardTab('settings')}
                      className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-xs font-bold text-white transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Settings className="w-4 h-4" />
                      <span>{isRtl ? 'إدارة الإعدادات' : 'Store Settings'}</span>
                    </button>

                    <a
                      href={`https://${currentStore.slug}.sooda.sd`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-stone-950 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 shadow-xs"
                    >
                      <span>{isRtl ? 'معاينة المتجر للزبائن' : 'Open Storefront'}</span>
                      <ArrowUpRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Operational Metrics */}
              <StoreMetrics
                store={currentStore}
                settings={currentSettings}
                membership={currentMembership}
                isRtl={isRtl}
              />

              {/* Fast Activity Overview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Store Details Card */}
                <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-2xs space-y-4">
                  <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2 border-b border-stone-100 pb-3">
                    <Building2 className="w-4 h-4 text-teal-700" />
                    <span>{isRtl ? 'بيانات المتجر والتواصل' : 'Storefront Details'}</span>
                  </h3>

                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-1 border-b border-stone-50">
                      <span className="text-stone-500">{isRtl ? 'الاسم بالإنجليزية:' : 'English Name:'}</span>
                      <span className="font-semibold text-stone-900">{currentStore.nameEn || '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-stone-50">
                      <span className="text-stone-500">{isRtl ? 'الرابط الفرعي:' : 'Subdomain:'}</span>
                      <span className="font-mono font-semibold text-teal-800">{currentStore.slug}.sooda.sd</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-stone-50">
                      <span className="text-stone-500">{isRtl ? 'البريد الرسمي للتواصل:' : 'Contact Email:'}</span>
                      <span className="font-mono text-stone-800">{currentSettings?.contactEmail || '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-stone-50">
                      <span className="text-stone-500">{isRtl ? 'رقم الهاتف والواتساب:' : 'Contact Phone:'}</span>
                      <span className="font-mono text-stone-800">{currentSettings?.contactPhone || '—'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-stone-50">
                      <span className="text-stone-500">{isRtl ? 'تاريخ الإنشاء:' : 'Created At:'}</span>
                      <span className="font-mono text-stone-600">
                        {new Date(currentStore.createdAt).toLocaleDateString(isRtl ? 'ar-SD' : 'en-US')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick Security & Tenancy Checklist */}
                <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-2xs space-y-4">
                  <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2 border-b border-stone-100 pb-3">
                    <Lock className="w-4 h-4 text-emerald-700" />
                    <span>{isRtl ? 'معايير أمان المتجر (Sooda Trust)' : 'Security Invariants'}</span>
                  </h3>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50/60 p-2.5 rounded-lg border border-emerald-100">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{isRtl ? 'عزل المستأجر مفعل: لا يمكن لأي تاجر آخر الوصول إلى قاعدة البيانات' : 'Strict tenant isolation: Cross-tenant access cryptographically blocked'}</span>
                    </div>

                    <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50/60 p-2.5 rounded-lg border border-emerald-100">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{isRtl ? 'حماية من التعديل الجماعي: الحقول الحساسة غير قابلة للتجاوز' : 'Mass-assignment protection: Whitelisted Zod schema enforced'}</span>
                    </div>

                    <div className="flex items-center gap-2 text-emerald-800 bg-emerald-50/60 p-2.5 rounded-lg border border-emerald-100">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{isRtl ? 'سلسلة التجزئة المشفرة: جميع عمليات المتجر مسجلة بتجزئة SHA-256' : 'Audit immutability: Cryptographic SHA-256 hash chaining active'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {dashboardTab === 'settings' && (
            <StoreSettingsEditor
              store={currentStore}
              settings={currentSettings}
              membership={currentMembership}
              onUpdateSuccess={() => {
                loadStoreDetails(currentStore.id);
                loadStores();
                loadAudits();
              }}
              isRtl={isRtl}
            />
          )}

          {dashboardTab === 'audit' && (
            <StoreAuditFeed
              events={auditEvents}
              storeId={currentStore.id}
              onRefresh={loadAudits}
              isRtl={isRtl}
            />
          )}
        </>
      )}
    </div>
  );
};
