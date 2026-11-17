import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '../api/session.js';
import type { SessionUser } from '../api/client.js';
import { LocaleProvider } from '../i18n/index.js';
import { t } from '../i18n/translations.js';

const { rows } = vi.hoisted(() => ({
  rows: [
    {
      id: 'runner-a', name: 'runner-a', hostname: 'host-a', status: 'online',
      supportedProtocols: ['fake'], registeredAt: '2026-11-17T00:00:00.000Z', metadata: {},
    },
    {
      id: 'runner-b', name: 'runner-b', hostname: 'host-b', status: 'online',
      supportedProtocols: ['fake'], registeredAt: '2026-11-17T00:00:00.000Z', metadata: {},
    },
    {
      id: 'runner-c', name: 'runner-c', hostname: 'host-c', status: 'offline',
      supportedProtocols: ['fake'], registeredAt: '2026-11-17T00:00:00.000Z',
      metadata: { terminated: true },
    },
  ] as Array<Record<string, unknown>>,
}));

let activeRows: Array<Record<string, unknown>> = rows;

vi.mock('../hooks/useApiResource.js', () => ({
  useApiResource: () => ({
    data: activeRows,
    error: null,
    loading: false,
    refreshing: false,
    stale: false,
    paused: false,
    lastSuccessAt: null,
    refresh: () => {},
    setPollingEnabled: () => {},
  }),
}));

const { default: Runners } = await import('../pages/Runners.js');

const OWNER: SessionUser = {
  id: 'u-owner', email: 'owner@printerops.local', name: 'Owner', role: 'OWNER',
};

const th = (key: string) => t('th', key);

function render(): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <SessionProvider user={OWNER}>
        <Runners />
      </SessionProvider>
    </LocaleProvider>,
  );
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Markup of the one table row that mentions this runner, header rows excluded. */
function rowHtml(html: string, name: string): string {
  return html
    .split('<tr')
    .filter((segment) => segment.includes(name))
    .join('<tr');
}

describe('Runners page terminate/delete actions', () => {
  it('offers terminate and delete per row, but not terminate for a terminated runner', () => {
    activeRows = rows;
    const html = render();

    expect(html).toContain(th('page.runners.actions'));

    const usable = rowHtml(html, 'runner-a');
    expect(usable).toContain(th('page.runners.terminate'));
    expect(usable).toContain(th('page.runners.delete'));

    const tombstone = rowHtml(html, 'runner-c');
    expect(tombstone).toContain(th('page.runners.terminated'));
    expect(tombstone).not.toContain(th('page.runners.terminate'));
    expect(tombstone).toContain(th('page.runners.delete'));

    // Two usable runners keep every control enabled.
    expect(html).not.toContain(th('page.runners.lastRunnerBlocked'));
    expect(html).not.toContain('disabled=""');
  });

  it('disables removal with a reason when only one runner can still receive work', () => {
    activeRows = [rows[0]!, rows[2]!];
    const html = render();

    const lastUsable = rowHtml(html, 'runner-a');
    expect(lastUsable).toContain(th('page.runners.lastRunnerBlocked'));
    expect(lastUsable).toContain('disabled=""');
    // The terminated tombstone stays deletable so the host can register again.
    expect(rowHtml(html, 'runner-c')).toContain(th('page.runners.delete'));
  });
});
