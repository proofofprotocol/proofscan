/**
 * Tests for i18n module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getLang, t, getAllKeys, getCategoryLabel, resetLangCache } from './index.js';

describe('i18n', () => {
  // Save original env vars and restore after each test
  const originalPfscanLang = process.env.PFSCAN_LANG;
  const originalLang = process.env.LANG;
  const originalLcAll = process.env.LC_ALL;

  beforeEach(() => {
    // Reset cache before each test
    resetLangCache();
    // Clear environment
    delete process.env.PFSCAN_LANG;
    delete process.env.LANG;
    delete process.env.LC_ALL;
  });

  afterEach(() => {
    // Restore original environment
    if (originalPfscanLang !== undefined) {
      process.env.PFSCAN_LANG = originalPfscanLang;
    } else {
      delete process.env.PFSCAN_LANG;
    }
    if (originalLang !== undefined) {
      process.env.LANG = originalLang;
    } else {
      delete process.env.LANG;
    }
    if (originalLcAll !== undefined) {
      process.env.LC_ALL = originalLcAll;
    } else {
      delete process.env.LC_ALL;
    }
    resetLangCache();
  });

  describe('getLang', () => {
    it('returns en by default', () => {
      expect(getLang()).toBe('en');
    });

    it('respects PFSCAN_LANG=ja', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(getLang()).toBe('ja');
    });

    it('respects PFSCAN_LANG=en', () => {
      process.env.PFSCAN_LANG = 'en';
      resetLangCache();
      expect(getLang()).toBe('en');
    });

    it('respects PFSCAN_LANG=japanese', () => {
      process.env.PFSCAN_LANG = 'japanese';
      resetLangCache();
      expect(getLang()).toBe('ja');
    });

    it('respects LANG=ja_JP.UTF-8', () => {
      process.env.LANG = 'ja_JP.UTF-8';
      resetLangCache();
      expect(getLang()).toBe('ja');
    });

    it('respects LC_ALL over LANG', () => {
      process.env.LANG = 'en_US.UTF-8';
      process.env.LC_ALL = 'ja_JP.UTF-8';
      resetLangCache();
      expect(getLang()).toBe('ja');
    });

    it('PFSCAN_LANG has priority over LANG/LC_ALL', () => {
      process.env.LANG = 'ja_JP.UTF-8';
      process.env.LC_ALL = 'ja_JP.UTF-8';
      process.env.PFSCAN_LANG = 'en';
      resetLangCache();
      expect(getLang()).toBe('en');
    });

    it('caches the result', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(getLang()).toBe('ja');

      // Change env but don't reset cache
      process.env.PFSCAN_LANG = 'en';
      expect(getLang()).toBe('ja'); // Still cached

      // Reset cache to pick up new value
      resetLangCache();
      expect(getLang()).toBe('en');
    });
  });

  describe('t', () => {
    it('returns translated string for known key (English)', () => {
      expect(t('common.yes')).toBe('Yes');
      expect(t('common.no')).toBe('No');
    });

    it('returns key for unknown key', () => {
      expect(t('unknown.key')).toBe('unknown.key');
      expect(t('deeply.nested.missing.key')).toBe('deeply.nested.missing.key');
    });

    it('interpolates params', () => {
      expect(t('common.times', { count: 5 })).toBe('5 times');
      expect(t('common.items', { count: 10 })).toBe('10 items');
    });

    it('keeps placeholder if param not provided', () => {
      expect(t('common.times')).toBe('{count} times');
    });

    it('uses Japanese locale when PFSCAN_LANG=ja', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('common.yes')).toBe('はい');
      expect(t('common.no')).toBe('いいえ');
      expect(t('common.none')).toBe('(なし)');
    });

    it('interpolates params in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('common.times', { count: 5 })).toBe('5 回');
    });

    it('falls back to English if key missing in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      // tableHeader is not in ja.ts, should fall back to English
      expect(t('view.tableHeader')).toBe('Time         Sym Dir St Method                         Connector    Session      Extra');
    });

    it('handles nested keys', () => {
      expect(t('analyze.section.header', { label: 'Test' })).toBe('[Test]');
      expect(t('analyze.permission.allowed')).toBe('Allowed');
    });

    it('handles deeply nested keys in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('analyze.section.header', { label: 'テスト' })).toBe('【テスト】');
      expect(t('analyze.permission.allowed')).toBe('あり');
    });
  });

  describe('getAllKeys', () => {
    it('returns all keys', () => {
      const keys = getAllKeys();
      expect(keys).toContain('common.yes');
      expect(keys).toContain('common.no');
      expect(keys).toContain('category.read');
      expect(keys).toContain('analyze.section.header');
      expect(keys.length).toBeGreaterThan(50); // Ensure we have many keys
    });

    it('returns sorted keys', () => {
      const keys = getAllKeys();
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });

    it('filters by prefix', () => {
      const categoryKeys = getAllKeys('category.');
      expect(categoryKeys).toContain('category.read');
      expect(categoryKeys).toContain('category.write');
      expect(categoryKeys.every(k => k.startsWith('category.'))).toBe(true);
    });

    it('returns empty for non-existent prefix', () => {
      const keys = getAllKeys('nonexistent.prefix.');
      expect(keys).toEqual([]);
    });
  });

  describe('getCategoryLabel', () => {
    it('returns category labels in English', () => {
      expect(getCategoryLabel('read')).toBe('Read');
      expect(getCategoryLabel('write')).toBe('Write');
      expect(getCategoryLabel('network')).toBe('Network');
      expect(getCategoryLabel('exec')).toBe('Exec');
      expect(getCategoryLabel('other')).toBe('Other');
    });

    it('returns category labels in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(getCategoryLabel('read')).toBe('読み取り');
      expect(getCategoryLabel('write')).toBe('書き込み');
      expect(getCategoryLabel('network')).toBe('ネット接続');
      expect(getCategoryLabel('exec')).toBe('コマンド実行');
      expect(getCategoryLabel('other')).toBe('その他');
    });

    it('returns key for unknown category', () => {
      expect(getCategoryLabel('unknown')).toBe('category.unknown');
    });
  });

  describe('integration with analyze output', () => {
    it('produces correct analyze output in English', () => {
      expect(t('analyze.section.header', { label: getCategoryLabel('read') })).toBe('[Read]');
      expect(t('analyze.permission.label')).toBe('Permission');
      expect(t('analyze.usage.count', { count: 3 })).toBe('3 times');
      expect(t('analyze.total', { allowed: 5, count: 10 })).toBe('5 tools allowed, 10 calls');
    });

    it('produces correct analyze output in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('analyze.section.header', { label: getCategoryLabel('read') })).toBe('【読み取り】');
      expect(t('analyze.permission.label')).toBe('許可');
      expect(t('analyze.usage.count', { count: 3 })).toBe('3 回');
      expect(t('analyze.total', { allowed: 5, count: 10 })).toBe('5 ツール許可, 10 回使用');
    });
  });

  describe('integration with summary output', () => {
    it('produces correct summary section headers', () => {
      expect(t('summary.section.capability')).toBe('Capabilities');
      expect(t('summary.section.toolCall')).toBe('Tool Calls');
      expect(t('summary.section.notes')).toBe('Notes');
    });

    it('produces correct summary section headers in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('summary.section.capability')).toBe('できること（capability）');
      expect(t('summary.section.toolCall')).toBe('やったこと（tool call）');
      expect(t('summary.section.notes')).toBe('注意点');
    });

    it('produces correct note messages', () => {
      expect(t('summary.notes.execCalled')).toBe('Command execution was performed');
      expect(t('summary.notes.noSensitive')).toBe('No sensitive operations (write/network/exec) were performed');
    });

    it('produces correct note messages in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('summary.notes.execCalled')).toBe('コマンド実行が行われました');
      expect(t('summary.notes.noSensitive')).toBe('重要な操作（書き込み・ネット接続・コマンド実行）は実行されていません');
    });
  });

  describe('integration with record output', () => {
    it('produces correct record type labels', () => {
      expect(t('record.type.toolCall')).toBe('Tool Call');
      expect(t('record.type.capabilityCatalog')).toBe('Capability Catalog');
    });

    it('produces correct record type labels in Japanese', () => {
      process.env.PFSCAN_LANG = 'ja';
      resetLangCache();
      expect(t('record.type.toolCall')).toBe('やったこと（tool call）');
      expect(t('record.type.capabilityCatalog')).toBe('能力一覧（capability catalog）');
    });
  });
});
