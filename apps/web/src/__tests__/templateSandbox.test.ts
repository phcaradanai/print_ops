import { describe, expect, it } from 'vitest';
import { getCompanionTemplateId, resolvePaperProfileId } from '../pages/TemplateSandbox.js';

const templates = [
  { id: 'template-paper-a', paperProfileId: 'paper-a', engine: 'HTML' },
  { id: 'template-paper-b-json', paperProfileId: 'paper-b', engine: 'JSON_LAYOUT' },
  { id: 'template-paper-b', paperProfileId: 'paper-b', engine: 'HTML' },
  { id: 'template-generic', engine: 'HTML' },
];

describe('TemplateSandbox paper-first selection', () => {
  it('uses the paper profile companion template when the operator picks a profile', () => {
    expect(getCompanionTemplateId(templates, 'paper-b')).toBe('template-paper-b');
  });

  it('does not replace an explicitly selected paper profile with a template default', () => {
    expect(resolvePaperProfileId('paper-a', templates[2])).toBe('paper-a');
  });

  it('uses a template paper profile only when the operator has not selected one', () => {
    expect(resolvePaperProfileId('', templates[2])).toBe('paper-b');
  });
});
