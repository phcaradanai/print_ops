import { useRef } from 'react';
import { useLocale } from '../../../i18n/index.js';
import { useTemplateWorkspace } from '../hooks/useTemplateWorkspace.js';
import { Button, Card, CardDetail, CardDetailItem, Heading, Inline, Select } from '../../../components/ui/index.js';
import { TemplateIcon } from './TemplateIcon.js';
import { sanitizePreviewHtml } from '../../../lib/previewHtml.js';
import type { SampleMode } from '../model/types.js';

function formatDate(value: string | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale === 'th' ? 'th-TH' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TemplatePreview() {
  const { t, locale } = useLocale();
  const {
    preview, previewHtml, previewError, previewNote,
    sampleMode, refreshPreview, setFullPage,
    selectedId, templates, form, profiles
  } = useTemplateWorkspace();

  const previewRef = useRef<HTMLElement | null>(null);

  const selected = templates.find((tpl) => tpl.id === selectedId);
  const formProfile = profiles.find((p) => p.id === form.paperProfileId);
  const selectedProfile = profiles.find((p) => p.id === selected?.paperProfileId);

  const previewBody = (
    <div className="tpl-preview-stage">
      {previewError ? (
        <p className="tpl-preview-empty">{previewError}</p>
      ) : previewHtml ? (
        <div className="tpl-preview-paper" dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(previewHtml) }} />
      ) : (
        <p className="tpl-preview-empty">{t('page.templates.selectPreview')}</p>
      )}
    </div>
  );

  return (
    <Card className="tpl-preview" ref={previewRef}>
      <Inline style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-md)' }}>
        <Heading level={2}>{t('page.templates.previewTitle')}</Heading>
        <Inline gap="xs">
          <Select
            aria-label={t('page.templates.sampleInput')}
            controlSize="sm"
            value={sampleMode}
            onChange={(e) => refreshPreview(e.target.value as SampleMode)}
          >
            <option value="default">{t('page.templates.sampleDefault')}</option>
            <option value="profile">{t('page.templates.sampleProfile')}</option>
            <option value="empty">{t('page.templates.sampleEmpty')}</option>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => refreshPreview(sampleMode)}>
            <TemplateIcon name="refresh" /> {t('common.refresh')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFullPage(true)}
            disabled={!previewHtml}
          >
            <TemplateIcon name="expand" /> {t('page.templates.fullPage')}
          </Button>
        </Inline>
      </Inline>

      {previewBody}
      {previewNote && <p className="tpl-preview-note">{previewNote}</p>}
      {preview && preview.warnings.length > 0 && (
        <p className="tpl-preview-warnings">
          {t('page.templates.previewWarnings')}: {preview.warnings.join(', ')}
        </p>
      )}

      <div className="tpl-info">
        <h3>{t('page.templates.templateInfo')}</h3>
        <CardDetail>
          <CardDetailItem label={t('page.templates.engine')}>{selected?.engine ?? form.engine}</CardDetailItem>
          <CardDetailItem label={t('page.templates.paperProfile')}>
            {(selected ? selectedProfile?.name : formProfile?.name) ?? t('page.templates.noPaperProfile')}
          </CardDetailItem>
          <CardDetailItem label={t('page.templates.version')}>{selected?.version ?? '—'}</CardDetailItem>
          <CardDetailItem label={t('page.templates.status')}>{selected?.status ?? t('page.templates.unsavedDraft')}</CardDetailItem>
          <CardDetailItem label={t('page.templates.createdBy')}>{selected?.createdBy ?? '—'}</CardDetailItem>
          <CardDetailItem label={t('page.templates.createdAt')}>{formatDate(selected?.createdAt, locale)}</CardDetailItem>
          <CardDetailItem label={t('page.templates.updatedAt')}>{formatDate(selected?.updatedAt, locale)}</CardDetailItem>
        </CardDetail>
      </div>
    </Card>
  );
}
