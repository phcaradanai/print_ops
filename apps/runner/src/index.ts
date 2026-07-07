import { AdapterRegistry, FakePrinterAdapter } from '@printerops/adapters';
import { consoleLogger } from '@printerops/shared';
import { loadConfig } from './config.js';
import { ApiClient } from './api-client.js';
import { discoverPrinters } from './printer-discovery.js';

const config = loadConfig();
const logger = consoleLogger;
const api = new ApiClient(config);

const registry = new AdapterRegistry();
registry.registerAdapter(new FakePrinterAdapter());

logger.info('PrinterOps Runner starting', { runnerName: config.runnerName });

let runnerId: string | null = null;

async function registerWithRetry(): Promise<string> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const runner = await api.register();
      logger.info('Runner registered', { runnerId: runner.id });
      return runner.id;
    } catch {
      logger.warn(`Register attempt ${attempt} failed, retrying in 3s...`);
      await sleep(3000);
    }
  }
  throw new Error('Failed to register runner after 10 attempts');
}

async function heartbeatLoop(id: string): Promise<void> {
  while (true) {
    try {
      await api.heartbeat(id);
    } catch {
      logger.warn('Heartbeat failed', { runnerId: id });
    }
    await sleep(config.heartbeatIntervalMs);
  }
}

async function pollLoop(id: string): Promise<void> {
  while (true) {
    try {
      const job = await api.pollJob(id);
      if (job) {
        const t0 = Date.now();
        logger.info('Picked up job', { jobId: job.id, runnerId: id, traceId: job.traceId });
        const result = await api.executeJob(job.id, id);
        const ms = Date.now() - t0;
        logger.info('Job complete', {
          jobId: result.id,
          status: result.status,
          totalMs: ms,
          traceId: result.traceId,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Poll/execute error', { error: msg });
    }
    await sleep(config.pollIntervalMs);
  }
}

async function discoveryLoop(id: string): Promise<void> {
  while (true) {
    await sleep(config.discoveryIntervalMs);
    try {
      const items = await discoverPrinters(config.discoveryAdapter);
      if (items.length > 0) {
        await api.syncDiscovery(id, items);
        logger.info('Discovery sync complete', { runnerId: id, count: items.length });
      }
    } catch {
      // Discovery errors must never propagate to the print path
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Auto-login with dev credentials if no static token provided
if (!config.apiToken) {
  logger.info('No RUNNER_API_TOKEN set — logging in with dev credentials');
  await api.login();
}

runnerId = await registerWithRetry();
void heartbeatLoop(runnerId);
void pollLoop(runnerId);
void discoveryLoop(runnerId);
