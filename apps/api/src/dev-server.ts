// The explicit development entrypoint restores the documented role fixtures
// for `npm run dev -w apps/api`. Production and packaged desktop launch
// `dist/server.js` directly and never pass through this file.
process.env['PRINTOPS_DEV_SEED'] ??= 'true';

await import('./server.js');

