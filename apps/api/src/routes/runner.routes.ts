import type { FastifyInstance } from 'fastify';
import type { RegisterRunnerService } from '../services/register-runner.service.js';
import type { RunnerHeartbeatService } from '../services/runner-heartbeat.service.js';
import type { RunnerLifecycleService } from '../services/runner-lifecycle.service.js';
import { isRunnerTerminated } from '../services/runner-lifecycle.service.js';
import type { RunnerRepositoryPort, RegisterRunnerInput, JobRepositoryPort, Runner } from '@printerops/domain';
import { ConflictError } from '@printerops/shared';
import { requirePermission, actor } from './v1/permission-guard.js';

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
    runnerLifecycle: RunnerLifecycleService;
  }
): Promise<void> {
  // Previously guarded only by `app.authenticate` (any logged-in user could
  // register/heartbeat runners). The Go runner authenticates as the seeded
  // ADMIN dev account, which already holds runner:manage/job:read, so this
  // does not change runner behaviour — it only blocks VIEWER-role dashboard
  // users from mutating runner state.
  const read = { onRequest: [requirePermission('runner:read')] };
  const manage = { onRequest: [requirePermission('runner:manage')] };
  const jobRead = { onRequest: [requirePermission('job:read')] };

  app.get('/runners', read, async () => {
    return latestRunnersByIdentity(await deps.runners.findAll());
  });

  app.post('/runners/register', manage, async (req, reply) => {
    const runner = await deps.registerRunner.execute(req.body as RegisterRunnerInput);
    return reply.status(201).send(runner);
  });

  app.post('/runners/:id/heartbeat', manage, async (req) => {
    const { id } = req.params as { id: string };
    return deps.runnerHeartbeat.execute(id);
  });

  // Stop a runner from receiving work, keeping its record so the operator can see
  // and delete it. Refused when it is the last runner still able to claim jobs.
  app.post('/runners/:id/terminate', manage, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return reply.send(await deps.runnerLifecycle.terminate(id, actor(req)));
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.status(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  // Remove a runner registration outright. The last usable runner cannot be deleted.
  app.delete('/runners/:id', manage, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await deps.runnerLifecycle.remove(id, actor(req));
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof ConflictError) {
        return reply.status(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  // Poll for next QUEUED job — runner uses this to dequeue
  app.get('/runners/:id/poll', jobRead, async (req, reply) => {
    const { id } = req.params as { id: string };
    const runner = await deps.runners.findById(id);
    if (!runner) return reply.status(404).send({ error: `Runner ${id} not found` });
    // A terminated runner keeps its id but must not be handed any more work.
    if (isRunnerTerminated(runner)) {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: `Runner '${runner.name}' was terminated and can no longer claim jobs.`,
      });
    }
    const queued = await deps.jobs.findAll({ status: 'QUEUED', limit: 1 });
    if (queued.length === 0) return reply.send(null);
    return reply.send(queued[0]);
  });
}
