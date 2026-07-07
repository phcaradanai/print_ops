export type DiscoveredConnectionType = 'usb' | 'tcp_ip' | 'wsd' | 'lpt_com' | 'network_share' | 'unknown';

export interface DiscoveredPrinter {
  id: string;
  runnerId: string;
  localPrinterName: string;
  driverName?: string;
  portName?: string;
  connectionType: DiscoveredConnectionType;
  isDefault: boolean;
  isShared: boolean;
  attributes: Record<string, unknown>;
  firstSeenAt: Date;
  lastSeenAt: Date;
  registeredPrinterId?: string;
}

export interface CreateDiscoveredPrinterInput {
  runnerId: string;
  localPrinterName: string;
  driverName?: string;
  portName?: string;
  connectionType: DiscoveredConnectionType;
  isDefault: boolean;
  isShared: boolean;
  attributes?: Record<string, unknown>;
}

/** Raw item sent by the runner to the API in a discovery sync */
export interface DiscoveryItem {
  localPrinterName: string;
  driverName?: string;
  portName?: string;
  connectionType: DiscoveredConnectionType;
  isDefault: boolean;
  isShared: boolean;
  attributes?: Record<string, unknown>;
}
