import { useRef, useCallback } from 'react';
import { useLocale } from '../../../i18n/index.js';
import { useTemplateWorkspace } from '../hooks/useTemplateWorkspace.js';
import { Button, Card, FormField, Grid, Heading, Inline, Input, Select, Textarea, Stack, Toolbar } from '../../../components/ui/index.js';
import { TemplateIcon } from './TemplateIcon.js';
import { ENGINE_ICON, ENGINES } from '../hooks/helpers.js';
import type { BarcodeKind } from '../../../lib/barcode.js';

const VARIABLES: { token: string; labelKey: string }[] = [
  { token: 'label', labelKey: 'page.templates.varLabel' },
  { token: 'barcode', labelKey: 'page.templates.varBarcode' },
  { token: 'date', labelKey: 'page.templates.varDate' },
  { token: 'time', labelKey: 'page.templates.varTime' },
  { token: 'seq', labelKey: 'page.templates.varSeq' },
];

export function TemplateEditor() {
  const { t } = useLocale();
  const {
    form, updateEditorForm, profiles, editingId, busy,
    showLocalPreview, submit, requestCloseWorkspace
  } = useTemplateWorkspace();

  const formRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const formProfile = profiles.find((p) => p.id === form.paperProfileId);
  const profileKeys = (formProfile?.fields ?? []).map((f) => f.key).filter(Boolean);
  const contentLines = form.content.split('\n');

  const insertSnippet = useCallback((snippet: string) => {
    const el = contentRef.current;
    if (!el) {
      updateEditorForm((prev) => ({ ...prev, content: prev.content + snippet }));
      return;
    }
    const start = el.selectionStart ?? form.content.length;
    const end = el.selectionEnd ?? start;
    const next = form.content.slice(0, start) + snippet + form.content.slice(end);
    updateEditorForm((prev) => ({ ...prev, content: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }, [form.content, updateEditorForm]);

  const insertVariable = (token: string) => {
    insertSnippet(`{{${token}}}`);
  };

  const insertBarcodeToken = (kind: BarcodeKind) => {
    const matchingField = formProfile?.fields.find((f) => f.type === kind);
    const key = matchingField?.key || (kind === 'qrcode' ? 'qrcode' : 'barcode');
    insertSnippet(`{{${kind}:${key}}}`);
  };

  return (
    <Card className="tpl-editor" ref={formRef}>
      <Heading level={2}>
        {editingId ? t('page.templates.editTemplate') : t('page.templates.createTemplate')}
      </Heading>

      <Stack gap="lg">
        <Grid columns="auto" gap="md">
          <FormField
            label={t('page.templates.templateCode')}
            required
            requiredLabel={t('common.required')}
          >
            {(control) => (
              <Input
                {...control}
                value={form.templateCode}
                onChange={(e) => updateEditorForm({ ...form, templateCode: e.target.value })}
                placeholder={t('page.templates.templateCodePlaceholder')}
              />
            )}
          </FormField>
          <FormField
            label={t('page.templates.templateName')}
            required
            requiredLabel={t('common.required')}
          >
            {(control) => (
              <Input
                {...control}
                value={form.name}
                onChange={(e) => updateEditorForm({ ...form, name: e.target.value })}
                placeholder={t('page.templates.templateNamePlaceholder')}
              />
            )}
          </FormField>
          <FormField label={t('page.templates.paperProfile')}>
            {(control) => (
              <Select
                {...control}
                value={form.paperProfileId}
                onChange={(e) => updateEditorForm({ ...form, paperProfileId: e.target.value })}
              >
                <option value="">{t('page.templates.selectPaperProfile')}</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </Select>
            )}
          </FormField>
        </Grid>

        <fieldset className="tpl-engine-picker">
          <legend>{t('page.templates.engineType')}</legend>
          <div className="tpl-engine-grid">
            {ENGINES.map((engine) => (
              <button
                type="button"
                key={engine}
                className={`tpl-engine-card${form.engine === engine ? ' is-selected' : ''}`}
                aria-pressed={form.engine === engine}
                onClick={() => updateEditorForm({ ...form, engine })}
              >
                <span className="tpl-engine-card__icon" aria-hidden="true"><TemplateIcon name={ENGINE_ICON[engine]} /></span>
                <span className="tpl-engine-card__text">
                  <strong>{engine}</strong>
                  <small>{t(`page.templates.engineDesc.${engine}`)}</small>
                </span>
                {form.engine === engine && <span className="tpl-engine-card__check" aria-hidden="true"><TemplateIcon name="check" /></span>}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="tpl-content-block">
          <span className="tpl-field-label">{t('page.templates.content')}</span>
          <div className="tpl-content-row">
            <div className="tpl-code-editor">
              <div className="tpl-code-gutter" aria-hidden="true" ref={gutterRef}>
                {contentLines.map((_, i) => <span key={i}>{i + 1}</span>)}
              </div>
              <Textarea
                id="template-content"
                className="tpl-editor-content"
                mono={form.engine === 'JSON_LAYOUT' || form.engine === 'ZPL' || form.engine === 'RAW_TEXT' || form.engine === 'TSPL' || form.engine === 'EPL'}
                value={form.content}
                onChange={(e) => updateEditorForm({ ...form, content: e.target.value })}
                ref={contentRef}
                placeholder={t('page.templates.contentPlaceholder')}
                onScroll={(e) => {
                  if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
                aria-label={t('page.templates.content')}
              />
            </div>
            <div className="tpl-vars">
              <h3>{t('page.templates.availableKeys')}</h3>
              <div className="tpl-vars__barcode-actions">
                <button type="button" onClick={() => insertBarcodeToken('barcode')} title={t('page.templates.insertBarcodeHint')}>
                  <TemplateIcon name="barcode" /> {t('page.templates.insertBarcode')}
                </button>
                <button type="button" onClick={() => insertBarcodeToken('qrcode')} title={t('page.templates.insertQrcodeHint')}>
                  <TemplateIcon name="qrcode" /> {t('page.templates.insertQrcode')}
                </button>
              </div>
              <ul>
                {VARIABLES.map((v) => (
                  <li key={v.token}>
                    <button type="button" onClick={() => insertVariable(v.token)}>
                      <code>{`{{${v.token}}}`}</code>
                      <span>{t(v.labelKey)}</span>
                    </button>
                  </li>
                ))}
                {profileKeys.filter((k) => !VARIABLES.some((v) => v.token === k)).map((key) => (
                  <li key={key}>
                    <button type="button" onClick={() => insertVariable(key)}>
                      <code>{`{{${key}}}`}</code>
                      <span>{formProfile?.fields.find((f) => f.key === key)?.label ?? key}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="tpl-vars__hint">{t('page.templates.insertHint')}</p>
            </div>
          </div>
        </div>

        <Toolbar label={t('page.templates.editorActions')} align="between">
          <Button variant="ghost" onClick={showLocalPreview}>
            <TemplateIcon name="preview" /> {t('page.templates.previewBtn')}
          </Button>
          <Inline gap="sm">
            <Button
              onClick={() => void submit()}
              busy={busy}
              busyLabel={t('page.templates.saving')}
            >
              <TemplateIcon name="save" />{' '}
              {editingId ? t('page.templates.saveBtn') : t('page.templates.createTemplate')}
            </Button>
            <Button variant="ghost" onClick={requestCloseWorkspace}>
              {t('page.templates.cancelEdit')}
            </Button>
          </Inline>
        </Toolbar>
      </Stack>
    </Card>
  );
}
