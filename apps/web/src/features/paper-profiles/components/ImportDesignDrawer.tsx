import {
  ACCEPTED_IMPORT_MIME_TYPES,
  MAX_IMPORT_FILE_BYTES,
  isLowImportDpi,
} from '../model/importDesign.js';
import type { ImportFitMode, PaperForm } from '../model/types.js';
import type { ImportDesignController } from '../hooks/useImportDesign.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { Translate } from './types.js';
import { TransferIcon } from '../../../components/TransferIcon.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import { Drawer } from '../../../components/ui/index.js';

export function ImportDesignDrawer({ controller, popups, t }: {
  controller: ImportDesignController;
  popups: PaperProfilePopups;
  t: Translate;
}) {
  const close = () => {
    controller.invalidate();
    controller.reset();
    popups.closeDrawer();
  };
  return (
    <Drawer
      open
      onClose={close}
      title={t('page.paperProfiles.importDesign')}
      closeLabel={t('common.cancel')}
      className="pp-drawer--import"
    >
          {controller.error && <div className="pp-import-error">{controller.error}</div>}
          {controller.phase === 'select' && (
            <label className="pp-import-dropzone">
              <input type="file" accept={ACCEPTED_IMPORT_MIME_TYPES.join(',')} hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) controller.selectFile(file);
                  event.target.value = '';
                }} />
              <span className="pp-import-dropzone__icon"><TransferIcon action="import" /></span>
              <strong>{t('page.paperProfiles.importSelectFile')}</strong>
              <span>{t('page.paperProfiles.importMaxSize').replace('{size}', String(MAX_IMPORT_FILE_BYTES / 1024 / 1024))}</span>
            </label>
          )}
          {controller.phase === 'analyzing' && <ImportProgress text={t('page.paperProfiles.importAnalyzing')} />}
          {controller.phase === 'importing' && <ImportProgress text={t('page.paperProfiles.importImporting')} />}
          {controller.phase === 'error' && (
            <button type="button" className="ds-btn ds-btn--ghost" onClick={controller.reset}>
              {t('page.paperProfiles.importRetry')}
            </button>
          )}
          {controller.phase === 'review' && controller.analysis && (
            <ImportReview controller={controller} t={t} />
          )}
    </Drawer>
  );
}

function ImportProgress({ text }: { text: string }) {
  return (
    <div className="pp-import-progress">
      <div className="pp-import-spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function ImportReview({ controller, t }: { controller: ImportDesignController; t: Translate }) {
  const { analysis, draft, draftErrors } = controller;
  if (!analysis) return null;
  const patch = <K extends keyof PaperForm>(key: K, value: PaperForm[K]) => {
    controller.setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <div>
      <h3>{t('page.paperProfiles.importReviewTitle')}</h3>
      {controller.objectUrl && <img src={controller.objectUrl} alt={t('page.paperProfiles.importThumbnail')} className="pp-import-thumbnail" />}
      <div className="pp-import-file-info">
        <span>{controller.file?.name}</span>
        <span>{analysis.pixelWidth} × {analysis.pixelHeight} px</span>
        <span>{analysis.suggestedDpi} DPI</span>
      </div>
      {analysis.detectedDpi === null && (
        <div className="pp-import-warning"><PaperProfileIcon name="warning" /> {t('page.paperProfiles.importWarningNoDpi').replace('{dpi}', String(analysis.suggestedDpi))}</div>
      )}
      {isLowImportDpi(analysis.detectedDpi) && analysis.detectedDpi !== null && (
        <div className="pp-import-warning"><PaperProfileIcon name="warning" /> {t('page.paperProfiles.importWarningLowDpi')
          .replace('{detected}', String(analysis.detectedDpi)).replace('{suggested}', String(analysis.suggestedDpi))}</div>
      )}
      <div className="pp-import-form">
        <label>{t('page.paperProfiles.nameLabel')} *<input className="pp-input" value={draft.name}
          onChange={(event) => patch('name', event.target.value)} /></label>
        <label>{t('page.paperProfiles.codeLabel')} *<input className="pp-input" value={draft.code}
          onChange={(event) => patch('code', event.target.value)} /></label>
        <div className="pp-form-grid pp-form-grid--two">
          <ImportNumber label={`${t('page.paperProfiles.width')} (mm)`} value={draft.widthMm} onChange={(value) => patch('widthMm', value)} />
          <ImportNumber label={`${t('page.paperProfiles.height')} (mm)`} value={draft.heightMm} onChange={(value) => patch('heightMm', value)} />
        </div>
        <ImportNumber label={t('page.paperProfiles.dpi')} value={draft.dpi} onChange={(value) => patch('dpi', value)} />
        <label>{t('page.paperProfiles.importFitMode')}
          <select value={controller.fitMode} className="pp-select"
            onChange={(event) => controller.setFitMode(event.target.value as ImportFitMode)}>
            <option value="contain">{t('page.paperProfiles.importFitContain')}</option>
            <option value="cover">{t('page.paperProfiles.importFitCover')}</option>
            <option value="stretch">{t('page.paperProfiles.importFitStretch')}</option>
          </select>
        </label>
      </div>
      {draftErrors.length > 0 && <div className="pp-import-error">{draftErrors.map((issue) => t(issue.messageKey)).join('; ')}</div>}
      <div className="pp-import-actions">
        <button type="button" className="ds-btn ds-btn--ghost" onClick={controller.reset}>{t('page.paperProfiles.importBack')}</button>
        <button type="button" className="pp-save-button" onClick={() => void controller.submit()}
          disabled={draftErrors.length > 0}>{t('page.paperProfiles.importButton')}</button>
      </div>
    </div>
  );
}

function ImportNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>{label}<input type="number" className="pp-input" value={value}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (!Number.isNaN(next)) onChange(next);
      }} /></label>
  );
}
