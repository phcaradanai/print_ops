import { apiFetch } from '../../../api/client.js';

export interface PrinterCalibration {
  id: string;
  printerId: string;
  paperProfileId: string;
  dpi: number;
  xOffsetDots: number;
  yOffsetDots: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PrinterCalibrationPayload {
  printerId: string;
  paperProfileId: string;
  dpi: number;
  xOffsetDots: number;
  yOffsetDots: number;
}

export interface CalibrationPrintResult { id?: string; jobId?: string; status?: string; }

export function listPrinterCalibrations(query: { printerId: string; paperProfileId: string; dpi: number }): Promise<PrinterCalibration[]> {
  const params = new URLSearchParams({ printerId: query.printerId, paperProfileId: query.paperProfileId, dpi: String(query.dpi) });
  return apiFetch<PrinterCalibration[]>('/v1/printer-calibrations?' + params.toString()) as Promise<PrinterCalibration[]>;
}

export function createPrinterCalibration(payload: PrinterCalibrationPayload): Promise<PrinterCalibration> {
  return apiFetch<PrinterCalibration>('/v1/printer-calibrations', { method: 'POST', body: JSON.stringify(payload) }) as Promise<PrinterCalibration>;
}

export function updatePrinterCalibration(id: string, payload: Pick<PrinterCalibrationPayload, 'xOffsetDots' | 'yOffsetDots'>): Promise<PrinterCalibration> {
  return apiFetch<PrinterCalibration>('/v1/printer-calibrations/' + id, { method: 'PUT', body: JSON.stringify(payload) }) as Promise<PrinterCalibration>;
}

export function printCalibrationPattern(payload: PrinterCalibrationPayload): Promise<CalibrationPrintResult> {
  return apiFetch<CalibrationPrintResult>('/v1/printer-calibrations/test-print', { method: 'POST', body: JSON.stringify(payload) }) as Promise<CalibrationPrintResult>;
}
