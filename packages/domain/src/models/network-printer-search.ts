export type NetworkPrinterSearchState = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export interface NetworkPrinterSearch {
  id: string;
  runnerId: string;
  targets: string[];
  state: NetworkPrinterSearchState;
  createdAt: Date;
  expiresAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  claimToken?: string;
  addresses: string[];
}
