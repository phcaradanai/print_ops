import type { PaperProfile, PrintTemplate, TemplatePreview, TemplateRendererPort } from '@printerops/domain';

type CompiledTemplate = {
  fields: string[];
  content: string;
};

const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

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
    const renderedPreview = this.previewMarkup(template, print.renderedPrintPayload, paperProfile);
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
    _paperProfile: PaperProfile
  ): Promise<{ renderedPrintPayload: string; warnings: string[]; renderTimeMs: number }> {
    const t0 = Date.now();
    const validation = await this.validateTemplate(template);
    const rendered = renderContent(template.content, payload);
    return {
      renderedPrintPayload: rendered.rendered,
      warnings: [...validation.warnings, ...rendered.warnings],
      renderTimeMs: Date.now() - t0,
    };
  }

  private previewMarkup(template: PrintTemplate, rendered: string, paper: PaperProfile): string {
    if (template.engine === 'HTML') return rendered;
    const safe = escapeHtml(rendered);
    return `<div style="width:${paper.widthMm}mm;height:${paper.heightMm}mm;border:1px solid #111;background:#fff;padding:4mm;font-family:monospace;white-space:pre-wrap;overflow:hidden">${safe}</div>`;
  }
}
