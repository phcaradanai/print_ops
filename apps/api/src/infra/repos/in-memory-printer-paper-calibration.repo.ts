import type {
  CreatePrinterPaperCalibrationInput,
  ListOptions,
  PrinterPaperCalibration,
  PrinterPaperCalibrationRepositoryPort,
  UpdatePrinterPaperCalibrationInput,
} from '@printerops/domain';
import { generateId } from '@printerops/shared';

function assertCalibrationOffsets(xOffsetDots: number, yOffsetDots: number): void {
  if (
    !Number.isInteger(xOffsetDots) || Math.abs(xOffsetDots) > 10000 ||
    !Number.isInteger(yOffsetDots) || Math.abs(yOffsetDots) > 10000
  ) {
    throw new Error('Calibration offsets must be whole numbers from -10000 to 10000');
  }
}

export class InMemoryPrinterPaperCalibrationRepository implements PrinterPaperCalibrationRepositoryPort {
  private store = new Map<string, PrinterPaperCalibration>();

  async findById(id: string): Promise<PrinterPaperCalibration | undefined> {
    return this.store.get(id);
  }

  async findByKey(printerId: string, paperProfileId: string, dpi: number): Promise<PrinterPaperCalibration | undefined> {
    return Array.from(this.store.values()).find((value) =>
      value.printerId === printerId && value.paperProfileId === paperProfileId && value.dpi === dpi,
    );
  }

  async findAll(opts?: ListOptions & { printerId?: string; paperProfileId?: string }): Promise<PrinterPaperCalibration[]> {
    let values = Array.from(this.store.values());
    if (opts?.printerId) values = values.filter((value) => value.printerId === opts.printerId);
    if (opts?.paperProfileId) values = values.filter((value) => value.paperProfileId === opts.paperProfileId);
    return values.slice(opts?.offset ?? 0, opts?.limit == null ? values.length : (opts.offset ?? 0) + opts.limit);
  }

  async create(input: CreatePrinterPaperCalibrationInput): Promise<PrinterPaperCalibration> {
    assertCalibrationOffsets(input.xOffsetDots, input.yOffsetDots);
    if (await this.findByKey(input.printerId, input.paperProfileId, input.dpi)) {
      throw new Error('PrinterPaperCalibration already exists for printer, paper profile, and DPI');
    }
    const now = new Date();
    const calibration = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    this.store.set(calibration.id, calibration);
    return calibration;
  }

  async update(id: string, patch: UpdatePrinterPaperCalibrationInput): Promise<PrinterPaperCalibration> {
    const current = this.store.get(id);
    if (!current) throw new Error(`PrinterPaperCalibration ${id} not found`);
    assertCalibrationOffsets(patch.xOffsetDots, patch.yOffsetDots);
    const updated = { ...current, ...patch, id, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
