/**
 * The Webhooks page used to advertise fields (`$.event`, `$.printerId`,
 * `$.jobId`) that no PrintOps request has ever produced, in a syntax
 * (`${.field}`) the resolver cannot read, next to a "sample payload" written by
 * hand. These tests hold the three properties that broke:
 *   - what is offered can actually resolve;
 *   - what is shown as an example is derived, not written;
 *   - the intake half comes from this endpoint's own route policy.
 * See docs/architecture/webhook-callback-payload-editor.md.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_CALLBACK_SYSTEM_FIELDS } from '@printerops/domain';
import {
  DEFAULT_CALLBACK_TEMPLATE,
  SAMPLE_INTAKE_PAYLOAD,
  SAMPLE_SYSTEM_RESULT,
  SYSTEM_FIELD_TOKENS,
  intakeFieldTokens,
  previewCallbackTemplate,
  resolveCallbackTemplate,
  systemFieldDescriptionKey,
} from '../callbackTemplate.js';
import { CallbackTemplateGuide } from '../CallbackTemplateGuide.js';

const echo = (key: string) => key;

describe('default callback template', () => {
  it('is valid JSON', () => {
    expect(() => JSON.parse(DEFAULT_CALLBACK_TEMPLATE)).not.toThrow();
  });

  it('resolves with no leftover ${...} or unresolved $. tokens', () => {
    const preview = previewCallbackTemplate(DEFAULT_CALLBACK_TEMPLATE);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.json).not.toContain('${');
    expect(preview.json).not.toContain('$.');
    expect(preview.json).not.toContain('$$');
  });

  it('demonstrates both sources, not just one', () => {
    expect(DEFAULT_CALLBACK_TEMPLATE).toContain('$$.request_id');
    expect(DEFAULT_CALLBACK_TEMPLATE).toContain('$.yourField');

    const preview = previewCallbackTemplate(DEFAULT_CALLBACK_TEMPLATE);
    expect(preview.ok && JSON.parse(preview.json)).toMatchObject({
      request_id: SAMPLE_SYSTEM_RESULT['request_id'],
      your_field: SAMPLE_INTAKE_PAYLOAD['yourField'],
    });
  });

  it('names only fields the resolver can supply', () => {
    for (const [, raw] of Object.entries(JSON.parse(DEFAULT_CALLBACK_TEMPLATE) as Record<string, string>)) {
      if (!raw.startsWith('$$.')) continue;
      expect(ACCEPTANCE_CALLBACK_SYSTEM_FIELDS).toContain(raw.slice(3));
    }
  });
});

describe('resolveCallbackTemplate', () => {
  const sources = {
    payload: { hn: 'HN123', nested: { deep: 'value' }, result: { status: 'CALLER_OWNED' } },
    result: { status: 'QUEUED', print_job_id: 'J1', duplicate: false },
  };

  it('reads $$.field from the system result and $.field from the payload', () => {
    expect(resolveCallbackTemplate({ a: '$$.status', b: '$.hn' }, sources)).toEqual({
      a: 'QUEUED',
      b: 'HN123',
    });
  });

  it('keeps $.result.* pointing at the caller payload, not the system result', () => {
    // Mirrors the API test of the same name: this is why `$$.` is a separate
    // sigil rather than a `$.result.` namespace.
    expect(resolveCallbackTemplate({ a: '$.result.status' }, sources)).toEqual({ a: 'CALLER_OWNED' });
  });

  it('passes non-string and non-token values through untouched', () => {
    expect(resolveCallbackTemplate({ n: 1, b: true, s: 'plain', o: { k: 1 } }, sources)).toEqual({
      n: 1,
      b: true,
      s: 'plain',
      o: { k: 1 },
    });
  });

  it('resolves a dotted path', () => {
    expect(resolveCallbackTemplate({ d: '$.nested.deep' }, sources)).toEqual({ d: 'value' });
  });

  it('drops a key whose token names nothing, matching what the receiver sees', () => {
    const preview = previewCallbackTemplate('{"gone": "$.absent"}', sources);
    expect(preview.ok && JSON.parse(preview.json)).toEqual({});
  });
});

describe('previewCallbackTemplate', () => {
  it('reports invalid JSON instead of throwing mid-keystroke', () => {
    expect(previewCallbackTemplate('{"a": ')).toEqual({ ok: false, reason: 'invalid-json' });
  });

  it('reports an empty template, which means the default envelope is sent', () => {
    expect(previewCallbackTemplate('   ')).toEqual({ ok: false, reason: 'not-an-object' });
  });

  it('rejects a JSON array, which is not a template object', () => {
    expect(previewCallbackTemplate('[1,2]')).toEqual({ ok: false, reason: 'not-an-object' });
  });
});

describe('intakeFieldTokens', () => {
  it('offers the source paths, not the policy target keys', () => {
    // Callback templates resolve against the ORIGINAL intake payload, so
    // `hn_masked` would always come back null; `$.hn` is what resolves.
    expect(intakeFieldTokens({ barcode: '$.barcode', hn_masked: '$.hn' })).toEqual([
      { token: '$.barcode', mappedTo: 'barcode' },
      { token: '$.hn', mappedTo: 'hn_masked' },
    ]);
  });

  it('returns nothing for an unset or empty mapping', () => {
    expect(intakeFieldTokens(undefined)).toEqual([]);
    expect(intakeFieldTokens({})).toEqual([]);
  });

  it('skips mapping values that are not field paths', () => {
    expect(intakeFieldTokens({ literal: 'CONSTANT', good: '$.ok' })).toEqual([
      { token: '$.ok', mappedTo: 'good' },
    ]);
  });

  it('deduplicates two targets that read the same source path', () => {
    expect(intakeFieldTokens({ a: '$.same', b: '$.same' })).toHaveLength(1);
  });
});

describe('CallbackTemplateGuide', () => {
  it('renders every system field with its description, and the policy fields', () => {
    const markup = renderToStaticMarkup(
      <CallbackTemplateGuide
        preview={previewCallbackTemplate(DEFAULT_CALLBACK_TEMPLATE)}
        intakeFields={intakeFieldTokens({ barcode: '$.barcode', hn_masked: '$.hn' })}
        hasPolicy
        onInsert={() => {}}
        t={echo}
      />,
    );

    for (const token of SYSTEM_FIELD_TOKENS) {
      expect(markup).toContain(token);
    }
    for (const field of ACCEPTANCE_CALLBACK_SYSTEM_FIELDS) {
      expect(markup).toContain(systemFieldDescriptionKey(field));
    }
    expect(markup).toContain('$.barcode');
    expect(markup).toContain('$.hn');
    expect(markup).not.toContain('page.webhooks.intakeFieldsNoPolicy');
    expect(markup).not.toContain('page.webhooks.intakeFieldsEmptyPolicy');
  });

  it('distinguishes "no policy selected" from "policy declares no fields"', () => {
    const noPolicy = renderToStaticMarkup(
      <CallbackTemplateGuide
        preview={previewCallbackTemplate(DEFAULT_CALLBACK_TEMPLATE)}
        intakeFields={[]}
        hasPolicy={false}
        onInsert={() => {}}
        t={echo}
      />,
    );
    expect(noPolicy).toContain('page.webhooks.intakeFieldsNoPolicy');

    const emptyPolicy = renderToStaticMarkup(
      <CallbackTemplateGuide
        preview={previewCallbackTemplate(DEFAULT_CALLBACK_TEMPLATE)}
        intakeFields={[]}
        hasPolicy
        onInsert={() => {}}
        t={echo}
      />,
    );
    expect(emptyPolicy).toContain('page.webhooks.intakeFieldsEmptyPolicy');
  });

  it('shows why nothing is previewable rather than an empty code block', () => {
    const markup = renderToStaticMarkup(
      <CallbackTemplateGuide
        preview={previewCallbackTemplate('{"a": ')}
        intakeFields={[]}
        hasPolicy
        onInsert={() => {}}
        t={echo}
      />,
    );
    expect(markup).toContain('page.webhooks.resolvedPreviewInvalid');
  });

  it('never renders a fabricated example field', () => {
    const markup = renderToStaticMarkup(
      <CallbackTemplateGuide
        preview={previewCallbackTemplate(DEFAULT_CALLBACK_TEMPLATE)}
        intakeFields={[]}
        hasPolicy={false}
        onInsert={() => {}}
        t={echo}
      />,
    );
    for (const ghost of ['PRINT_COMPLETED', 'PRN-001', 'JOB-12345', '$.printerId', '$.jobId']) {
      expect(markup).not.toContain(ghost);
    }
  });
});
