import { useMemo, useRef } from 'react';
import { ActionIcon } from '../../../components/ActionIcon.js';
import {
  Button,
  Card,
  EditorCanvas,
  FormField,
  Input,
  Inline,
  SectionHeading,
  Select,
  Stack,
  Text,
  Textarea,
} from '../../../components/ui/index.js';
import { CallbackTemplateGuide } from '../CallbackTemplateGuide.js';
import { intakeFieldTokens, previewCallbackTemplate } from '../callbackTemplate.js';
import { SOURCE_SYSTEM_PRESETS, parsePayloadTemplate } from '../model.js';
import type { WebhookEditorForm } from '../types.js';
import type { WebhookWorkspaceController } from '../useWebhookWorkspace.js';

function localizedError(t: (key: string) => string, value?: string): string | undefined {
  if (!value) return undefined;
  const [key, detail] = value.split('|', 2);
  const translated = t(key);
  return detail ? `${translated} ${detail}` : translated;
}

export function EndpointEditor({ controller }: { controller: WebhookWorkspaceController }) {
  const {
    t,
    form,
    updateForm,
    errors,
    editingId,
    policies,
    policiesResource,
    busy,
    closeEditor,
    saveEndpoint,
    testCallback,
  } = controller;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedPolicy = useMemo(
    () => policies.find((policy) => policy.id === form.routePolicyId),
    [form.routePolicyId, policies],
  );
  const intakeFields = useMemo(
    () => intakeFieldTokens(selectedPolicy?.payloadMapping),
    [selectedPolicy],
  );
  const preview = useMemo(
    () => previewCallbackTemplate(form.callbackPayloadTemplate),
    [form.callbackPayloadTemplate],
  );
  const parseResult = useMemo(
    () => parsePayloadTemplate(form.callbackPayloadTemplate),
    [form.callbackPayloadTemplate],
  );
  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      updateForm({ callbackPayloadTemplate: `${form.callbackPayloadTemplate}${variable}` });
      return;
    }
    const start = textarea.selectionStart ?? form.callbackPayloadTemplate.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${form.callbackPayloadTemplate.slice(0, start)}${variable}${form.callbackPayloadTemplate.slice(end)}`;
    updateForm({ callbackPayloadTemplate: next });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const showHttp = form.callbackTransport === 'HTTP' || form.callbackTransport === 'BOTH';
  const showNats = form.callbackTransport === 'NATS' || form.callbackTransport === 'BOTH';
  const templateError = localizedError(t, errors.callbackPayloadTemplate ?? parseResult.error);

  return (
    <Stack gap="lg" className="webhook-editor-stage">
      <Inline gap="sm" className="webhook-editor-stage__header">
        <Button variant="ghost" onClick={closeEditor}>
          <ActionIcon name="back" /> {t('page.webhooks.backToEndpoints')}
        </Button>
        <Stack gap="xs">
          <SectionHeading
            title={editingId
              ? t('page.webhooks.editorEditTitle').replace('{code}', form.endpointCode)
              : t('page.webhooks.editorCreateTitle')}
            description={t('page.webhooks.editorDescription')}
          />
        </Stack>
      </Inline>

      <Card>
        <SectionHeading
          level={2}
          title={t('page.webhooks.inboundSection')}
          description={t('page.webhooks.identityDescription')}
        />
        <Stack gap="xl">
          <section aria-labelledby="webhook-identity-title">
            <SectionHeading level={3} title={t('page.webhooks.identityTitle')} />
            <div className="webhook-form-grid webhook-form-grid--three">
              <FormField
                label={t('page.webhooks.endpointCode')}
                hint={t('page.webhooks.endpointCodeHint')}
                error={localizedError(t, errors.endpointCode)}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Input
                    {...control}
                    autoFocus={!editingId}
                    disabled={Boolean(editingId)}
                    invalid={Boolean(errors.endpointCode)}
                    value={form.endpointCode}
                    onChange={(event) => updateForm({ endpointCode: event.target.value })}
                    placeholder={t('page.webhooks.endpointCodePlaceholder')}
                  />
                )}
              </FormField>

              <FormField
                label={t('page.webhooks.displayName')}
                error={localizedError(t, errors.name)}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Input
                    {...control}
                    invalid={Boolean(errors.name)}
                    value={form.name}
                    onChange={(event) => updateForm({ name: event.target.value })}
                    placeholder={t('page.webhooks.namePlaceholder')}
                  />
                )}
              </FormField>

              <FormField
                label={t('page.webhooks.source')}
                hint={t('page.webhooks.sourceHint')}
                error={localizedError(t, errors.sourceSystem)}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <>
                    <Input
                      {...control}
                      list="webhook-source-system-presets"
                      invalid={Boolean(errors.sourceSystem)}
                      value={form.sourceSystem}
                      onChange={(event) => updateForm({ sourceSystem: event.target.value })}
                    />
                    <datalist id="webhook-source-system-presets">
                      {SOURCE_SYSTEM_PRESETS.map((source) => <option key={source} value={source} />)}
                    </datalist>
                  </>
                )}
              </FormField>
            </div>
          </section>

          <section aria-labelledby="webhook-routing-title">
            <SectionHeading level={3} title={t('page.webhooks.routingTitle')} />
            <div className="webhook-form-grid webhook-form-grid--two">
              <FormField
                label={t('page.webhooks.authModeLabel')}
                hint={form.authMode === 'API_KEY'
                  ? t('page.webhooks.authApiKeyHelp')
                  : t('page.webhooks.authNoneHelp')}
                error={localizedError(t, errors.authMode)}
              >
                {(control) => (
                  <Select
                    {...control}
                    invalid={Boolean(errors.authMode)}
                    value={form.authMode}
                    onChange={(event) => updateForm({ authMode: event.target.value })}
                  >
                    <option value="NONE">{t('page.webhooks.authNone')} (NONE)</option>
                    <option value="API_KEY">{t('page.webhooks.authApiKey')} (API_KEY)</option>
                  </Select>
                )}
              </FormField>

              <FormField
                label={t('page.webhooks.routePolicyLabel')}
                hint={policiesResource.error != null
                  ? t('page.webhooks.routePolicyUnavailable')
                  : policies.length === 0
                    ? t('page.webhooks.routePolicyEmpty')
                    : undefined}
                error={localizedError(t, errors.routePolicyId)}
                required
                requiredLabel={t('common.required')}
              >
                {(control) => (
                  <Select
                    {...control}
                    disabled={policiesResource.error != null || policiesResource.loading}
                    invalid={Boolean(errors.routePolicyId)}
                    value={form.routePolicyId}
                    onChange={(event) => updateForm({ routePolicyId: event.target.value })}
                  >
                    <option value="">{t('page.webhooks.routePolicyPlaceholder')}</option>
                    {policies.map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.policyCode} — {policy.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
          </section>
        </Stack>
      </Card>

      <Card>
        <SectionHeading
          level={2}
          title={t('page.webhooks.outboundSection')}
          description={t('page.webhooks.callbackAcceptanceHelp')}
        />
        <Stack gap="xl">
          <div className="webhook-form-grid webhook-form-grid--two">
            <FormField
              label={t('page.webhooks.callbackTriggerTitle')}
              hint={form.callbackOnPrintResult
                ? t('page.webhooks.callbackTerminalHelp')
                : t('page.webhooks.callbackAcceptanceHelp')}
            >
              {(control) => (
                <Select
                  {...control}
                  value={form.callbackOnPrintResult ? 'terminal' : 'acceptance'}
                  onChange={(event) => updateForm({ callbackOnPrintResult: event.target.value === 'terminal' })}
                >
                  <option value="acceptance">{t('page.webhooks.callbackTriggerAcceptance')}</option>
                  <option value="terminal">{t('page.webhooks.callbackTriggerTerminal')}</option>
                </Select>
              )}
            </FormField>

            <FormField label={t('page.webhooks.callbackTransportTitle')}>
              {(control) => (
                <Select
                  {...control}
                  value={form.callbackTransport}
                  onChange={(event) => updateForm({
                    callbackTransport: event.target.value as WebhookEditorForm['callbackTransport'],
                  })}
                >
                  <option value="NONE">{t('page.webhooks.transport.none')}</option>
                  <option value="HTTP">{t('page.webhooks.transport.http')}</option>
                  <option value="NATS">{t('page.webhooks.transport.nats')}</option>
                  <option value="BOTH">{t('page.webhooks.transport.both')}</option>
                </Select>
              )}
            </FormField>
          </div>

          {(showHttp || showNats) && (
            <div className="webhook-form-grid webhook-form-grid--two">
              {showHttp && (
                <FormField
                  label={t('page.webhooks.httpTargetLabel')}
                  error={localizedError(t, errors.callbackUrl)}
                  required
                  requiredLabel={t('common.required')}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="url"
                      invalid={Boolean(errors.callbackUrl)}
                      value={form.callbackUrl}
                      onChange={(event) => updateForm({ callbackUrl: event.target.value })}
                      placeholder={t('page.webhooks.httpTargetPlaceholder')}
                    />
                  )}
                </FormField>
              )}
              {showNats && (
                <FormField
                  label={t('page.webhooks.natsSubjectLabel')}
                  error={localizedError(t, errors.callbackNatsSubject)}
                  required
                  requiredLabel={t('common.required')}
                >
                  {(control) => (
                    <Input
                      {...control}
                      mono
                      invalid={Boolean(errors.callbackNatsSubject)}
                      value={form.callbackNatsSubject}
                      onChange={(event) => updateForm({ callbackNatsSubject: event.target.value })}
                      placeholder={t('page.webhooks.natsSubjectPlaceholder')}
                    />
                  )}
                </FormField>
              )}
            </div>
          )}

          <div className="webhook-template-layout">
            <FormField
              label={t('page.webhooks.payloadTemplate')}
              hint={form.callbackOnPrintResult
                ? t('page.webhooks.payloadTemplateIgnoredOnResult')
                : t('page.webhooks.payloadTemplateHelp')}
              error={templateError}
            >
              {(control) => (
                <EditorCanvas
                  {...control}
                  ref={textareaRef}
                  minHeight="18rem"
                  invalid={Boolean(templateError)}
                  value={form.callbackPayloadTemplate}
                  onChange={(event) => updateForm({ callbackPayloadTemplate: event.target.value })}
                />
              )}
            </FormField>

            <CallbackTemplateGuide
              preview={preview}
              intakeFields={intakeFields}
              hasPolicy={Boolean(form.routePolicyId)}
              onInsert={insertVariable}
              t={t}
            />
          </div>
        </Stack>
      </Card>

      <div className="webhook-editor-actions" role="group" aria-label={t('page.webhooks.editorCreateTitle')}>
        <Button variant="ghost" onClick={closeEditor}>{t('common.cancel')}</Button>
        <Button variant="secondary" busy={busy} onClick={() => void saveEndpoint(false)}>
          {t('page.webhooks.saveDraft')}
        </Button>
        <Stack gap="xs" className="webhook-test-action">
          <Button
            variant="secondary"
            disabled={!editingId || busy}
            onClick={() => void testCallback()}
          >
            <ActionIcon name="play" /> {t('page.webhooks.testSavedEndpoint')}
          </Button>
          {!editingId && <Text size="label" tone="muted">{t('page.webhooks.unsavedTestHelp')}</Text>}
        </Stack>
        <Button busy={busy} onClick={() => void saveEndpoint(true)}>
          {editingId ? t('page.webhooks.saveEndpoint') : t('page.webhooks.createEndpoint')}
        </Button>
      </div>
    </Stack>
  );
}
