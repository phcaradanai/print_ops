import type { ControlCommandProgress } from '@printerops/domain';
import { useLocale } from '../i18n/index.js';

export function RemoteCommandProgress({
  progress,
  commandType,
  status,
  compact = false,
  dark = false,
}: {
  progress?: ControlCommandProgress | null;
  commandType?: string;
  status?: string;
  compact?: boolean;
  dark?: boolean;
}) {
  const { t } = useLocale();
  if (!progress) return null;

  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const isFailed = status === 'FAILED'
    || status === 'INSTALL_FAILED'
    || status === 'HEALTH_CHECK_FAILED'
    || status === 'ROLLBACK_FAILED'
    || status === 'RECOVERY_REQUIRED'
    || status === 'REJECTED'
    || status === 'EXPIRED'
    || (status === 'ROLLED_BACK' && commandType !== 'OTA_ROLLBACK');
  const isCompleted = status === 'COMPLETED'
    || (status === 'VERIFIED' && commandType === 'OTA_DOWNLOAD')
    || (status === 'ROLLED_BACK' && commandType === 'OTA_ROLLBACK')
    || progress.phase === 'completed';
  const tone = isFailed ? 'failed' : isCompleted ? 'completed' : 'running';
  const phaseLabel = t(`control.progress.phase.${progress.phase}`);
  const actionLabel = commandType ? t(`control.progress.action.${commandType}`) : phaseLabel;
  const stepsLabel = t('control.progress.steps')
    .replace('{current}', String(progress.current))
    .replace('{total}', String(progress.total));
  const transferPercent = progress.transfer
    ? Math.max(0, Math.min(100, Math.floor((progress.transfer.currentBytes / Math.max(1, progress.transfer.totalBytes)) * 100)))
    : 0;
  const progressDetailLabel = progress.mode === 'bytes'
    ? t('control.progress.downloadedOf')
      .replace('{current}', formatBytes(progress.current))
      .replace('{total}', formatBytes(progress.total))
      .replace('{percent}', String(percent))
    : stepsLabel;
  const transferLabel = progress.transfer
    ? t('control.progress.downloadedOf')
      .replace('{current}', formatBytes(progress.transfer.currentBytes))
      .replace('{total}', formatBytes(progress.transfer.totalBytes))
      .replace('{percent}', String(transferPercent))
    : '';
  return (
    <div
      className={`remote-command-progress remote-command-progress--${tone}${compact ? ' remote-command-progress--compact' : ''}${dark ? ' remote-command-progress--dark' : ''}`}
      role="group"
      aria-label={`${actionLabel}: ${percent}%`}
      aria-live="polite"
    >
      <div className="remote-command-progress__heading">
        <span className="remote-command-progress__action">{actionLabel}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="remote-command-progress__description">
        <span>{phaseLabel}</span>
        {progress.item && <span className="remote-command-progress__item">{progress.item}</span>}
      </div>
      <progress
        role="progressbar"
        className="remote-command-progress__bar"
        value={percent}
        max={100}
        aria-label={`${phaseLabel} — ${percent}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${phaseLabel}: ${progressDetailLabel}${transferLabel ? `. ${transferLabel}` : ''}`}
      />
      <div className="remote-command-progress__detail">
        <span>{progressDetailLabel}</span>
        {progress.transfer && <span>{transferLabel}</span>}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
