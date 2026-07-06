import type { FastifyInstance } from 'fastify';
import type { RegisterRunnerService } from '../services/register-runner.service.js';
import type { RunnerHeartbeatService } from '../services/runner-heartbeat.service.js';
import type { RunnerRepositoryPort, RegisterRunnerInput } from '@printerops/domain';

export async function runnerRoutes(
  app: FastifyInstance,
  deps: {
    runners: RunnerRepositoryPort;
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
}
