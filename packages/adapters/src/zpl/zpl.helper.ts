/**
 * ZPL (Zebra Programming Language) helper utilities.
 * Used to build ZPL II label commands for Zebra / compatible label printers.
 * Skeleton — expand with field-by-field ZPL generation.
 */

export interface ZplLabelOptions {
  width: number;
  height: number;
  dpi: number;
  copies?: number;
}

export interface ZplTextField {
  x: number;
  y: number;
  fontHeight?: number;
  text: string;
}

export interface ZplBarcodeField {
  x: number;
  y: number;
  height?: number;
  data: string;
  type?: 'code128' | 'qr' | 'code39' | 'datamatrix';
}

export class ZplBuilder {
  private commands: string[] = [];

  /** Start a ZPL label. */
  startLabel(opts: ZplLabelOptions): this {
    this.commands.push('^XA');
    this.commands.push(`^PW${opts.width}`);
    this.commands.push(`^LL${opts.height}`);
    if (opts.copies && opts.copies > 1) this.commands.push(`^PQ${opts.copies}`);
    return this;
  }

  addText(field: ZplTextField): this {
    const h = field.fontHeight ?? 30;
    this.commands.push(`^FO${field.x},${field.y}^A0N,${h},${h}^FD${this.escape(field.text)}^FS`);
    return this;
  }

  addBarcode(field: ZplBarcodeField): this {
    const h = field.height ?? 60;
    switch (field.type ?? 'code128') {
      case 'code128':
        this.commands.push(`^FO${field.x},${field.y}^BCN,${h},Y,N,N^FD${field.data}^FS`);
        break;
      case 'qr':
        this.commands.push(`^FO${field.x},${field.y}^BQN,2,5^FDMM,A${field.data}^FS`);
        break;
      default:
        this.commands.push(`^FO${field.x},${field.y}^BCN,${h},Y,N,N^FD${field.data}^FS`);
    }
    return this;
  }

  endLabel(): this {
    this.commands.push('^XZ');
    return this;
  }

  build(): string {
    return this.commands.join('\n');
  }

  private escape(text: string): string {
    return text.replace(/\^/g, '\\^').replace(/~/g, '\\~');
  }
}

/** Build a minimal ZPL test label. */
export function buildTestLabel(printerCode: string): string {
  return new ZplBuilder()
    .startLabel({ width: 400, height: 240, dpi: 203 })
    .addText({ x: 10, y: 10, fontHeight: 30, text: 'PrintOps Test Label' })
    .addText({ x: 10, y: 50, fontHeight: 25, text: `Printer: ${printerCode}` })
    .addBarcode({ x: 10, y: 100, data: 'PRINTOPS-TEST', type: 'code128' })
    .endLabel()
    .build();
}
