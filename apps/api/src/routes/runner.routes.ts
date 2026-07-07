import type { FastifyInstance } from 'fastify';
import type { RegisterRunnerService } from '../services/register-runner.service.js';
import type { RunnerHeartbeatService } from '../services/runner-heartbeat.service.js';
import type { RunnerRepositoryPort, RegisterRunnerInput, JobRepositoryPort } from '@printerops/domain';

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
    return deps.runners.findAll();
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
