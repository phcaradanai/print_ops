export interface PrinterPaperCalibration {
  id: string;
  printerId: string;
  paperProfileId: string;
  dpi: number;
  xOffsetDots: number;
  yOffsetDots: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CreatePrinterPaperCalibrationInput = Omit<
  PrinterPaperCalibration,
  'id' | 'createdAt' | 'updatedAt'
>;

export type UpdatePrinterPaperCalibrationInput = Pick<
  PrinterPaperCalibration,
  'xOffsetDots' | 'yOffsetDots'
>;
