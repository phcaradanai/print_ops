import type {
  PaperProfileRepositoryPort,
  PrinterTemplateBindingRepositoryPort,
  PrintTemplateRepositoryPort,
} from '@printerops/domain';
import { NotFoundError } from '@printerops/shared';

export interface ResolvedBinding {
  printerCode: string;
  templateCode: string;
  paperProfileId: string;
  paperProfileCode: string;
}

/**
 * ResolvePrinterBindingService turns a (template_code, paper_profile_code) pair
 * into a concrete printer_code using the PrinterTemplateBinding table.
 *
 * This is the resolver behind the dynamic endpoint
 * `POST /api/v1/printer/:code_template/:code_profile` and the NATS print-intake
 * consumer. Both transports resolve the printer the same way so job creation
 * (idempotency, trace, audit) stays identical.
 *
 * Resolution rule:
 *   1. paper profile code -> paper profile id (404 if unknown).
 *   2. bindings for template_code, kept only when enabled and matching the
 *      resolved paper profile id.
 *   3. prefer the isDefault binding, else the first enabled match.
 */
export class ResolvePrinterBindingService {
  constructor(
    private readonly papers: PaperProfileRepositoryPort,
    private readonly bindings: PrinterTemplateBindingRepositoryPort,
    private readonly templates: PrintTemplateRepositoryPort,
  ) {}

  async resolve(codeTemplate: string, codeProfile: string): Promise<ResolvedBinding> {
    const templateCode = (codeTemplate ?? '').trim();
    const paperProfileCode = (codeProfile ?? '').trim();
    if (!templateCode) throw new NotFoundError('template', 'empty');
    if (!paperProfileCode) throw new NotFoundError('paper_profile', 'empty');

    // A template code that does not exist is a caller error, not a 500.
    const template = await this.templates.findByCode(templateCode);
    if (!template) throw new NotFoundError('template', templateCode);

    const paper = await this.papers.findByCode(paperProfileCode);
    if (!paper) throw new NotFoundError('paper_profile', paperProfileCode);

    const candidates = (await this.bindings.findAll({ templateCode })).filter(
      (b) => b.enabled && b.paperProfileId === paper.id,
    );
    if (candidates.length === 0) {
      throw new NotFoundError(
        'printer_binding',
        `template=${templateCode} profile=${paperProfileCode}`,
      );
    }

    const chosen = candidates.find((b) => b.isDefault) ?? candidates[0]!;
    return {
      printerCode: chosen.printerCode,
      templateCode,
      paperProfileId: paper.id,
      paperProfileCode,
    };
  }
}
