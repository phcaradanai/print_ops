import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { localizeReadinessText } from '../i18n/readinessMessages.js';

const API = fileURLToPath(new URL('../../../api/src/routes/v1/readiness.routes.ts', import.meta.url));

describe('readiness message localization', () => {
  it('translates fixed and parameterised server sentences into Thai', () => {
    expect(localizeReadinessText('The local API is responding.', 'th')).toBe('API ภายในเครื่องตอบสนองปกติ');
    expect(localizeReadinessText('3 discovery runner(s) reported recently.', 'th')).toBe('ตัวค้นหาเครื่องพิมพ์ 3 ตัวรายงานเข้ามาเมื่อเร็วๆ นี้');
    expect(localizeReadinessText('Stream PRINT_INTAKE is not ready.', 'th')).toBe('สตรีม PRINT_INTAKE ยังไม่พร้อม');
  });

  it('leaves English and unknown sentences untouched', () => {
    expect(localizeReadinessText('The local API is responding.', 'en')).toBe('The local API is responding.');
    expect(localizeReadinessText('A brand new server sentence.', 'th')).toBe('A brand new server sentence.');
    expect(localizeReadinessText(undefined, 'th')).toBeUndefined();
  });

  it('covers every literal sentence the API currently emits', () => {
    // Fixed sentences only; templated ones are covered by the cases above.
    const literals = [...readFileSync(API, 'utf8').matchAll(/'([A-Z][^'$`]*\.)'/g)].map((m) => m[1])
      .filter((text) => !text.includes('.exported'));
    const missing = literals.filter((text) => localizeReadinessText(text, 'th') === text);
    expect(missing).toEqual([]);
  });
});
