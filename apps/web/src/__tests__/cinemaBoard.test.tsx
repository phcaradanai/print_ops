/**
 * Server-rendered contract for the cinema board's scope-dependent branches.
 *
 * The board is a passive surface, so most of it is geometry the browser tests
 * measure; what is easy to break without noticing is the conditional content:
 * a one-station board must not print a fleet ladder, a fleet larger than the
 * panel must say how many stations it is not showing, and a board that has not
 * received its first poll must not print zeroes as if they were facts.
 *
 * `renderToStaticMarkup` runs with `document` undefined, so the component's
 * portal branch returns the board markup directly (no DOM needed).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/index.js';
import { t } from '../i18n/translations.js';
import { CinemaBoard } from '../features/control-jobs/CinemaBoard.js';
import type { CinemaStation } from '../features/control-jobs/cinemaModel.js';

function station(deviceId: string, jobs: number, connectionState = 'ONLINE'): CinemaStation {
  return {
    deviceId,
    name: deviceId.toUpperCase(),
    connectionState,
    jobs: Array.from({ length: jobs }, (_, index) => ({
      id: `${deviceId}-job-${index}`,
      status: 'SUCCESS',
      createdAt: new Date(2026, 10, 18, 9, index, 0).toISOString(),
      deviceId,
      printerId: `${deviceId}-printer`,
      printerCode: 'ZEBRA_OPD_01',
      requestId: `REQ-${deviceId.toUpperCase()}-${index}`,
      payload: { hn: `12345${index}`, patient_name: `Patient ${index}` },
    })),
  };
}

function render(
  stations: CinemaStation[],
  options: { loading?: boolean; failed?: boolean; displayFields?: string[] } = {},
): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <CinemaBoard
        stations={stations}
        jobs={stations.flatMap((entry) => entry.jobs)}
        scopeLabel="JOHN"
        displayFields={options.displayFields}
        lastSuccessAt={null}
        loading={options.loading ?? false}
        refreshing={false}
        stale={false}
        failed={options.failed ?? false}
        onExit={() => undefined}
      />
    </LocaleProvider>,
  );
}

// The provider falls back to Thai when there is no stored locale (this suite has
// no localStorage), which is also the shipped default - so the assertions use
// the dictionary rather than literal copy.
const label = (key: string) => t('th', key);

describe('CinemaBoard', () => {
  it('drops the fleet ladder when the board is scoped to one station', () => {
    const html = render([station('dev-john', 2)]);
    expect(html).not.toContain('cinema-stations');
    expect(html).not.toContain(label('control.cinema.stationsTitle'));
    // The header states the connection in words instead.
    expect(html).toContain(label('control.jobs.connectionOnline'));
  });

  it('caps the fleet ladder at four stations and states how many are hidden', () => {
    const html = render(
      ['j', 'k', 'l', 'm', 'n', 'o'].map((id, index) => station(`dev-${id}`, 6 - index)),
    );
    expect(html.match(/class="cinema-station[ "]/g) ?? []).toHaveLength(4);
    expect(html).toContain(label('control.cinema.stationsTitle'));
    expect(html).toContain(
      label('control.cinema.stationsMore').replace('{count}', '2'),
    );
  });

  it('marks offline stations in words, not only in colour', () => {
    const html = render([station('dev-off', 1, 'OFFLINE'), station('dev-on', 1)]);
    expect(html).toContain(label('control.jobs.connectionOffline'));
  });

  it('never shows zero totals before the first poll arrives', () => {
    const html = render([], { loading: true });
    expect(html).toContain(`cinema-live-label">${label('control.cinema.loading')}<`);
    expect(html).not.toContain(`cinema-live-label">${label('control.cinema.live')}<`);
    expect(html).toContain(`cinema-kpi-value">—<`);
  });

  it('exposes each total as a named group for assistive technology', () => {
    const html = render([station('dev-a', 1)]);
    for (const key of [
      'control.cinema.kpiTotal',
      'control.cinema.kpiNeedsReview',
      'control.cinema.kpiInProgress',
      'control.cinema.kpiPrinted',
      'control.cinema.kpiStations',
    ]) {
      expect(html, key).toContain(`aria-label="${label(key)}"`);
    }
    expect(html.match(/role="group"/g) ?? []).toHaveLength(5);
  });

  it('shows the chosen incoming values and keeps the reference on the row', () => {
    const html = render([station('dev-a', 1)], { displayFields: ['patient_name', 'hn'] });
    expect(html).toContain('Patient 0 · 123450');
    // The reference stays available, one step quieter.
    expect(html).toContain('cinema-feed-id');
    expect(html).toContain('REQ-DEV-A-0');
    // The feed header says which values are on the board.
    expect(html).toContain('patient_name · hn');
  });

  it('falls back to the reference when no value is chosen', () => {
    const plain = render([station('dev-a', 1)]);
    expect(plain).toContain('REQ-DEV-A-0');
    expect(plain).not.toContain('cinema-feed-label');
  });
});
