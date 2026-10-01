import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RemoteCommandIndicator, type ClientControlCommandStatus } from '../App.js';
import { LocaleProvider } from '../i18n/index.js';

const NOW = Date.parse('2026-10-02T08:00:30.000Z');

function renderIndicator(command?: ClientControlCommandStatus | null) {
  return renderToStaticMarkup(
    <LocaleProvider>
      <RemoteCommandIndicator command={command} now={NOW} />
    </LocaleProvider>,
  );
}

describe('PrintOps remote command indicator', () => {
  it('keeps processing commands visible and accessible until they finish', () => {
    const markup = renderIndicator({
      commandType: 'OTA_INSTALL',
      state: 'INSTALLING',
      replayStatus: 'PROCESSING',
      updatedAt: new Date(NOW - 60_000).toISOString(),
    });

    expect(markup).toContain('client-control-command-symbol--running');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Web Control กำลังดำเนินการตามคำสั่ง');
  });

  it.each([
    ['completed', 'COMPLETED', 'client-control-command-symbol--completed', 'Web Control ดำเนินการตามคำสั่งเสร็จแล้ว'],
    ['failed', 'INSTALL_FAILED', 'client-control-command-symbol--failed', 'คำสั่งจาก Web Control ล้มเหลว'],
  ])('shows a recent %s result with its state label', (_name, state, statusClass, label) => {
    const markup = renderIndicator({
      state,
      replayStatus: 'PROCESSED',
      updatedAt: new Date(NOW - 29_999).toISOString(),
    });

    expect(markup).toContain(statusClass);
    expect(markup).toContain(label);
  });

  it('treats automatic install rollback as failure and an explicit rollback as success', () => {
    const updatedAt = new Date(NOW - 1_000).toISOString();
    const failedInstallRollback = renderIndicator({
      commandType: 'OTA_INSTALL',
      state: 'ROLLED_BACK',
      replayStatus: 'PROCESSED',
      updatedAt,
    });
    const successfulRollback = renderIndicator({
      commandType: 'OTA_ROLLBACK',
      state: 'ROLLED_BACK',
      replayStatus: 'PROCESSED',
      updatedAt,
    });

    expect(failedInstallRollback).toContain('client-control-command-symbol--failed');
    expect(failedInstallRollback).toContain('คำสั่งจาก Web Control ล้มเหลว');
    expect(successfulRollback).toContain('client-control-command-symbol--completed');
    expect(successfulRollback).toContain('Web Control ดำเนินการตามคำสั่งเสร็จแล้ว');
  });

  it('hides completed commands after the recent-result window', () => {
    expect(renderIndicator({
      state: 'COMPLETED',
      replayStatus: 'PROCESSED',
      updatedAt: new Date(NOW - 30_001).toISOString(),
    })).toBe('');
    expect(renderIndicator(null)).toBe('');
  });
});
