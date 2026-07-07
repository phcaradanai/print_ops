import type { Runner, Job } from '@printerops/domain';
import type { RunnerConfig } from './config.js';

export class ApiClient {
  constructor(private config: RunnerConfig) {}

  async register(): Promise<Runner> {
    const res = await fetch(`${this.config.apiUrl}/runners/register`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        name: this.config.runnerName,
        hostname: this.config.hostname,
        supportedProtocols: this.config.supportedProtocols,
        metadata: {},
      }),
    });
    if (!res.ok) throw new Error(`Register failed: ${res.status}`);
    return res.json() as Promise<Runner>;
  }

  async heartbeat(runnerId: string): Promise<void> {
    await fetch(`${this.config.apiUrl}/runners/${runnerId}/heartbeat`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  async pollJob(runnerId: string): Promise<Job | null> {
    const res = await fetch(`${this.config.apiUrl}/runners/${runnerId}/poll`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) return null;
    const job = await res.json() as Job | null;
    return job ?? null;
  }

  async executeJob(jobId: string, runnerId: string): Promise<Job> {
    const res = await fetch(`${this.config.apiUrl}/jobs/${jobId}/execute`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ runnerId }),
    });
    if (!res.ok) throw new Error(`Execute failed: ${res.status}`);
    return res.json() as Promise<Job>;
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiToken}`,
    };
  }
}
