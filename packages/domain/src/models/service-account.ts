export interface ServiceAccount {
  id: string;
  name: string;
  sourceSystem: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  isActive: boolean;
  allowedPrinterCodes: string[];
  allowedTemplateCodes: string[];
  maxCopiesPerJob: number;
  maxPayloadBytes: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateServiceAccountInput = Omit<
  ServiceAccount,
  'id' | 'createdAt' | 'updatedAt'
>;
