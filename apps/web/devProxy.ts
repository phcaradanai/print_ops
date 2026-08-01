/**
 * Same-origin routes served by the API outside `/api/v1`.
 *
 * Vite tests this pattern against the complete URL (query string included),
 * so `?` must remain an accepted route boundary.
 */
export const LEGACY_API_PROXY_PATTERN =
  '^/(auth|health|me|jobs|printers|runners|commands|audit-logs)(/|\\?|$)';

