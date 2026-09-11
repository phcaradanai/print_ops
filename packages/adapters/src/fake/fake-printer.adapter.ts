import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';

export interface FakeAdapterOptions {
  /** If true, all executeCommand calls will fail */
  shouldFail?: boolean;
  /** If true, detect() returns false (printer offline) */
  shouldBeOffline?: boolean;
  /** If true, getStatus() throws an error */
  shouldStatusFail?: boolean;
  /** Simulated latency in ms */
  latencyMs?: number;
  /** Status code to return from getStatus */
  statusCode?: 'online' | 'offline' | 'error' | 'busy' | 'idle' | 'unknown';
}

export class FakePrinterAdapter implements PrinterAdapterPort {
  readonly protocol = 'fake';
  readonly adapterName = 'FakePrinterAdapter';

  private fakeQueue: QueueEntry[] = [];
  private shouldFail: boolean;
  private shouldBeOffline: boolean;
  private shouldStatusFail: boolean;
  private latencyMs: number;
  private customStatusCode: string;

  constructor(opts: FakeAdapterOptions = {}) {
    this.shouldFail = opts.shouldFail ?? false;
    this.shouldBeOffline = opts.shouldBeOffline ?? false;
    this.shouldStatusFail = opts.shouldStatusFail ?? false;
    this.latencyMs = opts.latencyMs ?? 50;
    this.customStatusCode = opts.statusCode ?? 'idle';
  }

  async detect(_connectionUri: string): Promise<boolean> {
    await this.delay();
    return !this.shouldBeOffline;
  }

  async getStatus(_connectionUri: string): Promise<PrinterStatus> {
    await this.delay();
    if (this.shouldStatusFail) {
      throw new Error('Fake adapter: status query failed');
    }
    const code = this.shouldBeOffline ? 'offline' : this.customStatusCode;
    return {
      printerId: 'fake-printer',
      code: code as PrinterStatus['code'],
      message: code === 'idle' ? 'Fake printer is ready' : `Fake printer is ${code}`,
      tonerLevels: this.shouldBeOffline ? undefined : { black: 100, cyan: 90, magenta: 85, yellow: 95 },
      paperLevels: this.shouldBeOffline ? undefined : { tray1: 100 },
      checkedAt: new Date(),
    };
  }

  async getCapabilities(_connectionUri: string): Promise<PrinterCapability> {
    await this.delay();
    return {
      colorSupported: true,
      duplexSupported: true,
      maxPageWidth: 210,
      maxPageHeight: 297,
      supportedMediaTypes: ['plain', 'glossy', 'photo'],
      supportedResolutions: ['300dpi', '600dpi', '1200dpi'],
      maxCopies: 999,
    };
  }

  async executeCommand(command: PrintCommand): Promise<PrinterAdapterResult> {
    await this.delay();
    if (this.shouldFail) {
      return {
        success: false,
        errorCode: 'FAKE_ERROR',
        message: 'Fake adapter forced failure',
      };
    }
    if (this.shouldBeOffline) {
      return {
        success: false,
        errorCode: 'PRINTER_OFFLINE',
        message: 'Fake adapter: printer is offline',
      };
    }
    const queueEntry: QueueEntry = {
      jobId: command.jobId,
      status: 'completed',
      position: 0,
      submittedAt: new Date(),
    };
    this.fakeQueue.push(queueEntry);
    return {
      success: true,
      jobId: command.jobId,
      message: `FakePrinterAdapter: job ${command.jobId} executed successfully`,
    };
  }

  async printTestPage(_connectionUri: string, printerId: string): Promise<PrinterAdapterResult> {
    await this.delay();
    if (this.shouldFail || this.shouldBeOffline) {
      return {
        success: false,
        errorCode: this.shouldBeOffline ? 'PRINTER_OFFLINE' : 'FAKE_ERROR',
        message: `FakePrinterAdapter: test page failed for printer ${printerId}`,
      };
    }
    return {
      success: true,
      message: `FakePrinterAdapter: test page printed for printer ${printerId}`,
    };
  }

  async listQueue(_connectionUri: string): Promise<QueueEntry[]> {
    await this.delay();
    return [...this.fakeQueue];
  }

  async cancelJob(_connectionUri: string, jobId: string): Promise<PrinterAdapterResult> {
    await this.delay();
    this.fakeQueue = this.fakeQueue.filter((e) => e.jobId !== jobId);
    return { success: true, jobId, message: `Job ${jobId} cancelled` };
  }

  private delay(): Promise<void> {
    return new Promise((res) => setTimeout(res, this.latencyMs));
  }
}
