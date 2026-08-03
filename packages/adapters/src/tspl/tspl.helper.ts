/**
 * TSPL (TSC Programming Language) helper utilities.
 * Used for TSC / POSTEK and compatible label printers.
 * Skeleton — expand with full TSPL command set.
 */

export interface TsplLabelOptions {
  widthMm: number;
  heightMm: number;
  speedMmSec?: number;
  densityPercent?: number;
  copies?: number;
}

export interface TsplTextField {
  x: number;
  y: number;
  fontName?: string;
  rotation?: 0 | 90 | 180 | 270;
  xMul?: number;
  yMul?: number;
  text: string;
}

export interface TsplBarcodeField {
  x: number;
  y: number;
  codeType?: string;
  height?: number;
  readable?: 0 | 1 | 2;
  rotation?: 0 | 90 | 180 | 270;
  data: string;
}

export class TsplBuilder {
  private lines: string[] = [];

  startLabel(opts: TsplLabelOptions): this {
    this.lines.push(`SIZE ${opts.widthMm} mm, ${opts.heightMm} mm`);
    this.lines.push(`GAP 2 mm, 0 mm`);
    this.lines.push(`SPEED ${opts.speedMmSec ?? 4}`);
    this.lines.push(`DENSITY ${opts.densityPercent ?? 8}`);
    if (opts.copies && opts.copies > 1) this.lines.push(`SET PEEL OFF`);
    this.lines.push('CLS');
    return this;
  }

  addText(field: TsplTextField): this {
    const font = field.fontName ?? '3';
    const rot = field.rotation ?? 0;
    const xm = field.xMul ?? 1;
    const ym = field.yMul ?? 1;
    this.lines.push(`TEXT ${field.x},${field.y},"${font}",${rot},${xm},${ym},"${field.text}"`);
    return this;
  }

  addBarcode(field: TsplBarcodeField): this {
    const type = field.codeType ?? '128';
    const h = field.height ?? 60;
    const readable = field.readable ?? 1;
    const rot = field.rotation ?? 0;
    this.lines.push(`BARCODE ${field.x},${field.y},"${type}",${h},${readable},${rot},2,2,"${field.data}"`);
    return this;
  }

  print(copies = 1): this {
    this.lines.push(`PRINT ${copies},1`);
    return this;
  }

  build(): string {
    return this.lines.join('\r\n');
  }
}

/** Build a minimal TSPL test label. */
export function buildTsplTestLabel(printerCode: string): string {
  return new TsplBuilder()
    .startLabel({ widthMm: 60, heightMm: 30 })
    .addText({ x: 10, y: 5, text: 'PrintOps Test' })
    .addText({ x: 10, y: 35, text: `Printer: ${printerCode}` })
    .addBarcode({ x: 10, y: 65, data: 'PRINTOPS-TEST' })
    .print(1)
    .build();
}
