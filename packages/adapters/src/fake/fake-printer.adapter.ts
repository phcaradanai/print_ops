import type {
  PrinterAdapterPort,
  PrinterAdapterResult,
  QueueEntry,
  PrinterCapability,
  PrinterStatus,
  PrintCommand,
} from '@printerops/domain';

export class FakePrinterAdapter implements PrinterAdapterPort {
  readonly protocol = 'fake';
  readonly adapterName = 'FakePrinterAdapter';

  private fakeQueue: QueueEntry[] = [];
  private shouldFail: boolean;
  private latencyMs: number;

  constructor(opts: { shouldFail?: boolean; latencyMs?: number } = {}) {
    this.shouldFail = opts.shouldFail ?? false;
    this.latencyMs = opts.latencyMs ?? 50;
  }

  async detect(_connectionUri: string): Promise<boolean> {
    await this.delay();
    return true;
  }

  async getStatus(_connectionUri: string): Promise<PrinterStatus> {
    await this.delay();
    return {
      printerId: 'fake-printer',
      code: 'idle',
      message: 'Fake printer is ready',
      tonerLevels: { black: 100, cyan: 90, magenta: 85, yellow: 95 },
      paperLevels: { tray1: 100 },
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
