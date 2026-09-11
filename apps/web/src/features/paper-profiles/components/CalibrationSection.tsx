import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../api/client.js';
import { errorMessage } from '../../../api/errors.js';
import { useHasPermission } from '../../../api/session.js';
import { Button, FormField, Grid, Input, Select } from '../../../components/ui/index.js';
import {
  createPrinterCalibration,
  listPrinterCalibrations,
  printCalibrationPattern,
  updatePrinterCalibration,
  type PrinterCalibration,
} from '../api/printerCalibrationApi.js';
import type { PaperProfile } from '../model/types.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';
import { Section } from './editorPrimitives.js';

interface PrinterOption {
  id: string;
  code: string;
  name: string;
}

function asInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function CalibrationSection({
  profiles,
  defaultProfileId,
  anchorRef,
  t,
}: {
  profiles: PaperProfile[];
  defaultProfileId: string | null;
  anchorRef: React.RefObject<HTMLDivElement>;
  t: Translate;
}) {
  const canSaveCalibration = useHasPermission('printer:update');
  const canPrintCalibration = useHasPermission('sandbox:send-test-print');
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [printerId, setPrinterId] = useState('');
  const [profileId, setProfileId] = useState(defaultProfileId ?? '');
  const [calibration, setCalibration] = useState<PrinterCalibration | null>(null);
  const [xOffsetDots, setXOffsetDots] = useState('0');
  const [yOffsetDots, setYOffsetDots] = useState('0');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === profileId), [profiles, profileId]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PrinterOption[]>('/printers')
      .then((result) => {
        if (cancelled) return;
        setPrinters(result ?? []);
        if (!printerId && result?.[0]) setPrinterId(result[0].id);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFeedback({ tone: 'error', text: errorMessage(error, t('page.paperProfiles.calibrationLoadFailed')) });
      });
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => {
    setProfileId(defaultProfileId ?? (profiles[0]?.id ?? ''));
  }, [defaultProfileId, profiles]);

  useEffect(() => {
    if (!printerId || !selectedProfile) {
      setCalibration(null);
      setXOffsetDots('0');
      setYOffsetDots('0');
      return;
    }
    let cancelled = false;
    setLoading(true);
    listPrinterCalibrations({ printerId, paperProfileId: selectedProfile.id, dpi: selectedProfile.dpi })
      .then((items) => {
        if (cancelled) return;
        const current = items[0] ?? null;
        setCalibration(current);
        setXOffsetDots(String(current?.xOffsetDots ?? 0));
        setYOffsetDots(String(current?.yOffsetDots ?? 0));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFeedback({ tone: 'error', text: errorMessage(error, t('page.paperProfiles.calibrationLoadFailed')) });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [printerId, selectedProfile, t]);

  const payload = selectedProfile && printerId ? {
    printerId,
    paperProfileId: selectedProfile.id,
    dpi: selectedProfile.dpi,
    xOffsetDots: asInteger(xOffsetDots, 0),
    yOffsetDots: asInteger(yOffsetDots, 0),
  } : null;

  const save = async () => {
    if (!payload || !canSaveCalibration || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = calibration
        ? await updatePrinterCalibration(calibration.id, {
            xOffsetDots: payload.xOffsetDots,
            yOffsetDots: payload.yOffsetDots,
          })
        : await createPrinterCalibration(payload);
      setCalibration(result);
      setXOffsetDots(String(result.xOffsetDots));
      setYOffsetDots(String(result.yOffsetDots));
      setFeedback({ tone: 'success', text: t('page.paperProfiles.calibrationSaved') });
    } catch (error: unknown) {
      setFeedback({ tone: 'error', text: errorMessage(error, t('page.paperProfiles.calibrationSaveFailed')) });
    } finally {
      setSaving(false);
    }
  };

  const printPattern = async () => {
    if (!payload || !canPrintCalibration || printing) return;
    setPrinting(true);
    setFeedback(null);
    try {
      const result = await printCalibrationPattern(payload);
      setFeedback({
        tone: 'success',
        text: t('page.paperProfiles.calibrationPrintQueued') + (result.jobId ? ' (' + result.jobId + ')' : ''),
      });
    } catch (error: unknown) {
      setFeedback({ tone: 'error', text: errorMessage(error, t('page.paperProfiles.calibrationPrintFailed')) });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div ref={anchorRef} className="pp-section-anchor">
      <Section title={t('page.paperProfiles.calibrationTitle')} icon={<PaperProfileIcon name="dimensions" />} open>
        <div className="pp-calibration-copy">{t('page.paperProfiles.calibrationHint')}</div>
        <Grid columns={2} gap="md">
          <FormField label={t('page.paperProfiles.calibrationPrinter')}>
            {(control) => (
              <Select {...control} value={printerId} onChange={(event) => setPrinterId(event.target.value)}>
                <option value="">{t('page.paperProfiles.calibrationSelectPrinter')}</option>
                {printers.map((printer) => (
                  <option key={printer.id} value={printer.id}>{printer.name || printer.code}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('page.paperProfiles.calibrationProfile')}>
            {(control) => (
              <Select {...control} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                <option value="">{t('page.paperProfiles.calibrationSelectProfile')}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name} ({profile.dpi} dpi)</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('page.paperProfiles.xOffsetDots')}>
            {(control) => (
              <Input {...control} type="number" step="1" value={xOffsetDots}
                onChange={(event) => setXOffsetDots(event.target.value.replace(/[^-0-9]/g, ''))}
                disabled={!canSaveCalibration || !payload} />
            )}
          </FormField>
          <FormField label={t('page.paperProfiles.yOffsetDots')}>
            {(control) => (
              <Input {...control} type="number" step="1" value={yOffsetDots}
                onChange={(event) => setYOffsetDots(event.target.value.replace(/[^-0-9]/g, ''))}
                disabled={!canSaveCalibration || !payload} />
            )}
          </FormField>
        </Grid>
        {loading && <div className="pp-calibration-status" role="status">{t('page.paperProfiles.calibrationLoading')}</div>}
        {!canSaveCalibration && <div className="pp-calibration-status" role="note">{t('page.paperProfiles.calibrationPermission')}</div>}
        {feedback && <div className="pp-calibration-status" role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.text}</div>}
        <div className="pp-calibration-actions">
          <Button variant="secondary" onClick={save} busy={saving} disabled={!payload || !canSaveCalibration}>
            {t('page.paperProfiles.calibrationSave')}
          </Button>
          <Button variant="primary" onClick={printPattern} busy={printing} disabled={!payload || !canPrintCalibration}>
            {t('page.paperProfiles.calibrationPrint')}
          </Button>
        </div>
      </Section>
    </div>
  );
}
