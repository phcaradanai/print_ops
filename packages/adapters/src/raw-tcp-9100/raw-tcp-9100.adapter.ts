import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';

/**
 * Raw TCP port 9100 adapter for direct-to-printer communication.
 * Used by ZPL/TSPL label printers (Zebra, POSTEK, etc.) that accept raw data on port 9100.
 * Skeleton — wire up node:net Socket in the real implementation.
 */
export class RawTcp9100Adapter implements PrinterAdapterPort {
  readonly protocol = 'raw_tcp_9100';
  readonly adapterName = 'RawTcp9100Adapter';

  /** connectionUri format: tcp://<host>:<port>  e.g. tcp://192.168.1.50:9100 */
  private parseUri(uri: string): { host: string; port: number } {
    const url = new URL(uri);
    return { host: url.hostname, port: Number(url.port) || 9100 };
  }

  async detect(connectionUri: string): Promise<boolean> {
    // TODO: open a TCP connection and close immediately to verify reachability
    const { host, port } = this.parseUri(connectionUri);
    void host; void port;
    throw new Error(`RawTcp9100Adapter.detect: not yet implemented (${connectionUri})`);
  }

  async getStatus(connectionUri: string): Promise<PrinterStatus> {
    // TODO: for SNMP-capable printers, query status separately; TCP-only printers have no status channel
    throw new Error(`RawTcp9100Adapter.getStatus: not yet implemented (${connectionUri})`);
  }

  async getCapabilities(_uri: string): Promise<PrinterCapability> {
    return {
      colorSupported: false,
      duplexSupported: false,
      maxPageWidth: 104,
      maxPageHeight: 9999,
      supportedMediaTypes: ['label'],
      supportedResolutions: ['203dpi', '300dpi', '600dpi'],
      maxCopies: 9999,
    };
  }

  async executeCommand(cmd: PrintCommand): Promise<PrinterAdapterResult> {
    // TODO: open TCP socket, send raw ZPL/TSPL data, close socket
    // const { host, port } = this.parseUri(cmd.metadata['connectionUri'] as string ?? 'tcp://localhost:9100');
    void cmd;
    throw new Error('RawTcp9100Adapter.executeCommand: not yet implemented');
  }

  async printTestPage(_uri: string, printerId: string): Promise<PrinterAdapterResult> {
    // TODO: send a minimal ZPL test label
    throw new Error(`RawTcp9100Adapter.printTestPage: not yet implemented (${printerId})`);
  }

  async listQueue(_uri: string): Promise<QueueEntry[]> {
    return [];
  }

  async cancelJob(_uri: string, jobId: string): Promise<PrinterAdapterResult> {
    // Raw TCP has no cancel — job is already in printer buffer once sent
    return { success: false, jobId, message: 'Raw TCP 9100 does not support job cancellation after submission' };
  }
}
