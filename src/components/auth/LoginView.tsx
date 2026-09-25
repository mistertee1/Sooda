import React, { useState } from 'react';
import {
  ShieldCheck,
  Building2,
  Lock,
  Mail,
  Key,
  UserCheck,
  Store as StoreIcon,
  ArrowRight,
  ShieldAlert,
  AlertCircle
} from 'lucide-react';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Alert } from '../ui/Alert.tsx';

interface LoginViewProps {
  onLoginSuccess: (user: any) => void;
  isRtl?: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  isRtl = true,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const executeLogin = async (loginEmail: string, loginPass: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPass,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.data?.user) {
        onLoginSuccess(data.data.user);
      } else {
        const errorText =
          data.error?.message ||
          (isRtl
            ? 'فشل تسجيل الدخول. يرجى التحقق من صحة البريد الإلكتروني وكلمة المرور.'
            : 'Authentication failed. Please verify your credentials.');
        setErrorMessage(errorText);
      }
    } catch (err: any) {
      setErrorMessage(
        err.message ||
          (isRtl ? 'حدث خطأ في الاتصال بالخادم.' : 'Server connection error.')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage(
        isRtl
          ? 'يرجى إدخال البريد الإلكتروني وكلمة المرور.'
          : 'Please enter email and password.'
      );
      return;
    }
    executeLogin(email, password);
  };

  return (
    <div className="w-full max-w-4xl mx-auto py-4">
      <div className="bg-white border border-stone-200 rounded-3xl shadow-sm overflow-hidden">
        {/* Banner Header */}
        <div className="bg-gradient-to-r from-teal-900 via-teal-800 to-stone-900 text-white p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-700/60 border border-teal-500/30 text-xs font-medium text-teal-200">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-300" />
                <span>{isRtl ? 'بوابة التحقق الرسمية' : 'Secure Multi-Tenant Auth'}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {isRtl ? 'تسجيل الدخول إلى منصة سُودا' : 'Sign in to Sooda Platform'}
              </h2>
              <p className="text-teal-100/80 text-xs sm:text-sm max-w-xl">
                {isRtl
                  ? 'بوابة الدخول الموحدة لتجار المتاجر وفريق العمل ومديري المنصة المركزية وفق بروتوكول عزل المستأجرين المشفر.'
                  : 'Unified portal for merchant owners, staff, and platform administrators with end-to-end tenant boundary isolation.'}
              </p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-teal-800/80 border border-teal-600/40 text-amber-400 flex items-center justify-center font-bold text-3xl shadow-inner shrink-0 self-start sm:self-auto">
              سُ
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Quick Sign-In Options for Seed Accounts */}
          <div className="lg:col-span-7 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-teal-700" />
                <span>{isRtl ? 'الدخول السريع بحسابات النظام المعتمدة' : 'One-Click Seed Accounts'}</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                {isRtl
                  ? 'اختر حساباً للتحقق الفوري من صلاحيات المستأجر والعزل الأمني عبر جلسة حقيقية مشفرة:'
                  : 'Select an account to verify real-time session issuance and store-scoped boundaries:'}
              </p>
            </div>

            <div className="space-y-3">
              {/* Account 1: Al-Baraka Store Owner */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => executeLogin('owner@albaraka.sd', 'MerchantPass#2026')}
                className="w-full text-start p-4 rounded-2xl border border-stone-200 hover:border-teal-400 hover:bg-teal-50/40 transition-all cursor-pointer group flex items-start justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                    <StoreIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-stone-900">
                        {isRtl ? 'أحمد البشير' : 'Ahmed Al-Bashir'}
                      </span>
                      <Badge variant="brand" size="sm">
                        {isRtl ? 'مالك متجر البركة' : 'Al-Baraka Owner'}
                      </Badge>
                    </div>
                    <p className="text-xs text-stone-500 font-mono mt-0.5">owner@albaraka.sd</p>
                    <p className="text-2xs text-stone-400 mt-1">
                      {isRtl ? 'متجر البركة (الخرطوم) • صلاحيات إدارة المتجر والإعدادات' : 'Al-Baraka Store Khartoum • Full Owner Permissions'}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-teal-700 group-hover:translate-x-0.5 transition-all mt-3 shrink-0" />
              </button>

              {/* Account 2: Nile Crafts Store Owner */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => executeLogin('owner@nilecrafts.sd', 'MerchantPass#2026')}
                className="w-full text-start p-4 rounded-2xl border border-stone-200 hover:border-amber-400 hover:bg-amber-50/40 transition-all cursor-pointer group flex items-start justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-stone-900">
                        {isRtl ? 'سارة عبد الله' : 'Sara Abdullah'}
                      </span>
                      <Badge variant="warning" size="sm">
                        {isRtl ? 'مالك حرف النيل' : 'Nile Crafts Owner'}
                      </Badge>
                    </div>
                    <p className="text-xs text-stone-500 font-mono mt-0.5">owner@nilecrafts.sd</p>
                    <p className="text-2xs text-stone-400 mt-1">
                      {isRtl ? 'متجر حرف النيل (بورتسودان) • التحقق من عزل المستأجرين' : 'Nile Crafts Port Sudan • Cross-Tenant Isolation Target'}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-amber-700 group-hover:translate-x-0.5 transition-all mt-3 shrink-0" />
              </button>

              {/* Account 3: Platform Admin */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => executeLogin('admin@sooda.sd', 'PlatformAdmin#2026')}
                className="w-full text-start p-4 rounded-2xl border border-stone-200 hover:border-purple-400 hover:bg-purple-50/40 transition-all cursor-pointer group flex items-start justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-stone-900">
                        {isRtl ? 'مدير المنصة العام' : 'Platform Administrator'}
                      </span>
                      <Badge variant="neutral" size="sm">
                        {isRtl ? 'إدارة المنصة الشاملة' : 'Global Admin'}
                      </Badge>
                    </div>
                    <p className="text-xs text-stone-500 font-mono mt-0.5">admin@sooda.sd</p>
                    <p className="text-2xs text-stone-400 mt-1">
                      {isRtl ? 'استعراض كافة المستأجرين وسجل الرقابة الأمني الشامل' : 'Inspect All Tenants & Global Immutable Audit Stream'}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-purple-700 group-hover:translate-x-0.5 transition-all mt-3 shrink-0" />
              </button>
            </div>
          </div>

          {/* Manual Credential Login Form */}
          <div className="lg:col-span-5 bg-stone-50 border border-stone-200 rounded-2xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-stone-700" />
                <span>{isRtl ? 'تسجيل دخول مخصص' : 'Custom Credentials'}</span>
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                {isRtl ? 'أدخل بيانات الاعتماد لأي حساب مسجل في قاعدة البيانات:' : 'Enter any registered account credentials:'}
              </p>
            </div>

            {errorMessage && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800 flex items-start gap-2.5 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{isRtl ? 'خطأ في المصادقة' : 'Authentication Error'}</p>
                  <p className="mt-0.5">{errorMessage}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-3.5">
              <Input
                label={isRtl ? 'البريد الإلكتروني' : 'Email Address'}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.sd"
                leftIcon={<Mail className="w-4 h-4 text-stone-400" />}
              />

              <Input
                label={isRtl ? 'كلمة المرور' : 'Password'}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                leftIcon={<Key className="w-4 h-4 text-stone-400" />}
              />

              <Button
                type="submit"
                variant="brand"
                size="md"
                className="w-full justify-center mt-2 cursor-pointer"
                isLoading={isLoading}
              >
                {isRtl ? 'تسجيل الدخول' : 'Sign In'}
              </Button>
            </form>

            <div className="pt-2 border-t border-stone-200 text-2xs text-stone-500 space-y-1">
              <p className="flex items-center gap-1.5 font-medium text-stone-600">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span>{isRtl ? 'حماية مشفرة عبر Argon2id وجلسات آمنة (HttpOnly)' : 'Argon2id Hash & Secure HttpOnly Sessions'}</span>
              </p>
              <p>
                {isRtl
                  ? 'تسجيل كل محاولة دخول في سجل رقابة غير قابل للتلاعب (SHA-256 Chain).'
                  : 'Every session creation is persisted to an immutable cryptographic audit ledger.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
