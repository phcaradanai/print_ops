import { renderToStaticMarkup } from 'react-dom/server';
import webPackage from '../../package.json';
import { APP_VERSION, AppVersionBadge } from '../App.js';
import { describe, expect, it } from 'vitest';

describe('application version marker', () => {
  it('uses the web package version and exposes an accessible label', () => {
    const markup = renderToStaticMarkup(<AppVersionBadge label="Application version" />);

    expect(APP_VERSION).toBe(webPackage.version);
    expect(markup).toContain(`v${webPackage.version}`);
    expect(markup).toContain(`aria-label="Application version: ${webPackage.version}"`);
  });
});
