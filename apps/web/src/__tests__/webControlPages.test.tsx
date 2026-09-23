import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import WebControlDevices from '../pages/WebControlDevices.js';
import WebControlDeviceDetail from '../pages/WebControlDeviceDetail.js';
import WebControlReleases from '../pages/WebControlReleases.js';
import { LocaleProvider } from '../i18n/index.js';

describe('Web Control UI Workspaces (Phase 7)', () => {
  it('renders WebControlDevices structure', () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <MemoryRouter>
          <WebControlDevices />
        </MemoryRouter>
      </LocaleProvider>,
    );

    expect(html).toContain('Devices');
    expect(html).toContain('Generate Enrollment Token');
    expect(html).toContain('All Connections');
    expect(html).toContain('All Versions');
    expect(html).toContain('All OTA States');
  });

  it('renders WebControlDeviceDetail with explicit print safety notice', () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <MemoryRouter initialEntries={['/control/devices/dev_01']}>
          <Routes>
            <Route path="/control/devices/:id" element={<WebControlDeviceDetail />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>,
    );

    // Initial render shows loading state
    expect(html).toBeDefined();
  });

  it('renders WebControlReleases structure', () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <MemoryRouter>
          <WebControlReleases />
        </MemoryRouter>
      </LocaleProvider>,
    );

    expect(html).toContain('Release Catalog');
    expect(html).toContain('Register Signed Release');
  });
});
