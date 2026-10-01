import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ControlCommandProgress } from '@printerops/domain';
import { RemoteCommandProgress } from '../components/RemoteCommandProgress.js';
import { LocaleProvider } from '../i18n/index.js';

function renderProgress(progress: ControlCommandProgress, status = 'INSTALLING', commandType = 'OTA_INSTALL') {
  return renderToStaticMarkup(
    <LocaleProvider>
      <RemoteCommandProgress progress={progress} status={status} commandType={commandType} />
    </LocaleProvider>,
  );
}

describe('Remote command progress', () => {
  it('shows a labeled step percentage and denominator in an accessible progress bar', () => {
    const markup = renderProgress({
      current: 3,
      total: 4,
      percent: 75,
      mode: 'steps',
      phase: 'installing',
      item: '0.1.34',
    });

    expect(markup).toContain('กำลังอัปเดต PrintOps');
    expect(markup).toContain('กำลังติดตั้ง PrintOps');
    expect(markup).toContain('0.1.34');
    expect(markup).toContain('ขั้นตอน 3 จาก 4');
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="75"');
    expect(markup).toContain('aria-valuetext="กำลังติดตั้ง PrintOps: ขั้นตอน 3 จาก 4"');
  });

  it('uses byte totals for transfer progress and marks terminal outcomes', () => {
    const markup = renderProgress({
      current: 4_096,
      total: 8_192,
      percent: 50,
      mode: 'bytes',
      phase: 'downloading',
      item: '0.1.34',
    }, 'DOWNLOADING', 'OTA_DOWNLOAD');

    expect(markup).toContain('ดาวน์โหลดแล้ว 4.0 KB จาก 8.0 KB (50%)');
    expect(markup).toContain('remote-command-progress--running');

    const failed = renderProgress({
      current: 3,
      total: 4,
      percent: 75,
      mode: 'steps',
      phase: 'installing',
    }, 'INSTALL_FAILED');
    expect(failed).toContain('remote-command-progress--failed');

    const completed = renderProgress({
      current: 4,
      total: 4,
      percent: 100,
      mode: 'steps',
      phase: 'completed',
    }, 'COMPLETED');
    expect(completed).toContain('remote-command-progress--completed');
  });

  it('distinguishes a verified install artifact from terminal download and rollback outcomes', () => {
    const verifiedInstall = renderProgress({
      current: 2,
      total: 4,
      percent: 50,
      mode: 'steps',
      phase: 'verifying',
    }, 'VERIFIED', 'OTA_INSTALL');
    expect(verifiedInstall).toContain('remote-command-progress--running');

    const completedDownload = renderProgress({
      current: 8_192,
      total: 8_192,
      percent: 100,
      mode: 'bytes',
      phase: 'completed',
    }, 'VERIFIED', 'OTA_DOWNLOAD');
    expect(completedDownload).toContain('remote-command-progress--completed');

    const failedInstallRollback = renderProgress({
      current: 3,
      total: 4,
      percent: 75,
      mode: 'steps',
      phase: 'rolling-back',
    }, 'ROLLED_BACK', 'OTA_INSTALL');
    expect(failedInstallRollback).toContain('remote-command-progress--failed');

    const successfulRollback = renderProgress({
      current: 2,
      total: 2,
      percent: 100,
      mode: 'steps',
      phase: 'completed',
    }, 'ROLLED_BACK', 'OTA_ROLLBACK');
    expect(successfulRollback).toContain('remote-command-progress--completed');

    for (const status of ['REJECTED', 'EXPIRED']) {
      expect(renderProgress({
        current: 0,
        total: 1,
        percent: 0,
        mode: 'steps',
        phase: 'queued',
      }, status)).toContain('remote-command-progress--failed');
    }
  });
});
