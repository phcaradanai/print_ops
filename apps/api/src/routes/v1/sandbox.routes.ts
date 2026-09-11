import type { FastifyInstance } from 'fastify';
import type { SandboxService } from '../../services/sandbox.service.js';
import type { PrinterConnectivityService } from '../../services/printer-connectivity.service.js';
import type { AuditRepositoryPort } from '@printerops/domain';
import { actor, requirePermission } from './permission-guard.js';

export async function sandboxRoutes(
  app: FastifyInstance,
  deps: {
    sandbox: SandboxService;
    connectivity: PrinterConnectivityService;
    audit: AuditRepositoryPort;
  },
): Promise<void> {
  // ── Sandbox: single run ──
  app.post(
    '/sandbox/run',
    { onRequest: [requirePermission('sandbox:run')] },
    async (req) => {
      const body = req.body as {
        templateCode: string;
        paperProfileId?: string;
        samplePayload: Record<string, unknown>;
        testPrint?: { printerCode: string };
      };
      const result = await deps.sandbox.run(body);
      await deps.audit.create({
        traceId: result.runId,
        action: 'sandbox.run',
        actorId: actor(req),
        resourceType: 'template',
        resourceId: body.templateCode,
        after: result as unknown as Record<string, unknown>,
        metadata: { runId: result.runId, allFieldsResolved: result.allFieldsResolved },
      });
      return result;
    },
  );

  // ── Sandbox: batch ──
  app.post(
    '/sandbox/run-batch',
    { onRequest: [requirePermission('sandbox:run')] },
    async (req) => {
      const body = req.body as {
        templateCode: string;
        paperProfileId?: string;
        scenarios: Array<{
          label?: string;
          samplePayload: Record<string, unknown>;
          testPrint?: { printerCode: string };
        }>;
      };
      const result = await deps.sandbox.runBatch(
        body.templateCode,
        body.scenarios,
        body.paperProfileId,
      );
      await deps.audit.create({
        traceId: result.batchId,
        action: 'sandbox.batch_run',
        actorId: actor(req),
        resourceType: 'template',
        resourceId: body.templateCode,
        metadata: {
          batchId: result.batchId,
          passed: result.summary.passed,
          failed: result.summary.failed,
        },
      });
      return result;
    },
  );

  // ── Sandbox: quick validate template content ──
  app.post(
    '/sandbox/validate-template',
    { onRequest: [requirePermission('template:read')] },
    async (req) => {
      const body = req.body as { content: string; engine: string };
      const warnings: string[] = [];
      if (body.content.includes('<script')) warnings.push('HTML script tags are not allowed');
      if (body.content.includes('eval(')) warnings.push('Raw JavaScript eval is not allowed');
      const fields = [...new Set(
        [...body.content.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((m) => m[1] ?? ''),
      )];
      return { valid: warnings.length === 0, warnings, fields };
    },
  );

  // ── Connectivity: check one printer ──
  app.get(
    '/connectivity/printer/:printerId',
    { onRequest: [requirePermission('printer:control')] },
    async (req) => {
      const { printerId } = req.params as { printerId: string };
      const result = await deps.connectivity.checkPrinter(printerId);
      await deps.audit.create({
        traceId: result.printerId,
        action: 'connectivity.check',
        actorId: actor(req),
        resourceType: 'printer',
        resourceId: printerId,
        metadata: { detected: result.detected, statusCode: result.statusCode },
      });
      return result;
    },
  );

  // ── Connectivity: check all printers ──
  app.get(
    '/connectivity/report',
    { onRequest: [requirePermission('printer:control')] },
    async (req) => {
      const report = await deps.connectivity.checkAll();
      await deps.audit.create({
        traceId: report.reportId,
        action: 'connectivity.report',
        actorId: actor(req),
        resourceType: 'printer',
        resourceId: 'all',
        metadata: { online: report.online, offline: report.offline, error: report.error },
      });
      return report;
    },
  );
}
