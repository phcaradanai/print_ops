import type { ReactNode } from 'react';
import { qrQuietZoneMm, renderBarcodeSvg, type BarcodeKind, type BarcodeSymbology } from '../../../lib/barcode.js';
import type { PaperProfileOption, SampleMode } from '../model/types.js';

export const ENGINES = ['RAW_TEXT', 'ZPL', 'HTML', 'JSON_LAYOUT', 'TSPL', 'EPL', 'PDF_LIKE_PREVIEW'] as const;

export type TemplateIconName =
  | 'back' | 'barcode' | 'braces' | 'check' | 'close' | 'code' | 'delete'
  | 'duplicate' | 'edit' | 'expand' | 'label' | 'more'
  | 'next' | 'pdf' | 'plus' | 'preview' | 'printer' | 'qrcode' | 'refresh'
  | 'save' | 'search' | 'sortAsc' | 'sortDesc' | 'terminal' | 'text';

export const ENGINE_ICON: Record<typeof ENGINES[number], TemplateIconName> = {
  RAW_TEXT: 'text',
  ZPL: 'label',
  HTML: 'code',
  JSON_LAYOUT: 'braces',
  TSPL: 'printer',
  EPL: 'terminal',
  PDF_LIKE_PREVIEW: 'pdf',
};

const DEFAULT_BARCODE_HEIGHT_MM = 12;
const DEFAULT_QR_SIZE_MM = 20;
const COMBINED_PREVIEW_PATTERN = /\{\{\s*(?:(barcode|qrcode)\s*:\s*([a-zA-Z0-9_.-]+)|([a-zA-Z0-9_.-]+))\s*\}\}/g;

export function placeholdersOf(content: string): string[] {
  return Array.from(new Set(
    Array.from(content.matchAll(COMBINED_PREVIEW_PATTERN))
      .map((match) => match[2] ?? match[3] ?? '')
      .filter(Boolean),
  ));
}

function defaultSampleFor(key: string): string {
  const now = new Date();
  switch (key) {
    case 'label': return 'TEST Sample Label';
    case 'barcode': return '123456789012';
    case 'date': return now.toLocaleDateString();
    case 'time': return now.toLocaleTimeString();
    case 'seq': return '0001';
    case 'hn_masked': return 'HN***';
    default: return key.toUpperCase();
  }
}

export function buildSample(
  mode: SampleMode,
  content: string,
  profile?: PaperProfileOption,
): Record<string, unknown> {
  if (mode === 'empty') return {};
  const payload: Record<string, unknown> = {};
  if (mode === 'profile') {
    if (!profile) return {};
    for (const field of profile.fields ?? []) {
      if (field.key) payload[field.key] = field.defaultValue ?? field.label ?? field.key;
    }
    return payload;
  }
  for (const key of placeholdersOf(content)) payload[key] = defaultSampleFor(key);
  for (const extra of ['label', 'barcode', 'date', 'time', 'seq', 'hn_masked']) {
    if (!(extra in payload)) payload[extra] = defaultSampleFor(extra);
  }
  return payload;
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function localPreview(
  content: string,
  engine: string,
  sample: Record<string, unknown>,
  profile?: PaperProfileOption,
): string {
  function resolveToken(explicitKind: BarcodeKind | undefined, key: string): { html: string; raw: boolean } {
    const field = profile?.fields.find((f) => f.key === key);
    const kind = explicitKind ?? (field?.type === 'barcode' || field?.type === 'qrcode' ? field.type : undefined);
    const value = sample[key];
    if (kind) {
      if (value == null) return { html: `[${kind}: ${key}]`, raw: false };
      const svg = renderBarcodeSvg(String(value), kind, field?.barcodeSymbology);
      if (svg) {
        const heightMm = kind === 'qrcode' ? (field?.qrSizeMm ?? DEFAULT_QR_SIZE_MM) : (field?.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM);
        const widthCss = kind === 'qrcode' ? `${heightMm}mm` : 'auto';
        const quietMm = kind === 'qrcode' ? (qrQuietZoneMm(String(value), heightMm) ?? 0) : 0;
        const sizedSvg = svg.replace('<svg ', `<svg style="height:100%;width:${kind === 'qrcode' ? '100%' : 'auto'}" `);
        return {
          html: `<span class="tpl-preview-barcode" style="display:inline-block;height:${heightMm}mm;width:${widthCss};padding:${quietMm}mm;background:#fff;line-height:0;vertical-align:middle">${sizedSvg}</span>`,
          raw: true,
        };
      }
      return { html: `[${kind}: ${String(value)}]`, raw: false };
    }
    return { html: value == null ? '' : String(value), raw: false };
  }

  if (engine === 'HTML') {
    return content.replace(COMBINED_PREVIEW_PATTERN, (_raw, kind: BarcodeKind | undefined, explicitKey: string | undefined, plainKey: string | undefined) =>
      resolveToken(kind, (explicitKey ?? plainKey)!).html,
    );
  }

  let out = '';
  let lastIndex = 0;
  for (const m of content.matchAll(COMBINED_PREVIEW_PATTERN)) {
    const idx = m.index ?? 0;
    out += escapeHtml(content.slice(lastIndex, idx));
    const key = (m[2] ?? m[3])!;
    const { html, raw } = resolveToken(m[1] as BarcodeKind | undefined, key);
    out += raw ? html : escapeHtml(html);
    lastIndex = idx + m[0].length;
  }
  out += escapeHtml(content.slice(lastIndex));
  return `<pre class="tpl-preview-raw">${out}</pre>`;
}
