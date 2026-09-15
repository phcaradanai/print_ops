export type FitMode = 'contain' | 'cover' | 'stretch';

export interface ImportedDesign {
  id: string;
  paperProfileId: string;
  sha256: string;
  fileName: string;
  mimeType: string;
  fitMode: FitMode;
  dataBase64: string;
  pixelWidth: number;
  pixelHeight: number;
  detectedDpi: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateImportedDesignInput = Omit<
  ImportedDesign,
  'id' | 'createdAt' | 'updatedAt'
>;
