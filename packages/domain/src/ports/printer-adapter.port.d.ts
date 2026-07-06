import type { PrintCommand, PrinterCapability, PrinterStatus } from '../models/printer.js';
export interface PrinterAdapterResult {
    success: boolean;
    jobId?: string;
    message?: string;
    errorCode?: string;
    raw?: unknown;
}
export interface QueueEntry {
    jobId: string;
    status: string;
    position: number;
    submittedAt: Date;
}
export interface PrinterAdapterPort {
    readonly protocol: string;
    readonly adapterName: string;
    detect(connectionUri: string): Promise<boolean>;
    getStatus(connectionUri: string): Promise<PrinterStatus>;
    getCapabilities(connectionUri: string): Promise<PrinterCapability>;
    executeCommand(command: PrintCommand): Promise<PrinterAdapterResult>;
    printTestPage(connectionUri: string, printerId: string): Promise<PrinterAdapterResult>;
    listQueue(connectionUri: string): Promise<QueueEntry[]>;
    cancelJob(connectionUri: string, jobId: string): Promise<PrinterAdapterResult>;
}
//# sourceMappingURL=printer-adapter.port.d.ts.map