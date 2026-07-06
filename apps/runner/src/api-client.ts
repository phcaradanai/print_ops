import type { Runner, Job } from '@printerops/domain';
import type { RunnerConfig } from './config.js';

export class ApiClient {
  constructor(private config: RunnerConfig) {}

  async register(): Promise<Runner> {
    const res = await fetch(`${this.config.apiUrl}/runners/register`, {
      method: 'POST',
      headers: this.headers(),
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
      headers: this.headers(),
    });
  }

  async pollJob(): Promise<Job | null> {
    const res = await fetch(`${this.config.apiUrl}/jobs?status=QUEUED&limit=1`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;
    const jobs = await res.json() as Job[];
    return jobs[0] ?? null;
  }

  async reportSuccess(jobId: string, runnerId: string): Promise<void> {
    await fetch(`${this.config.apiUrl}/jobs/${jobId}/execute`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ runnerId }),
    });
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiToken}`,
    };
  }
}
