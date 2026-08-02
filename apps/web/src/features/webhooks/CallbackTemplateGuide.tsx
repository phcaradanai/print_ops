import { ACCEPTANCE_CALLBACK_SYSTEM_FIELDS } from '@printerops/domain';
import { Chip, CodeBlock, Inline, Panel, SectionHeading, Stack, Text } from '../../components/ui/index.js';
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
    <>
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
            <Stack gap="xs">
              {ACCEPTANCE_CALLBACK_SYSTEM_FIELDS.map((field, index) => {
                const token = SYSTEM_FIELD_TOKENS[index] ?? '';
                return (
                  <Inline key={field} gap="xs">
                    <Chip title={insertTitle(token)} onClick={() => onInsert(token)}>
                      {token}
                    </Chip>
                    <Text size="label" tone="muted">{t(systemFieldDescriptionKey(field))}</Text>
                  </Inline>
                );
              })}
            </Stack>
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
            {intakeFields.length === 0 ? (
              <Text size="label" tone="muted">
                {hasPolicy
                  ? t('page.webhooks.intakeFieldsEmptyPolicy')
                  : t('page.webhooks.intakeFieldsNoPolicy')}
              </Text>
            ) : (
              <Stack gap="xs">
                {intakeFields.map((field) => (
                  <Inline key={field.token} gap="xs">
                    <Chip title={insertTitle(field.token)} onClick={() => onInsert(field.token)}>
                      {field.token}
                    </Chip>
                    <Text size="label" tone="muted">
                      {t('page.webhooks.intakeFieldMappedTo').replace('{key}', field.mappedTo)}
                    </Text>
                  </Inline>
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </Panel>
    </>
  );
}
