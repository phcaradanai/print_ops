import { describe, it, expect } from 'vitest';
import { translations, t, type Locale } from '../i18n/translations';

describe('i18n translations', () => {
  it('has both en and th locales', () => {
    expect(translations.en).toBeDefined();
    expect(translations.th).toBeDefined();
  });

  it('en and th have the same keys', () => {
    const enKeys = Object.keys(translations.en).sort();
    const thKeys = Object.keys(translations.th).sort();
    expect(thKeys).toEqual(enKeys);
  });

  it('t() returns English for en locale', () => {
    expect(t('en', 'nav.dashboard')).toBe('Dashboard');
    expect(t('en', 'nav.printers')).toBe('Printers');
    expect(t('en', 'common.save')).toBe('Save');
  });

  it('t() returns Thai for th locale', () => {
    expect(t('th', 'nav.dashboard')).toBe('แดชบอร์ด');
    expect(t('th', 'nav.printers')).toBe('เครื่องพิมพ์');
    expect(t('th', 'common.save')).toBe('บันทึก');
  });

  it('t() falls back to English for unknown locale', () => {
    expect(t('xx' as Locale, 'nav.dashboard')).toBe('Dashboard');
  });

  it('t() returns key for unknown key', () => {
    expect(t('en', 'nonexistent.key')).toBe('nonexistent.key');
  });

  it('Thai translations are non-empty for all keys', () => {
    const enKeys = Object.keys(translations.en);
    for (const key of enKeys) {
      expect(
        translations.th[key],
        `Missing Thai translation for "${key}"`,
      ).toBeTruthy();
    }
  });

  it('navigation group labels exist in both locales', () => {
    expect(t('en', 'nav.group.operations')).toBe('Operator Workflow');
    expect(t('en', 'nav.group.administration')).toBe('Administration');
    expect(t('th', 'nav.group.operations')).toBeTruthy();
    expect(t('th', 'nav.group.administration')).toBeTruthy();
  });

  it('settings keys exist in both locales', () => {
    const keys = [
      'settings.title',
      'settings.language',
      'settings.appearance',
      'settings.workspace',
      'settings.saved',
    ];
    for (const key of keys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
  });
});
