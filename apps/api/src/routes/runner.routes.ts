import type { FastifyInstance } from 'fastify';
import type { RegisterRunnerService } from '../services/register-runner.service.js';
import type { RunnerHeartbeatService } from '../services/runner-heartbeat.service.js';
import type { RunnerRepositoryPort, RegisterRunnerInput, JobRepositoryPort, Runner } from '@printerops/domain';

/**
 * Old desktop releases created a new record on every launch. Keep the public
 * runner list to one card per logical runner while the registration service
 * reuses the newest matching record from now on.
 */
export function latestRunnersByIdentity(runners: Runner[]): Runner[] {
  const seen = new Set<string>();
  return runners.filter((runner) => {
    const identity = `${runner.hostname}\u0000${runner.name}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export async function runnerRoutes(
  app: FastifyInstance,
  deps: {
    runners: RunnerRepositoryPort;
    jobs: JobRepositoryPort;
    registerRunner: RegisterRunnerService;
    runnerHeartbeat: RunnerHeartbeatService;
  }
): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/runners', auth, async () => {
    return latestRunnersByIdentity(await deps.runners.findAll());
  });

  app.post('/runners/register', auth, async (req, reply) => {
    const runner = await deps.registerRunner.execute(req.body as RegisterRunnerInput);
    return reply.status(201).send(runner);
  });

  app.post('/runners/:id/heartbeat', auth, async (req) => {
    const { id } = req.params as { id: string };
    return deps.runnerHeartbeat.execute(id);
  });

  // Poll for next QUEUED job — runner uses this to dequeue
  app.get('/runners/:id/poll', auth, async (req, reply) => {
    const queued = await deps.jobs.findAll({ status: 'QUEUED', limit: 1 });
    if (queued.length === 0) return reply.send(null);
    return reply.send(queued[0]);
  });
}
