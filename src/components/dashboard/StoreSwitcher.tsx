import React from 'react';
import { Building2, ChevronDown, Check, Store as StoreIcon, Shield } from 'lucide-react';
import { Store, SystemRole } from '../../core/domain/index.ts';
import { Badge } from '../ui/Badge.tsx';

interface StoreSwitcherProps {
  stores: Store[];
  currentStoreId: string;
  onSelectStore: (storeId: string) => void;
  userRole?: SystemRole;
  isRtl?: boolean;
}

export const StoreSwitcher: React.FC<StoreSwitcherProps> = ({
  stores,
  currentStoreId,
  onSelectStore,
  userRole,
  isRtl = true,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const currentStore = stores.find((s) => s.id === currentStoreId) || stores[0];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="success" size="sm">{isRtl ? 'نشط' : 'Active'}</Badge>;
      case 'INACTIVE':
      default:
        return <Badge variant="neutral" size="sm">{isRtl ? 'غير نشط' : 'Inactive'}</Badge>;
    }
  };

  const getRoleLabel = (role?: SystemRole) => {
    switch (role) {
      case SystemRole.MERCHANT_OWNER:
        return isRtl ? 'مالك المتجر' : 'Store Owner';
      case SystemRole.MERCHANT_STAFF:
        return isRtl ? 'فريق العمل' : 'Store Staff';
      case SystemRole.PLATFORM_ADMIN:
        return isRtl ? 'مدير المنصة' : 'Platform Admin';
      default:
        return isRtl ? 'مستخدم' : 'User';
    }
  };

  return (
    <div className="relative inline-block text-start w-full sm:w-auto">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full sm:w-80 flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white border border-stone-200 rounded-xl hover:border-stone-300 hover:bg-stone-50/70 transition-all text-start shadow-2xs"
        id="store-switcher-button"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center shrink-0">
            <StoreIcon className="w-5 h-5" />
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-stone-900 truncate">
                {currentStore ? (isRtl ? currentStore.nameAr : (currentStore.nameEn || currentStore.nameAr)) : (isRtl ? 'اختر متجراً' : 'Select Store')}
              </p>
              {currentStore && getStatusBadge(currentStore.status)}
            </div>
            <p className="text-xs text-stone-500 font-mono truncate">
              {currentStore?.slug}.sooda.sd
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-stone-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-50 mt-1.5 w-full sm:w-88 bg-white rounded-xl shadow-lg border border-stone-200 py-1.5 focus:outline-none">
            <div className="px-3 py-2 border-b border-stone-100 flex items-center justify-between text-xs text-stone-500">
              <span>{isRtl ? 'المتاجر المصرح بها' : 'Authorized Stores'}</span>
              <span className="flex items-center gap-1 font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
                <Shield className="w-3 h-3" />
                {getRoleLabel(userRole)}
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {stores.map((s) => {
                const isSelected = s.id === currentStoreId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onSelectStore(s.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 text-start hover:bg-stone-50 transition-colors ${
                      isSelected ? 'bg-teal-50/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${
                        isSelected ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-700'
                      }`}>
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-stone-900 truncate">
                            {isRtl ? s.nameAr : (s.nameEn || s.nameAr)}
                          </span>
                          {getStatusBadge(s.status)}
                        </div>
                        <span className="text-xs text-stone-500 font-mono block truncate">
                          {s.slug}.sooda.sd
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <Check className="w-4 h-4 text-teal-700 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
