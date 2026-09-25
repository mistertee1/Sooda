/**
 * Internationalization & Localization Architecture
 * Arabic (Primary, RTL) & English (Secondary, LTR)
 * Supports dynamic locale switching, translation key interpolation,
 * and localized validation messages.
 */

export type SupportedLocale = 'ar' | 'en';
export type Direction = 'rtl' | 'ltr';

export interface TranslationDictionary {
  platform: {
    name: string;
    tagline: string;
    phaseTitle: string;
    phaseSubtitle: string;
  };
  navigation: {
    dashboard: string;
    store: string;
    products: string;
    orders: string;
    customers: string;
    payments: string;
    shipping: string;
    settings: string;
    admin: string;
    architectureConsole: string;
    testSuite: string;
  };
  common: {
    active: string;
    inactive: string;
    status: string;
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    confirm: string;
    search: string;
    filter: string;
    loading: string;
    error: string;
    success: string;
    noData: string;
    viewDetails: string;
    language: string;
    arabic: string;
    english: string;
    direction: string;
  };
  tenancy: {
    tenantId: string;
    tenantScope: string;
    activeTenant: string;
    merchantBusiness: string;
    storeSlug: string;
    isolatedBoundary: string;
    crossTenantBlocked: string;
  };
  roles: {
    platformAdmin: string;
    merchantOwner: string;
    merchantStaff: string;
    storeCustomer: string;
  };
  paymentArchitecture: {
    title: string;
    note: string;
    merchantConfigured: string;
    workflowTitle: string;
    pendingPayment: string;
    paymentSubmitted: string;
    paymentUnderReview: string;
    paymentVerified: string;
    paymentRejected: string;
  };
  validation: {
    required: string;
    invalidEmail: string;
    invalidPhone: string;
    minLength: string;
    maxLength: string;
  };
  tests: {
    runAll: string;
    running: string;
    allPassed: string;
    failed: string;
    testName: string;
    result: string;
    duration: string;
  };
}

export const ARABIC_TRANSLATIONS: TranslationDictionary = {
  platform: {
    name: 'سُودا للتجارة الإلكترونية',
    tagline: 'منصة التجارة السحابية متعددة المتاجر المخصصة للسوق السوداني',
    phaseTitle: 'المرحلة 0: التأسيس والمعمارية والمخطط التقني',
    phaseSubtitle: 'البنية التحتية البرمجية، عزل المستأجرين، والأمان المؤسسي',
  },
  navigation: {
    dashboard: 'لوحة التحكم',
    store: 'المتجر',
    products: 'المنتجات',
    orders: 'الطلبات',
    customers: 'العملاء',
    payments: 'المدفوعات',
    shipping: 'الشحن والتوصيل',
    settings: 'الإعدادات',
    admin: 'إدارة المنصة',
    architectureConsole: 'لوحة المعمارية وعزل المستأجرين',
    testSuite: 'حزمة اختبارات التحقق للمرحلة 0',
  },
  common: {
    active: 'نشط',
    inactive: 'غير نشط',
    status: 'الحالة',
    save: 'حفظ التعديلات',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    confirm: 'تأكيد',
    search: 'بحث...',
    filter: 'تصفية',
    loading: 'جاري التحميل...',
    error: 'حدث خطأ',
    success: 'تمت العملية بنجاح',
    noData: 'لا توجد بيانات متاحة',
    viewDetails: 'عرض التفاصيل',
    language: 'اللغة',
    arabic: 'العربية (Arabic)',
    english: 'الإنجليزية (English)',
    direction: 'الاتجاه',
  },
  tenancy: {
    tenantId: 'معرّف المستأجر',
    tenantScope: 'نطاق عزل المستأجر',
    activeTenant: 'المستأجر النشط',
    merchantBusiness: 'الكيان التجاري',
    storeSlug: 'رابط المتجر المخصص',
    isolatedBoundary: 'حدود العزل البرمجي مضمونة',
    crossTenantBlocked: 'محاولة الوصول المتقاطع بين المتاجر محظورة تماماً',
  },
  roles: {
    platformAdmin: 'مدير المنصة العام',
    merchantOwner: 'مالك المتجر (التاجر)',
    merchantStaff: 'فريق عمل المتجر',
    storeCustomer: 'عميل المتجر',
  },
  paymentArchitecture: {
    title: 'معمارية المدفوعات المجهزة للمرحلة 7',
    note: 'المنصة لا تستقبل الأموال مباشرة - التاجر يحدد حساباته البنكية وتفاصيل الدفع اليدوي ويتحقق من الإيصالات.',
    merchantConfigured: 'حسابات دفع يحددها التاجر (بنك الخرطوم، بنك أم درمان، إلخ)',
    workflowTitle: 'سير حالة التحقق من الدفع',
    pendingPayment: 'في انتظار الدفع',
    paymentSubmitted: 'تم تقديم إشعار التحويل',
    paymentUnderReview: 'الإشعار قيد مراجعة التاجر',
    paymentVerified: 'تم تأكيد استلام الدفعة',
    paymentRejected: 'تم رفض الإشعار',
  },
  validation: {
    required: 'هذا الحقل مطلوب',
    invalidEmail: 'البريد الإلكتروني غير صالح',
    invalidPhone: 'رقم الهاتف يجب أن يتبع نسق الاتصالات في السودان (+249)',
    minLength: 'الحد الأدنى للأحرف هو {min}',
    maxLength: 'الحد الأقصى للأحرف هو {max}',
  },
  tests: {
    runAll: 'تشغيل كافة اختبارات المرحلة 0',
    running: 'جاري تنفيذ الاختبارات وفحص الحدود الأمنية...',
    allPassed: 'نجحت كافة اختبارات التحقق بنسبة 100%',
    failed: 'فشل أحد الاختبارات',
    testName: 'اسم الاختبار المعماري',
    result: 'النتيجة',
    duration: 'المدة (مللي ثانية)',
  },
};

export const ENGLISH_TRANSLATIONS: TranslationDictionary = {
  platform: {
    name: 'Sooda Commerce Platform',
    tagline: 'Multi-Tenant SaaS E-Commerce Platform for the Sudanese Market',
    phaseTitle: 'Phase 0: Foundation, Architecture & Technical Blueprint',
    phaseSubtitle: 'Enterprise Infrastructure, Strict Tenant Isolation & Security Boundaries',
  },
  navigation: {
    dashboard: 'Dashboard',
    store: 'Storefront',
    products: 'Products',
    orders: 'Orders',
    customers: 'Customers',
    payments: 'Payments',
    shipping: 'Shipping',
    settings: 'Settings',
    admin: 'Platform Admin',
    architectureConsole: 'Architecture & Multi-Tenancy Console',
    testSuite: 'Phase 0 Verification Test Suite',
  },
  common: {
    active: 'Active',
    inactive: 'Inactive',
    status: 'Status',
    save: 'Save Changes',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    confirm: 'Confirm',
    search: 'Search...',
    filter: 'Filter',
    loading: 'Loading...',
    error: 'Error occurred',
    success: 'Operation completed successfully',
    noData: 'No records available',
    viewDetails: 'View Details',
    language: 'Language',
    arabic: 'Arabic (العربية)',
    english: 'English (الإنجليزية)',
    direction: 'Direction',
  },
  tenancy: {
    tenantId: 'Tenant ID',
    tenantScope: 'Tenant Scope',
    activeTenant: 'Active Tenant',
    merchantBusiness: 'Merchant Business',
    storeSlug: 'Store Slug',
    isolatedBoundary: 'Isolated Boundary Enforced',
    crossTenantBlocked: 'Cross-Tenant Access Blocked',
  },
  roles: {
    platformAdmin: 'Platform Super Admin',
    merchantOwner: 'Merchant Store Owner',
    merchantStaff: 'Merchant Store Staff',
    storeCustomer: 'Store Customer',
  },
  paymentArchitecture: {
    title: 'Payment Architecture (Prepared for Phase 7)',
    note: 'Platform is not the financial recipient - Merchants configure their direct accounts and verify receipts.',
    merchantConfigured: 'Merchant-Configured Accounts (Bank of Khartoum, Omdurman Bank, etc.)',
    workflowTitle: 'Payment Verification Lifecycle',
    pendingPayment: 'Pending Payment',
    paymentSubmitted: 'Payment Submitted',
    paymentUnderReview: 'Payment Under Review',
    paymentVerified: 'Payment Verified',
    paymentRejected: 'Payment Rejected',
  },
  validation: {
    required: 'This field is required',
    invalidEmail: 'Invalid email address',
    invalidPhone: 'Phone must follow Sudan telecom standard (+249)',
    minLength: 'Minimum length is {min} characters',
    maxLength: 'Maximum length is {max} characters',
  },
  tests: {
    runAll: 'Run All Phase 0 Tests',
    running: 'Executing architectural & security checks...',
    allPassed: 'All Phase 0 Verification Tests Passed 100%',
    failed: 'Test Failed',
    testName: 'Architectural Test Name',
    result: 'Result',
    duration: 'Duration (ms)',
  },
};

export class I18nService {
  private static instance: I18nService;
  private currentLocale: SupportedLocale = 'ar';
  private listeners: Array<(locale: SupportedLocale, dir: Direction) => void> = [];

  public static getInstance(): I18nService {
    if (!I18nService.instance) {
      I18nService.instance = new I18nService();
    }
    return I18nService.instance;
  }

  public getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  public getDirection(): Direction {
    return this.currentLocale === 'ar' ? 'rtl' : 'ltr';
  }

  public setLocale(locale: SupportedLocale): void {
    this.currentLocale = locale;
    const dir = this.getDirection();

    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = dir;
    }

    this.listeners.forEach((listener) => listener(locale, dir));
  }

  public toggleLocale(): SupportedLocale {
    const next = this.currentLocale === 'ar' ? 'en' : 'ar';
    this.setLocale(next);
    return next;
  }

  public subscribe(listener: (locale: SupportedLocale, dir: Direction) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getTranslations(): TranslationDictionary {
    return this.currentLocale === 'ar' ? ARABIC_TRANSLATIONS : ENGLISH_TRANSLATIONS;
  }
}
