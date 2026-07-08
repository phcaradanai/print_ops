import type { Runner, Job, DiscoveryItem } from '@printerops/domain';
import type { RunnerConfig } from './config.js';

export class ApiClient {
  private token: string;

  constructor(private config: RunnerConfig) {
    this.token = config.apiToken;
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.config.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.config.devEmail, password: this.config.devPassword }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = await res.json() as { token: string };
    this.token = data.token;
  }

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
    const res = await fetch(`${this.config.apiUrl}/runners/${runnerId}/heartbeat`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Heartbeat failed: ${res.status}`);
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

  async syncDiscovery(runnerId: string, items: DiscoveryItem[]): Promise<void> {
    await fetch(`${this.config.apiUrl}/api/v1/runners/${runnerId}/printers/discovery`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ items }),
    });
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }
}
