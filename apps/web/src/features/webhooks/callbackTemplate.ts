import { ACCEPTANCE_CALLBACK_SYSTEM_FIELDS, type AcceptanceCallbackSystemField } from '@printerops/domain';

/**
 * Client-side mirror of the acceptance-callback template resolver in
 * apps/api/src/services/webhook-callback.service.ts.
 *
 * It exists so the Webhooks page can show an operator the *resolved* body their
 * template produces instead of a hand-written example. The previous "Sample
 * Payload" panel showed `{"event": "PRINT_COMPLETED", "printerId": "PRN-001"}` —
 * a shape this system has never produced for any request.
 *
 * The two rules that must stay in step with the server:
 *   `$.field`  -> the caller's intake payload
 *   `$$.field` -> the intake response PrintOps produced (system fields)
 * Only a whole-value token resolves; embedded tokens inside a longer string are
 * left literal, exactly as resolveTemplate does.
 */

const FIELD_PATH = /^\$\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const SYSTEM_FIELD_PATH = /^\$\$\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

export const SYSTEM_FIELD_TOKENS: readonly string[] = ACCEPTANCE_CALLBACK_SYSTEM_FIELDS.map(
  (field) => `$$.${field}`,
);

/** Translation key carrying the one-line description of a system field. */
export function systemFieldDescriptionKey(field: AcceptanceCallbackSystemField): string {
  return `page.webhooks.systemField.${field}`;
}

/**
 * Default template for a new endpoint. Deliberately mixes both sources, so the
 * first thing an operator sees demonstrates that a custom template does not
 * cost them the system fields.
 */
export const DEFAULT_CALLBACK_TEMPLATE = `{
  "event_type": "print.job.accepted",
  "request_id": "$$.request_id",
  "print_job_id": "$$.print_job_id",
  "status": "$$.status",
  "printer_code": "$$.resolved_printer_code",
  "your_field": "$.yourField"
}`;

/** Stand-in for what PrintOps returns, used only to render the preview. */
export const SAMPLE_SYSTEM_RESULT: Record<string, unknown> = {
  accepted: true,
  print_job_id: '9f1c2b7e-4a30-4d51-9f8e-2c7b1a4d0e63',
  request_id: 'REQ-10482',
  trace_id: 'trace_1c3bb5c3-7f21-4a90-b0d6-2f5a9c81e774',
  resolved_printer_code: 'OFFICE_LASER_01',
  resolved_template_code: 'TEST_LABEL',
  status: 'QUEUED',
  duplicate: false,
};

/** Stand-in for the caller's body. `yourField` matches DEFAULT_CALLBACK_TEMPLATE. */
export const SAMPLE_INTAKE_PAYLOAD: Record<string, unknown> = {
  yourField: 'value the caller sent',
};

function fieldValue(source: Record<string, unknown>, path: string): unknown {
  const clean = path.startsWith('$.') ? path.slice(2) : path;
  return clean.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

export interface TemplateResolutionSources {
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** Resolve one parsed template object the way the server would. */
export function resolveCallbackTemplate(
  template: Record<string, unknown>,
  sources: TemplateResolutionSources,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(template)) {
    if (typeof raw !== 'string') {
      out[key] = raw;
    } else if (SYSTEM_FIELD_PATH.test(raw)) {
      out[key] = fieldValue(sources.result, raw.slice(1));
    } else if (FIELD_PATH.test(raw)) {
      out[key] = fieldValue(sources.payload, raw);
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export type TemplatePreview =
  | { ok: true; json: string }
  | { ok: false; reason: 'invalid-json' | 'not-an-object' };

/**
 * Render the body a template text would produce. Returns a typed failure rather
 * than throwing, because the editor calls this on every keystroke and a
 * half-typed template is the normal state, not an error worth a toast.
 */
export function previewCallbackTemplate(
  templateText: string,
  sources: TemplateResolutionSources = { payload: SAMPLE_INTAKE_PAYLOAD, result: SAMPLE_SYSTEM_RESULT },
): TemplatePreview {
  if (!templateText.trim()) return { ok: false, reason: 'not-an-object' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(templateText);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-an-object' };
  }
  const resolved = resolveCallbackTemplate(parsed as Record<string, unknown>, sources);
  // JSON.stringify drops keys whose value is undefined — which is exactly what
  // the receiver sees when a token names a field that was not supplied.
  return { ok: true, json: JSON.stringify(resolved, null, 2) };
}

export interface IntakeFieldToken {
  /** The token an operator writes in the template, e.g. `$.barcode`. */
  token: string;
  /** The policy's target key that reads this path, e.g. `hn_masked`. */
  mappedTo: string;
}

/**
 * Intake fields an endpoint can actually reference, derived from the route
 * policy bound to it.
 *
 * A policy's payloadMapping is `{ targetKey: "$.sourcePath" }`. Callback
 * templates resolve against the ORIGINAL intake payload, not the mapped one, so
 * the referenceable token is the source path (the value), not the target key.
 * Offering `hn_masked` here would produce a callback field that is always null.
 */
export function intakeFieldTokens(payloadMapping: Record<string, string> | undefined): IntakeFieldToken[] {
  if (!payloadMapping) return [];
  const seen = new Map<string, IntakeFieldToken>();
  for (const [mappedTo, sourcePath] of Object.entries(payloadMapping)) {
    if (typeof sourcePath !== 'string' || !FIELD_PATH.test(sourcePath)) continue;
    if (!seen.has(sourcePath)) seen.set(sourcePath, { token: sourcePath, mappedTo });
  }
  return [...seen.values()].sort((a, b) => a.token.localeCompare(b.token));
}
