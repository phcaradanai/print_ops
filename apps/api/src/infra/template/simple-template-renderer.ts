import type {
  PaperProfile,
  PrintTemplate,
  TemplatePreview,
  TemplateRendererPort,
  BarcodeSymbology,
} from '@printerops/domain';
import { renderBarcodeDataUri } from './barcode-renderer.js';

type CompiledTemplate = {
  fields: string[];
  content: string;
};

/** Plain `{{field}}` substitution — unchanged from before barcode/QR support. */
const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/**
 * Matches EITHER an explicit `{{barcode:key}}` / `{{qrcode:key}}` (optionally
 * `{{barcode:key:symbology}}`) token, OR a plain `{{key}}` token — in a single
 * pass, so replacement order and literal text in between are preserved
 * correctly. Capture groups: [1]=kind (explicit form only), [2]=key (explicit
 * form only), [3]=symbology (explicit form only), [4]=key (plain form only).
 */
const COMBINED_PATTERN =
  /\{\{\s*(?:(barcode|qrcode)\s*:\s*([a-zA-Z0-9_.-]+)(?:\s*:\s*([a-zA-Z0-9_-]+))?|([a-zA-Z0-9_.-]+))\s*\}\}/g;

interface BarcodeToken {
  /** The exact `{{...}}` text matched — used as the cache key. */
  raw: string;
  kind: 'barcode' | 'qrcode';
  key: string;
  symbology?: BarcodeSymbology;
  /** Bar height in mm, inherited from the matching paper-profile field (see
   *  `findBarcodeTokens`). Only meaningful for kind === 'barcode'. */
  heightMm?: number;
  /** Side length in mm, inherited from the matching paper-profile field. Only
   *  meaningful for kind === 'qrcode'. */
  sizeMm?: number;
}

function extractFields(content: string): string[] {
  return Array.from(new Set(Array.from(content.matchAll(FIELD_PATTERN)).map((m) => m[1] ?? '')));
}

function valueAt(payload: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, payload);
}

function renderContent(content: string, payload: Record<string, unknown>): { rendered: string; warnings: string[] } {
  const warnings: string[] = [];
  const rendered = content.replace(FIELD_PATTERN, (_raw, field: string) => {
    const value = valueAt(payload, field);
    if (value == null) {
      warnings.push(`Missing field: ${field}`);
      return '';
    }
    return String(value);
  });
  return { rendered, warnings };
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Finds every barcode/QR token in `content` — both the explicit
 * `{{barcode:key}}` / `{{qrcode:key}}` syntax, and any plain `{{key}}` whose
 * key matches a field on the bound paper profile that is typed 'barcode' or
 * 'qrcode' (so a profile field you've already marked as a barcode "just
 * works" without rewriting the template).
 */
function findBarcodeTokens(content: string, paperProfile?: PaperProfile): Map<string, BarcodeToken> {
  const tokens = new Map<string, BarcodeToken>();
  for (const m of content.matchAll(COMBINED_PATTERN)) {
    const raw = m[0];
    if (tokens.has(raw)) continue;
    const [, kind, explicitKey, symbology, plainKey] = m;
    if (kind && explicitKey) {
      // An explicit {{barcode:key}} / {{qrcode:key}} token doesn't have to
      // name a paper-profile field at all (it can target any payload key),
      // but when a profile field of the same key exists, inherit its
      // configured real-world size so the template stays consistent with
      // whatever the operator set up visually in the paper profile editor.
      const matchingField = paperProfile?.fields.find((f) => f.key === explicitKey);
      tokens.set(raw, {
        raw,
        kind: kind as 'barcode' | 'qrcode',
        key: explicitKey,
        symbology: (symbology as BarcodeSymbology | undefined) ?? matchingField?.barcodeSymbology,
        heightMm: matchingField?.barcodeHeightMm,
        sizeMm: matchingField?.qrSizeMm,
      });
      continue;
    }
    if (plainKey && paperProfile?.fields) {
      const field = paperProfile.fields.find((f) => f.key === plainKey);
      if (field && (field.type === 'barcode' || field.type === 'qrcode')) {
        tokens.set(raw, {
          raw,
          kind: field.type,
          key: plainKey,
          symbology: field.barcodeSymbology,
          heightMm: field.barcodeHeightMm,
          sizeMm: field.qrSizeMm,
        });
      }
    }
  }
  return tokens;
}

/** Renders every distinct barcode token's image up front (barcode rendering
 * is async; the synchronous replace pass that follows just looks these up). */
async function resolveBarcodeImages(
  tokens: Map<string, BarcodeToken>,
  payload: Record<string, unknown>,
): Promise<Map<string, { dataUri?: string; warning?: string }>> {
  const results = new Map<string, { dataUri?: string; warning?: string }>();
  await Promise.all(
    Array.from(tokens.values()).map(async (tok) => {
      const value = valueAt(payload, tok.key);
      if (value == null || value === '') {
        results.set(tok.raw, { warning: `Missing field: ${tok.key}` });
        return;
      }
      try {
        const dataUri = await renderBarcodeDataUri(String(value), tok.kind, tok.symbology, {
          heightMm: tok.heightMm,
          qrSizeMm: tok.sizeMm,
        });
        results.set(tok.raw, { dataUri });
      } catch (err) {
        results.set(tok.raw, {
          warning: `Could not render ${tok.kind} for '${tok.key}': ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
  );
  return results;
}

/** Native ZPL command for a barcode/QR token. No `^FO` positioning is
 * emitted — exactly like every other ZPL field, the author positions it with
 * their own preceding `^FO x,y`, so `^FO50,50{{barcode:hn}}` works as written.
 * NOTE: unlike the HTML/preview image path, this does NOT yet honor the
 * field's configured barcodeHeightMm/qrSizeMm — ^BC height and ^BQ
 * magnification are fixed. The preview accurately reflects the configured
 * mm size; a ZPL label may print at a different (fixed) size until this is
 * wired up to convert mm -> dots using the paper profile's DPI. */
function zplBarcodeCommand(kind: 'barcode' | 'qrcode', value: string): string {
  const escaped = value.replace(/\^/g, '\\^').replace(/~/g, '\\~');
  if (kind === 'qrcode') return `^BQN,2,5^FDMM,A${escaped}^FS`;
  // ^BC (Code 128) is the one 1D symbology every ZPL-capable printer supports
  // out of the box; other symbologies chosen on the paper-profile field are
  // still honoured in the preview image, just not in the native ZPL command.
  return `^BCN,60,Y,N,N^FD${escaped}^FS`;
}

/**
 * Renders the `<img>` tag with an explicit CSS size in real millimeters, so
 * the barcode/QR prints (and previews) at the physical size the operator
 * configured on the paper-profile field — not at whatever arbitrary raster
 * pixel count bwip-js happened to produce. QR is square (width = height);
 * 1D barcodes only constrain height and let width follow the data's natural
 * aspect ratio (forcing a width would squash/stretch the bars unreadably).
 */
function imgTag(dataUri: string, kind: 'barcode' | 'qrcode', sizeMm?: { heightMm?: number; sizeMm?: number }): string {
  const heightMm = kind === 'qrcode' ? (sizeMm?.sizeMm ?? 20) : (sizeMm?.heightMm ?? 12);
  const widthCss = kind === 'qrcode' ? `${heightMm}mm` : 'auto';
  return `<img src="${dataUri}" alt="${kind}" style="display:inline-block;vertical-align:middle;height:${heightMm}mm;width:${widthCss};max-width:100%" />`;
}

export class SimpleTemplateRenderer implements TemplateRendererPort {
  private cache = new Map<string, CompiledTemplate>();

  async compileTemplate(template: PrintTemplate): Promise<void> {
    const key = `${template.templateCode}:${template.version}`;
    this.cache.set(key, { fields: extractFields(template.content), content: template.content });
  }

  async validateTemplate(template: PrintTemplate): Promise<{ valid: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    if (template.content.includes('<script')) warnings.push('HTML script tags are not allowed');
    if (template.content.includes('eval(')) warnings.push('Raw JavaScript eval is not allowed');
    return { valid: warnings.length === 0, warnings };
  }

  async renderPreview(
    template: PrintTemplate,
    payload: Record<string, unknown>,
    paperProfile: PaperProfile
  ): Promise<TemplatePreview> {
    const t0 = Date.now();
    await this.compileTemplate(template);
    const print = await this.renderPrintPayload(template, payload, paperProfile);
    const renderedPreview = await this.previewMarkup(template, payload, paperProfile);
    return {
      templateCode: template.templateCode,
      paperProfile,
      samplePayload: payload,
      renderedPreview,
      renderedPrintPayload: print.renderedPrintPayload,
      warnings: print.warnings,
      renderTimeMs: Date.now() - t0,
    };
  }

  async renderPrintPayload(
    template: PrintTemplate,
    payload: Record<string, unknown>,
    paperProfile: PaperProfile,
  ): Promise<{ renderedPrintPayload: string; warnings: string[]; renderTimeMs: number }> {
    const t0 = Date.now();
    const validation = await this.validateTemplate(template);
    const warnings = [...validation.warnings];
    const tokens = findBarcodeTokens(template.content, paperProfile);

    let rendered: string;
    if (tokens.size === 0) {
      const r = renderContent(template.content, payload);
      rendered = r.rendered;
      warnings.push(...r.warnings);
    } else if (template.engine === 'HTML') {
      // HTML is genuinely rendered/printed as markup, so embedding the real
      // image IS the print output — not just a preview convenience.
      const images = await resolveBarcodeImages(tokens, payload);
      rendered = this.substituteRaw(template.content, payload, tokens, (tok) => {
        const img = images.get(tok.raw);
        if (!img?.dataUri) {
          if (img?.warning) warnings.push(img.warning);
          return '';
        }
        return imgTag(img.dataUri, tok.kind, { heightMm: tok.heightMm, sizeMm: tok.sizeMm });
      });
    } else if (template.engine === 'ZPL') {
      // Zebra printers decode ^BC/^BQ natively — emit the real command so it
      // prints as an actual scannable barcode, not the raw text value.
      rendered = this.substituteRaw(template.content, payload, tokens, (tok) => {
        const value = valueAt(payload, tok.key);
        if (value == null) {
          warnings.push(`Missing field: ${tok.key}`);
          return '';
        }
        return zplBarcodeCommand(tok.kind, String(value));
      });
    } else {
      // TSPL / EPL / RAW_TEXT / PDF_LIKE_PREVIEW / JSON_LAYOUT: substitute the
      // plain data value for barcode/qrcode tokens too (same as an ordinary
      // field). TSPL/EPL authors wrap it with their own native BARCODE
      // command exactly as they would with a plain {{field}}; RAW_TEXT/
      // JSON_LAYOUT have no barcode capability to target at all.
      rendered = this.substituteRaw(template.content, payload, tokens, (tok) => {
        const value = valueAt(payload, tok.key);
        if (value == null) {
          warnings.push(`Missing field: ${tok.key}`);
          return '';
        }
        return String(value);
      });
    }

    return { renderedPrintPayload: rendered, warnings, renderTimeMs: Date.now() - t0 };
  }

  /** Unescaped substitution used for the actual print payload (raw ZPL/TSPL/
   * text must never be HTML-entity-escaped) and for HTML-engine preview
   * (the author's own markup is intentional and must pass through as-is). */
  private substituteRaw(
    content: string,
    payload: Record<string, unknown>,
    tokens: Map<string, BarcodeToken>,
    onToken: (tok: BarcodeToken) => string,
  ): string {
    return content.replace(COMBINED_PATTERN, (raw, _kind, _explicitKey, _symbology, plainKey: string | undefined) => {
      const tok = tokens.get(raw);
      if (tok) return onToken(tok);
      const value = plainKey ? valueAt(payload, plainKey) : undefined;
      return value == null ? '' : String(value);
    });
  }

  /**
   * Builds the dashboard preview markup for a template + sample payload.
   *
   * Barcode/QR tokens ALWAYS render as a real, scannable graphic here —
   * regardless of engine — so an operator can visually verify a ZPL/TSPL
   * label's barcode before publishing, not just squint at raw command text.
   * Everything else is HTML-escaped for safe display (except for the HTML
   * engine, whose own markup is meant to render as-is, matching print mode).
   */
  private async previewMarkup(
    template: PrintTemplate,
    payload: Record<string, unknown>,
    paperProfile: PaperProfile,
  ): Promise<string> {
    const tokens = findBarcodeTokens(template.content, paperProfile);
    const images = tokens.size > 0 ? await resolveBarcodeImages(tokens, payload) : new Map<string, { dataUri?: string; warning?: string }>();

    if (template.engine === 'HTML') {
      if (tokens.size === 0) return renderContent(template.content, payload).rendered;
      return this.substituteRaw(template.content, payload, tokens, (tok) => {
        const img = images.get(tok.raw);
        return img?.dataUri ? imgTag(img.dataUri, tok.kind, { heightMm: tok.heightMm, sizeMm: tok.sizeMm }) : '';
      });
    }

    let body: string;
    if (tokens.size === 0) {
      body = escapeHtml(renderContent(template.content, payload).rendered);
    } else {
      body = '';
      let lastIndex = 0;
      for (const m of template.content.matchAll(COMBINED_PATTERN)) {
        const idx = m.index ?? 0;
        body += escapeHtml(template.content.slice(lastIndex, idx));
        const tok = tokens.get(m[0]);
        if (tok) {
          const img = images.get(tok.raw);
          body += img?.dataUri ? imgTag(img.dataUri, tok.kind, { heightMm: tok.heightMm, sizeMm: tok.sizeMm }) : `<span class="tpl-preview-missing">[${escapeHtml(tok.kind)}: ${escapeHtml(tok.key)}]</span>`;
        } else {
          const plainKey = m[4];
          const value = plainKey ? valueAt(payload, plainKey) : undefined;
          body += escapeHtml(value == null ? '' : String(value));
        }
        lastIndex = idx + m[0].length;
      }
      body += escapeHtml(template.content.slice(lastIndex));
    }

    return `<div style="width:${paperProfile.widthMm}mm;height:${paperProfile.heightMm}mm;border:1px solid #111;background:#fff;padding:4mm;font-family:monospace;white-space:pre-wrap;overflow:hidden">${body}</div>`;
  }
}
