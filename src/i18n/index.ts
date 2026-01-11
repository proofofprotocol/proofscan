/**
 * i18n module for proofscan
 *
 * Purpose: Unify user-facing string management, not just translation.
 * English is the default language. Other locales are optional.
 *
 * Environment variable priority:
 *   1. PFSCAN_LANG (e.g., 'en', 'ja')
 *   2. LANG / LC_ALL (extract first 2 chars)
 *   3. 'en' (default)
 */

import { en, type LocaleMessages } from './locales/en.js';
import { ja } from './locales/ja.js';

export type Lang = 'en' | 'ja';

// Cache for resolved locale
let cachedLang: Lang | null = null;

/**
 * Get current language from environment
 * Priority: PFSCAN_LANG > LANG/LC_ALL > 'en'
 */
export function getLang(): Lang {
  // Return cached value if available
  if (cachedLang !== null) {
    return cachedLang;
  }

  // Check PFSCAN_LANG first
  const pfscanLang = process.env.PFSCAN_LANG?.toLowerCase();
  if (pfscanLang === 'ja' || pfscanLang === 'japanese') {
    cachedLang = 'ja';
    return cachedLang;
  }
  if (pfscanLang === 'en' || pfscanLang === 'english') {
    cachedLang = 'en';
    return cachedLang;
  }

  // Check LANG / LC_ALL
  const langEnv = process.env.LC_ALL || process.env.LANG || '';
  const langCode = langEnv.slice(0, 2).toLowerCase();
  if (langCode === 'ja') {
    cachedLang = 'ja';
    return cachedLang;
  }

  // Default to English
  cachedLang = 'en';
  return cachedLang;
}

/**
 * Reset cached language (for testing)
 */
export function resetLangCache(): void {
  cachedLang = null;
}

/**
 * Get locale messages for current language
 */
function getLocale(): LocaleMessages | typeof ja {
  const lang = getLang();
  if (lang === 'ja') {
    return ja as LocaleMessages;
  }
  return en;
}

/**
 * Resolve nested key from object
 * @param obj - Object to search
 * @param key - Dot-notation key (e.g., 'analyze.section.header')
 * @returns Value or undefined
 */
function resolveKey(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === 'string') {
    return current;
  }
  return undefined;
}

/**
 * Interpolate parameters into string
 * @param template - String with {param} placeholders
 * @param params - Object with param values
 * @returns Interpolated string
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    if (value !== undefined) {
      return String(value);
    }
    return match; // Keep original if param not found
  });
}

/**
 * Translate key to localized string
 *
 * @param key - Dot-notation key (e.g., 'analyze.section.header')
 * @param params - Optional interpolation params (e.g., { label: 'Read' })
 * @returns Translated string, or key itself if not found
 *
 * @example
 * t('common.yes') // 'Yes' or 'はい'
 * t('analyze.calls', { count: 5 }) // '5 calls' or '5 回'
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const locale = getLocale();

  // Try current locale first
  let value = resolveKey(locale as unknown as Record<string, unknown>, key);

  // Fall back to English if not found in current locale
  if (value === undefined && locale !== en) {
    value = resolveKey(en as unknown as Record<string, unknown>, key);
  }

  // Return key if not found anywhere
  if (value === undefined) {
    return key;
  }

  return interpolate(value, params);
}

/**
 * Flatten nested object keys into dot-notation
 */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else if (typeof value === 'string') {
      keys.push(fullKey);
    }
  }

  return keys;
}

/**
 * Get all keys from English locale
 *
 * @param prefix - Optional prefix to filter keys
 * @returns Array of dot-notation keys
 *
 * @example
 * getAllKeys() // ['common.yes', 'common.no', 'category.read', ...]
 * getAllKeys('category.') // ['category.read', 'category.write', ...]
 */
export function getAllKeys(prefix?: string): string[] {
  const allKeys = flattenKeys(en as unknown as Record<string, unknown>);

  if (!prefix) {
    return allKeys.sort();
  }

  return allKeys.filter(k => k.startsWith(prefix)).sort();
}

/**
 * Get category label for operation category
 * Helper function for common use case
 */
export function getCategoryLabel(category: string): string {
  return t(`category.${category}`);
}

// Re-export types
export type { LocaleMessages };
