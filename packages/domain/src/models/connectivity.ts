/** Detailed result of a printer connectivity check. */
export interface PrinterConnectivityResult {
  /** Printer ID */
  printerId: string;
  /** Printer code */
  printerCode: string;
  /** Whether the printer was detected on the network */
  detected: boolean;
  /** Current status from the adapter (online/offline/error/busy/idle) */
  statusCode: string;
  /** Human-readable status message */
  statusMessage: string;
  /** Toner/ink levels */
  tonerLevels?: Record<string, number>;
  /** Paper tray levels */
  paperLevels?: Record<string, number>;
  /** Adapter used for detection */
  adapterUsed: string;
  /** Adapter protocol */
  protocol: string;
  /** Connection URI used */
  connectionUri: string;
  /** Error if detection/status failed */
  error?: string;
  /** Error code if detection/status failed */
  errorCode?: string;
  /** Time taken to check (ms) */
  checkTimeMs: number;
  /** When this check was performed */
  checkedAt: Date;
}

/** Summary of all printer connectivity checks */
export interface ConnectivityReport {
  reportId: string;
  checkedAt: Date;
  total: number;
  online: number;
  offline: number;
  error: number;
  /** Per-printer results */
  results: PrinterConnectivityResult[];
}
