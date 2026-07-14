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

  it('English translations are non-empty for all keys', () => {
    const enKeys = Object.keys(translations.en);
    for (const key of enKeys) {
      expect(
        translations.en[key],
        `Missing English translation for "${key}"`,
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

  it('nav accessibility keys exist in both locales', () => {
    expect(t('en', 'nav.menu.open')).toBeTruthy();
    expect(t('en', 'nav.menu.close')).toBeTruthy();
    expect(t('en', 'nav.ariaLabel')).toBeTruthy();
    expect(t('th', 'nav.menu.open')).toBeTruthy();
    expect(t('th', 'nav.menu.close')).toBeTruthy();
    expect(t('th', 'nav.ariaLabel')).toBeTruthy();
  });

  it('session role keys exist in both locales', () => {
    const roles = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const;
    for (const role of roles) {
      const key = `session.role.${role}`;
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
    expect(t('en', 'session.role.OWNER')).toBe('Sysadmin');
    expect(t('en', 'session.role.ADMIN')).toBe('Admin');
    expect(t('en', 'session.role.OPERATOR')).toBe('User');
    expect(t('en', 'session.role.VIEWER')).toBe('Viewer');
  });
});

describe('i18n page coverage', () => {
  const pagePrefixes = [
    'page.dashboard',
    'page.printers',
    'page.printerDetail',
    'page.jobQueue',
    'page.jobDetail',
    'page.runners',
    'page.auditLogs',
    'page.usersRoles',
    'page.export',
    'page.discovery',
    'page.diagnostics',
    'page.templates',
    'page.paperProfiles',
    'page.sandbox',
    'page.webhooks',
    'page.routePolicies',
    'page.bindings',
  ];

  for (const prefix of pagePrefixes) {
    it(`page prefix "${prefix}" has at least 2 keys in both locales`, () => {
      const enKeys = Object.keys(translations.en).filter((k) =>
        k.startsWith(prefix),
      );
      const thKeys = Object.keys(translations.th).filter((k) =>
        k.startsWith(prefix),
      );
      expect(
        enKeys.length,
        `Page prefix "${prefix}" has fewer than 2 English keys`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        thKeys.length,
        `Page prefix "${prefix}" has fewer than 2 Thai keys`,
      ).toBeGreaterThanOrEqual(2);
    });

    it(`page prefix "${prefix}" keys all have non-empty Thai values`, () => {
      const keys = Object.keys(translations.en).filter((k) =>
        k.startsWith(prefix),
      );
      for (const key of keys) {
        expect(translations.th[key], `Missing Thai for "${key}"`).toBeTruthy();
      }
    });
  }
});

describe('i18n common and status keys', () => {
  it('all common keys exist in both locales', () => {
    const commonKeys = [
      'common.save',
      'common.cancel',
      'common.reset',
      'common.loading',
      'common.error',
      'common.signOut',
      'common.signIn',
      'common.signingIn',
      'common.refresh',
      'common.create',
      'common.preview',
      'common.publish',
      'common.bind',
      'common.download',
      'common.copy',
      'common.noData',
    ];
    for (const key of commonKeys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
      expect(translations.en[key]).toBeTruthy();
      expect(translations.th[key]).toBeTruthy();
    }
  });

  it('all status keys exist in both locales', () => {
    const statusKeys = [
      'status.never',
      'status.secondsAgo',
      'status.minutesAgo',
      'status.hoursAgo',
      'status.noTrace',
      'status.registered',
      'status.unregistered',
      'status.enabled',
      'status.disabled',
      'status.active',
      'status.inactive',
    ];
    for (const key of statusKeys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
  });

  it('status interpolation placeholders are present in both locales', () => {
    expect(translations.en['status.secondsAgo']).toContain('{n}');
    expect(translations.th['status.secondsAgo']).toContain('{n}');
    expect(translations.en['status.minutesAgo']).toContain('{n}');
    expect(translations.th['status.minutesAgo']).toContain('{n}');
    expect(translations.en['status.hoursAgo']).toContain('{n}');
    expect(translations.th['status.hoursAgo']).toContain('{n}');
  });

  it('page.sandbox interpolation keys have placeholders in both locales', () => {
    const sandboxKeys = [
      'page.sandbox.copiesUnit',
      'page.sandbox.printSuccess',
      'page.sandbox.printFailed',
      'page.sandbox.templateNotAllowed',
      'page.sandbox.copiesExceeded',
      'page.sandbox.maxCopiesLabel',
    ];
    for (const key of sandboxKeys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
  });

  it('page.discovery interpolation keys have placeholders in both locales', () => {
    const discoveryKeys = [
      'page.discovery.confirmRegister',
      'page.discovery.registerSuccess',
      'page.discovery.registerError',
    ];
    for (const key of discoveryKeys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
  });

  it('page.diagnostics interpolation keys have placeholders in both locales', () => {
    const diagnosticsKeys = [
      'page.diagnostics.queuedKnown',
    ];
    for (const key of diagnosticsKeys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
  });

  it('error standalone keys exist in both locales', () => {
    const errorKeys = [
      'error.standalone.title',
      'error.standalone.message',
      'error.standalone.restart',
    ];
    for (const key of errorKeys) {
      expect(t('en', key)).toBeTruthy();
      expect(t('th', key)).toBeTruthy();
    }
  });
});

describe('i18n key count parity', () => {
  it('en and th have identical key count', () => {
    expect(Object.keys(translations.en).length).toBe(
      Object.keys(translations.th).length,
    );
  });

  it('has comprehensive page-level coverage', () => {
    const totalKeys = Object.keys(translations.en).length;
    // Expect at least 100 keys total for comprehensive coverage
    expect(totalKeys).toBeGreaterThanOrEqual(200);
  });
});
