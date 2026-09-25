/**
 * Currency Abstraction Foundation
 * Default currency: SDG (Sudanese Pound)
 * Fully extensible for multi-currency support without hard-coding currency logic.
 */

export interface CurrencyConfig {
  code: string; // ISO 4217 code e.g. "SDG", "USD", "SAR"
  symbolAr: string; // e.g. "ج.س"
  symbolEn: string; // e.g. "SDG"
  nameAr: string; // e.g. "جنيه سوداني"
  nameEn: string; // e.g. "Sudanese Pound"
  decimals: number; // 2
  exchangeRateToBase: number; // Base is SDG = 1.0
  isActive: boolean;
}

export const SYSTEM_CURRENCIES: Record<string, CurrencyConfig> = {
  SDG: {
    code: 'SDG',
    symbolAr: 'ج.س',
    symbolEn: 'SDG',
    nameAr: 'جنيه سوداني',
    nameEn: 'Sudanese Pound',
    decimals: 2,
    exchangeRateToBase: 1.0,
    isActive: true,
  },
  USD: {
    code: 'USD',
    symbolAr: '$',
    symbolEn: '$',
    nameAr: 'دولار أمريكي',
    nameEn: 'US Dollar',
    decimals: 2,
    exchangeRateToBase: 0.0017, // Conceptual exchange rate placeholder
    isActive: true,
  },
  SAR: {
    code: 'SAR',
    symbolAr: 'ر.س',
    symbolEn: 'SAR',
    nameAr: 'ريال سعودي',
    nameEn: 'Saudi Riyal',
    decimals: 2,
    exchangeRateToBase: 0.0062,
    isActive: true,
  },
  AED: {
    code: 'AED',
    symbolAr: 'د.إ',
    symbolEn: 'AED',
    nameAr: 'درهم إماراتي',
    nameEn: 'UAE Dirham',
    decimals: 2,
    exchangeRateToBase: 0.0061,
    isActive: true,
  },
};

export class CurrencyManager {
  private static defaultCurrencyCode = 'SDG';

  public static getDefaultCurrency(): CurrencyConfig {
    return SYSTEM_CURRENCIES[this.defaultCurrencyCode] || SYSTEM_CURRENCIES.SDG;
  }

  public static getCurrency(code: string): CurrencyConfig {
    const curr = SYSTEM_CURRENCIES[code.toUpperCase()];
    if (!curr) {
      throw new Error(`Unsupported currency code '${code}'`);
    }
    return curr;
  }

  /**
   * Formats a monetary amount based on locale and currency.
   * In Arabic RTL: "١٥,٠٠٠ ج.س" or "15,000 ج.س"
   * In English LTR: "15,000.00 SDG"
   */
  public static formatAmount(
    amount: number,
    currencyCode = 'SDG',
    locale: 'ar' | 'en' = 'ar'
  ): string {
    const currency = SYSTEM_CURRENCIES[currencyCode.toUpperCase()] || SYSTEM_CURRENCIES.SDG;
    const formattedNumber = new Intl.NumberFormat(locale === 'ar' ? 'ar-SD' : 'en-US', {
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    }).format(amount);

    if (locale === 'ar') {
      return `${formattedNumber} ${currency.symbolAr}`;
    }
    return `${currency.symbolEn} ${formattedNumber}`;
  }

  /**
   * Converts an amount from one currency to another using the exchange registry.
   */
  public static convert(amount: number, fromCurrencyCode: string, toCurrencyCode: string): number {
    const from = this.getCurrency(fromCurrencyCode);
    const to = this.getCurrency(toCurrencyCode);

    if (from.code === to.code) {
      return amount;
    }

    // Convert to Base (SDG)
    const amountInBase = amount / from.exchangeRateToBase;
    // Convert from Base to Target
    return Number((amountInBase * to.exchangeRateToBase).toFixed(to.decimals));
  }
}
