import { CodeBlock, Panel, SectionHeading, Stack, Text, TokenList } from '../../components/ui/index.js';
import {
  SYSTEM_FIELD_TOKENS,
  systemFieldDescriptionKey,
  type IntakeFieldToken,
  type TemplatePreview,
} from './callbackTemplate.js';

export interface CallbackTemplateGuideProps {
  /** The template currently in the editor, already resolved. */
  preview: TemplatePreview;
  /** Intake paths declared by the route policy bound to this endpoint. */
  intakeFields: IntakeFieldToken[];
  /** Whether a route policy is selected at all — the two empty states differ. */
  hasPolicy: boolean;
  onInsert: (token: string) => void;
  t: (key: string) => string;
}

/** The unified v2 envelope — every status (QUEUED, SUCCESS, FAILED, …) uses
 *  exactly these keys; only the values differ. Keep in step with
 *  buildCallbackEnvelope in apps/api/src/services/callback-payload.ts. */
export const UNIFIED_PAYLOAD_KEYS = `{
  "version": 2,
  "event_id": "...",
  "event_type": "print.job.accepted | print.job.completed | print.job.rejected",
  "occurred_at": "2026-08-05T09:00:00.000Z",

  "request_id": "REQ-10482",
  "job_id": "9f1c2b7e-...",
  "source_system": "medisync",

  "status": "QUEUED | SUCCESS | FAILED | UNVERIFIED | ...",
  "data_quality": "OK | WITH_WARNINGS | null",
  "missing_fields": [],
  "render_warnings": [],

  "printer_code": "OFFICE_LASER_01",
  "runner_id": "desktop-local-worker | null",
  "trace_id": "trace_1c3bb5c3-...",
  "duplicate": false,
  "error": null,

  "timeline": {
    "accepted_at": "2026-08-05T09:00:00.000Z | null",
    "queued_at":   "2026-08-05T09:00:00.100Z | null",
    "started_at":  null,
    "terminal_at": null
  },

  "delivery": { "transports": ["HTTP"], "nats_mode": null }
}`;

/**
 * The reference column beside the callback payload editor: what the receiver
 * will actually get, and which tokens are legitimately available to put there.
 *
 * Split out of Webhooks.tsx so the two-group variable list can be rendered and
 * asserted in isolation. It owns no state and no data fetching — the page
 * decides which policy is selected and what the template says.
 */
export function CallbackTemplateGuide({
  preview,
  intakeFields,
  hasPolicy,
  onInsert,
  t,
}: CallbackTemplateGuideProps) {
  const insertTitle = (token: string) => t('page.webhooks.insertVariableTitle').replace('{v}', token);

  return (
    <Stack gap="md" className="webhook-template-guide">
      {/* What the receiver actually gets, resolved from the template currently
          in the editor rather than written by hand. */}
      <Panel title={t('page.webhooks.resolvedPreview')} padding="lg">
        <Stack gap="sm">
          <Text size="label" tone="muted">{t('page.webhooks.resolvedPreviewHint')}</Text>
          {preview.ok ? (
            <CodeBlock label={t('page.webhooks.resolvedPreview')} scroll={false}>
              {preview.json}
            </CodeBlock>
          ) : (
            <Text size="label" tone="warning">
              {preview.reason === 'invalid-json'
                ? t('page.webhooks.resolvedPreviewInvalid')
                : t('page.webhooks.resolvedPreviewEmpty')}
            </Text>
          )}
        </Stack>
      </Panel>

      {/* One key vocabulary across every status. The QUEUED acceptance and the
          terminal result carry the same keys — only the values differ
          (status, timeline entries, event_type). */}
      <Panel title={t('page.webhooks.unifiedPayloadTitle')} padding="lg">
        <Stack gap="sm">
          <Text size="label" tone="muted">{t('page.webhooks.unifiedPayloadHint')}</Text>
          <CodeBlock label={t('page.webhooks.unifiedPayloadTitle')} scroll={false}>
{UNIFIED_PAYLOAD_KEYS}
          </CodeBlock>
          <Text size="label" tone="muted">{t('page.webhooks.unifiedPayloadEventTypes')}</Text>
        </Stack>
      </Panel>

      {/* Available variables, split by where the value comes from. These insert
          into the template, so they are chips — the shape the system reserves
          for exactly this. */}
      <Panel title={t('page.webhooks.availableVariables')} padding="lg">
        <Stack gap="lg">
          <Stack gap="xs">
            <SectionHeading
              level={3}
              title={t('page.webhooks.systemFieldsTitle')}
              description={t('page.webhooks.systemFieldsHint')}
            />
            <TokenList
              insertTitle={insertTitle}
              onInsert={onInsert}
              items={SYSTEM_FIELD_TOKENS.map((token) => ({
                token,
                description: t(systemFieldDescriptionKey(token.slice(3))),
              }))}
            />
          </Stack>

          <Stack gap="xs">
            <SectionHeading
              level={3}
              title={t('page.webhooks.intakeFieldsTitle')}
              description={t('page.webhooks.intakeFieldsHint')}
            />
            {/* An empty list is a real answer, not a rendering gap: either no
                policy is bound yet or the bound one declares no fields. Those
                need different actions from the operator, so they say different
                things. */}
            <TokenList
              insertTitle={insertTitle}
              onInsert={onInsert}
              items={intakeFields.map((field) => ({
                token: field.token,
                description: t('page.webhooks.intakeFieldMappedTo').replace('{key}', field.mappedTo),
              }))}
              empty={
                <Text size="label" tone="muted">
                  {hasPolicy
                    ? t('page.webhooks.intakeFieldsEmptyPolicy')
                    : t('page.webhooks.intakeFieldsNoPolicy')}
                </Text>
              }
            />
          </Stack>
        </Stack>
      </Panel>
    </Stack>
  );
}
