import { Store, StoreSettings, TenantMembership, SystemRole, AccountStatus } from '../../core/domain/index.ts';

export interface DashboardStoreData {
  store: Store;
  settings: StoreSettings | null;
  membership: TenantMembership | null;
}

export interface PersonaOption {
  id: string;
  nameAr: string;
  nameEn: string;
  role: SystemRole;
  storeId: string;
  storeNameAr: string;
  token: string;
}
