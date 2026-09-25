import React, { useState, useEffect } from 'react';
import {
  Save,
  Globe,
  Mail,
  Phone,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
  PowerOff,
  Clock,
  Coins,
  RefreshCw,
  Info
} from 'lucide-react';
import { Store, StoreSettings, TenantMembership, SystemRole } from '../../core/domain/index.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Alert } from '../ui/Alert.tsx';

interface StoreSettingsEditorProps {
  store: Store;
  settings: StoreSettings | null;
  membership: TenantMembership | null;
  onUpdateSuccess: () => void;
  isRtl?: boolean;
}

export const StoreSettingsEditor: React.FC<StoreSettingsEditorProps> = ({
  store,
  settings,
  membership,
  onUpdateSuccess,
  isRtl = true,
}) => {
  const isOwner = membership?.role === SystemRole.MERCHANT_OWNER;

  // Form states
  const [nameAr, setNameAr] = useState(store.nameAr || '');
  const [nameEn, setNameEn] = useState(store.nameEn || '');
  const [descriptionAr, setDescriptionAr] = useState(store.descriptionAr || '');
  const [descriptionEn, setDescriptionEn] = useState(store.descriptionEn || '');
  const [slug, setSlug] = useState(store.slug || '');
  const [currency, setCurrency] = useState(store.currency || 'SDG');
  const [timezone, setTimezone] = useState(store.timezone || 'Africa/Khartoum');
  const [defaultLocale, setDefaultLocale] = useState<'ar' | 'en'>(store.defaultLocale || 'ar');
  const [contactEmail, setContactEmail] = useState(settings?.contactEmail || '');
  const [contactPhone, setContactPhone] = useState(settings?.contactPhone || '');

  // Status mutation state (Phase 2 minimal model: ACTIVE or INACTIVE)
  const [currentStatus, setCurrentStatus] = useState<'ACTIVE' | 'INACTIVE'>(store.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Slug check states
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugReason, setSlugReason] = useState<string>('');

  // Submit states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string; details?: any[] } | null>(null);

  // Sync with prop updates
  useEffect(() => {
    setNameAr(store.nameAr || '');
    setNameEn(store.nameEn || '');
    setDescriptionAr(store.descriptionAr || '');
    setDescriptionEn(store.descriptionEn || '');
    setSlug(store.slug || '');
    setCurrency(store.currency || 'SDG');
    setTimezone(store.timezone || 'Africa/Khartoum');
    setDefaultLocale(store.defaultLocale || 'ar');
    setCurrentStatus(store.status as any);
  }, [store]);

  useEffect(() => {
    setContactEmail(settings?.contactEmail || '');
    setContactPhone(settings?.contactPhone || '');
  }, [settings]);

  // Real-time slug availability debounce check
  useEffect(() => {
    if (!slug || slug === store.slug) {
      setSlugAvailable(true);
      setSlugReason('');
      return;
    }

    const timer = setTimeout(async () => {
      setSlugChecking(true);
      try {
        const res = await fetch(`/api/stores/check-slug?slug=${encodeURIComponent(slug)}&currentStoreId=${store.id}`, {
          credentials: 'include',
        });
        const data = await res.json();
        setSlugAvailable(data.available);
        setSlugReason(data.reason || '');
      } catch (err) {
        setSlugAvailable(null);
      } finally {
        setSlugChecking(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [slug, store.id, store.slug]);

  // Handle Save Profile
  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const payload: any = {
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
        descriptionAr: descriptionAr.trim() || null,
        descriptionEn: descriptionEn.trim() || null,
        currency,
        timezone,
        defaultLocale,
      };

      if (slug.trim() && slug.trim() !== store.slug) {
        payload.slug = slug.trim();
      }

      if (contactEmail.trim()) {
        payload.contactEmail = contactEmail.trim();
      }

      if (contactPhone.trim()) {
        payload.contactPhone = contactPhone.trim();
      }

      const res = await fetch(`/api/stores/${store.id}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setFeedback({
          type: 'success',
          message: isRtl
            ? 'تم حفظ وتحديث ملف المتجر وإعداداته بنجاح في قاعدة البيانات وتسجيل العملية بالسجل الرقابي.'
            : 'Store profile and settings successfully updated and cryptographically audited.',
        });
        onUpdateSuccess();
      } else {
        setFeedback({
          type: 'error',
          message: data.message || (isRtl ? 'فشل حفظ الإعدادات' : 'Failed to update settings'),
          details: data.details,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || (isRtl ? 'حدث خطأ في الشبكة أثناء الحفظ' : 'Network error during update'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Status Change (Phase 2 minimal model: ACTIVE or INACTIVE)
  const handleStatusChange = async (newStatus: 'ACTIVE' | 'INACTIVE') => {
    if (!isOwner) return;

    setIsUpdatingStatus(true);
    setFeedback(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const res = await fetch(`/api/stores/${store.id}/status`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (res.ok) {
        setCurrentStatus(newStatus);
        setFeedback({
          type: 'success',
          message: isRtl
            ? `تم تحديث الحالة التشغيلية للمتجر إلى: ${newStatus === 'ACTIVE' ? 'نشط' : 'معطّل'}`
            : `Store operational status updated to: ${newStatus}`,
        });
        onUpdateSuccess();
      } else {
        setFeedback({
          type: 'error',
          message: data.message || (isRtl ? 'فشل تغيير حالة المتجر' : 'Failed to change store status'),
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || (isRtl ? 'خطأ في الاتصال' : 'Connection error'),
      });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Role permission alert if not owner */}
      {!isOwner && (
        <Alert variant="warning" icon={<Lock className="w-5 h-5 text-amber-800" />}>
          <div>
            <p className="font-bold text-amber-900">
              {isRtl ? 'وضع القراءة فقط: صلاحيات مقيدة' : 'Read-Only Mode: Restricted Role'}
            </p>
            <p className="text-xs text-amber-800 mt-1">
              {isRtl
                ? 'أنت مسجل حالياً كـ (فريق عمل). تعديل الهوية، الرابط، والحالة التشغيلية محصور حصراً بمالك المتجر (MERCHANT_OWNER).'
                : 'You are signed in as Merchant Staff. Modifying identity, slugs, and operational status is strictly reserved for Merchant Owners.'}
            </p>
          </div>
        </Alert>
      )}

      {/* Feedback banner */}
      {feedback && (
        <Alert
          variant={feedback.type === 'success' ? 'success' : 'danger'}
          icon={feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-700" /> : <AlertCircle className="w-5 h-5 text-rose-700" />}
        >
          <div>
            <p className="font-semibold text-sm">{feedback.message}</p>
            {feedback.details && feedback.details.length > 0 && (
              <ul className="mt-2 text-xs list-disc list-inside space-y-1">
                {feedback.details.map((d: any, idx: number) => (
                  <li key={idx}>
                    <span className="font-mono">{d.field}:</span> {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Alert>
      )}

      {/* Operational Status Control Panel */}
      <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <PowerOff className="w-4 h-4 text-teal-700" />
              <span>{isRtl ? 'الحالة التشغيلية للمتجر' : 'Store Operational Status'}</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              {isRtl
                ? 'التحكم في إمكانية وصول الزبائن وتقديم الطلبات في المتجر الإلكتروني'
                : 'Control whether customers can browse and place orders on the storefront'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isOwner || isUpdatingStatus}
              onClick={() => handleStatusChange('ACTIVE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                currentStatus === 'ACTIVE'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                  : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100 disabled:opacity-50'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5" />
              <span>{isRtl ? 'نشط (مفتوح للعملاء)' : 'Active (Open)'}</span>
            </button>

            <button
              type="button"
              disabled={!isOwner || isUpdatingStatus}
              onClick={() => handleStatusChange('INACTIVE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                currentStatus === 'INACTIVE'
                  ? 'bg-rose-700 text-white border-rose-700 shadow-2xs'
                  : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100 disabled:opacity-50'
              }`}
            >
              <PowerOff className="w-3.5 h-3.5" />
              <span>{isRtl ? 'مُعطّل (مغلق مؤقتاً)' : 'Inactive (Closed)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSubmitProfile} className="bg-white border border-stone-200 rounded-xl p-5 shadow-2xs space-y-5">
        <div className="border-b border-stone-100 pb-4">
          <h3 className="text-base font-bold text-stone-900">
            {isRtl ? 'الهوية والبيانات الأساسية' : 'Store Identity & Localization'}
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            {isRtl
              ? 'تعديل الأسماء ثنائية اللغة، الرابط المخصص، ومعلومات التواصل'
              : 'Configure bilingual branding, custom storefront slug, and contact details'}
          </p>
        </div>

        {/* Bilingual Store Names */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={isRtl ? 'اسم المتجر (بالعربية) *' : 'Store Name (Arabic) *'}
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            disabled={!isOwner}
            placeholder="مثال: متجر البركة للمنتجات المحلية"
            dir="rtl"
            id="input-name-ar"
            required
          />

          <Input
            label={isRtl ? 'اسم المتجر (بالإنجليزية) *' : 'Store Name (English) *'}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            disabled={!isOwner}
            placeholder="e.g. Al-Baraka Local Goods"
            dir="ltr"
            id="input-name-en"
            required
          />
        </div>

        {/* Slug with Real-Time Validation */}
        <div>
          <label className="block text-xs font-semibold text-stone-700 mb-1.5">
            {isRtl ? 'رابط المتجر (Slug) الفريد *' : 'Storefront Subdomain Slug *'}
          </label>
          <div className="flex rounded-lg border border-stone-300 focus-within:ring-2 focus-within:ring-teal-600 focus-within:border-teal-600 overflow-hidden bg-white">
            <span className="inline-flex items-center px-3 bg-stone-50 text-stone-500 text-xs font-mono border-e border-stone-200">
              https://
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
              disabled={!isOwner}
              className="flex-1 min-w-0 px-3 py-2 text-sm font-mono text-stone-900 focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
              placeholder="my-store"
              dir="ltr"
              id="input-store-slug"
              required
            />
            <span className="inline-flex items-center px-3 bg-stone-50 text-stone-500 text-xs font-mono border-s border-stone-200">
              .sooda.sd
            </span>
          </div>

          {/* Slug Status Indicator */}
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            {slugChecking && (
              <span className="flex items-center gap-1 text-stone-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                {isRtl ? 'جارِ التحقق من توفر الرابط...' : 'Verifying slug availability...'}
              </span>
            )}
            {!slugChecking && slugAvailable === true && (
              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isRtl ? 'الرابط متاح وصالح للاستخدام' : 'Slug is valid and available'}
              </span>
            )}
            {!slugChecking && slugAvailable === false && (
              <span className="flex items-center gap-1 text-rose-600 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {slugReason || (isRtl ? 'الرابط محجوز أو غير صالح' : 'Slug is unavailable or reserved')}
              </span>
            )}
          </div>
        </div>

        {/* Bilingual Descriptions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1.5">
              {isRtl ? 'وصف المتجر (بالعربية)' : 'Description (Arabic)'}
            </label>
            <textarea
              value={descriptionAr}
              onChange={(e) => setDescriptionAr(e.target.value)}
              disabled={!isOwner}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 disabled:bg-stone-50"
              placeholder="وصف مختصر يظهر للزبائن في محركات البحث والمتجر..."
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1.5">
              {isRtl ? 'وصف المتجر (بالإنجليزية)' : 'Description (English)'}
            </label>
            <textarea
              value={descriptionEn}
              onChange={(e) => setDescriptionEn(e.target.value)}
              disabled={!isOwner}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 disabled:bg-stone-50"
              placeholder="Brief summary visible on search engines and store header..."
              dir="ltr"
            />
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-stone-100">
          <Input
            label={isRtl ? 'بريد التواصل مع الزبائن' : 'Public Contact Email'}
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            disabled={!isOwner}
            leftIcon={<Mail className="w-4 h-4 text-stone-400" />}
            placeholder="support@mystore.sd"
            dir="ltr"
            id="input-contact-email"
          />

          <Input
            label={isRtl ? 'رقم هاتف المتجر والواتساب' : 'Store Phone / WhatsApp'}
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            disabled={!isOwner}
            leftIcon={<Phone className="w-4 h-4 text-stone-400" />}
            placeholder="+249912345678"
            dir="ltr"
            id="input-contact-phone"
          />
        </div>

        {/* Currency & Regional Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-stone-100">
          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1.5">
              {isRtl ? 'العملة الافتراضية' : 'Default Currency'}
            </label>
            <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm font-mono font-bold text-stone-800">
              <Coins className="w-4 h-4 text-amber-700" />
              <span>{currency} (الجنيه السوداني)</span>
            </div>
            <p className="text-2xs text-stone-400 mt-1">
              {isRtl ? 'رمز العملة الرسمية للمنصة' : 'Standard national currency'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1.5">
              {isRtl ? 'المنطقة الزمنية' : 'Timezone'}
            </label>
            <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm font-mono text-stone-800">
              <Clock className="w-4 h-4 text-teal-700" />
              <span>{timezone}</span>
            </div>
            <p className="text-2xs text-stone-400 mt-1">
              {isRtl ? 'توقيت السودان الرسمي (UTC+2)' : 'Sudan Local Time'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 mb-1.5">
              {isRtl ? 'اللغة الافتراضية للواجهة' : 'Default Storefront Language'}
            </label>
            <select
              value={defaultLocale}
              onChange={(e) => setDefaultLocale(e.target.value as 'ar' | 'en')}
              disabled={!isOwner}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 disabled:bg-stone-50 bg-white"
            >
              <option value="ar">العربية (Arabic First - RTL)</option>
              <option value="en">English (LTR)</option>
            </select>
          </div>
        </div>

        {/* Submit Actions */}
        {isOwner && (
          <div className="pt-4 border-t border-stone-100 flex items-center justify-end gap-3">
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
              disabled={slugAvailable === false}
              leftIcon={<Save className="w-4 h-4" />}
              id="btn-save-store-settings"
            >
              {isRtl ? 'حفظ إعدادات المتجر' : 'Save Store Profile'}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
};
