import { describe, expect, it } from 'vitest';
import { LEGACY_API_PROXY_PATTERN } from '../../devProxy.js';

describe('legacy API dev proxy', () => {
  const matcher = new RegExp(LEGACY_API_PROXY_PATTERN);

  it.each([
    '/jobs',
    '/jobs/job-1',
    '/jobs?limit=500',
    '/audit-logs?limit=100&offset=0',
  ])('proxies %s to the API', (url) => {
    expect(matcher.test(url)).toBe(true);
  });

  it.each([
    '/',
    '/jobs-report',
    '/templates',
  ])('leaves the SPA route %s with Vite', (url) => {
    expect(matcher.test(url)).toBe(false);
  });
});

