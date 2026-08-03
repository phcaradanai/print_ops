import type { PaperProfile, PrintTemplate, TemplatePreview } from '../models/template.js';

export interface TemplateRendererPort {
  renderPreview(
    template: PrintTemplate,
    payload: Record<string, unknown>,
    paperProfile: PaperProfile
  ): Promise<TemplatePreview>;
  renderPrintPayload(
    template: PrintTemplate,
    payload: Record<string, unknown>,
    paperProfile: PaperProfile
  ): Promise<{ renderedPrintPayload: string; warnings: string[]; renderTimeMs: number }>;
  validateTemplate(template: PrintTemplate): Promise<{ valid: boolean; warnings: string[] }>;
  compileTemplate(template: PrintTemplate): Promise<void>;
}
