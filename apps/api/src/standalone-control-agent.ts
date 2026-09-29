import type { ControlCommandEnvelope } from '@printerops/domain';
import { PrintOpsControlAgent } from './services/control-agent.service.js';
import { ControlTargetHttp } from './services/control-target-http.js';
import { DeviceIdentityStore } from './services/device-identity.js';
import { signControlMessageWithToken, verifyControlMessageWithToken } from './services/control-message-auth.js';
import { controlPlaneTransportConfigFromEnv, startControlPlaneTransport } from './infra/nats/control-plane-transport.js';

async function main(): Promise<void> {
  const identityPath = process.env['PRINTOPS_CONTROL_IDENTITY_PATH'];
  const tokenPath = process.env['PRINTOPS_CONTROL_TARGET_TOKEN_PATH'];
  if (!identityPath || !tokenPath) {
    throw new Error('PRINTOPS_CONTROL_IDENTITY_PATH and PRINTOPS_CONTROL_TARGET_TOKEN_PATH are required');
  }
  const identity = new DeviceIdentityStore({ storagePath: identityPath });
  if (!identity.isEnrolled()) throw new Error('Control agent must be enrolled before startup');
  const deviceId = identity.getDeviceId()!;
  const deviceToken = identity.getDeviceToken()!;
  const config = controlPlaneTransportConfigFromEnv({ role: 'device', deviceId });
  if (!config) throw new Error('PRINTOPS_CONTROL_NATS_URL is required');

  const target = new ControlTargetHttp(
    process.env['PRINTOPS_CONTROL_TARGET_URL'] ?? 'http://127.0.0.1:31415',
    tokenPath,
  );
  let transport: Awaited<ReturnType<typeof startControlPlaneTransport>>;
  const agent = new PrintOpsControlAgent({
    identityStore: identity,
    otaService: target,
    getPrintStatus: () => target.getPrintSystemStatus(),
    getDeviceInfo: () => target.getDeviceInfo(),
    applyContentBundle: (bundle) => target.applyContentBundle(bundle),
    getClientContentIndex: () => target.getClientContentIndex(),
    exportClientContent: (kind, code) => target.exportClientContent(kind, code),
    eventPublisher: async (subject, event) => {
      await transport.publishEvent(subject, signControlMessageWithToken(deviceToken, event) as unknown as Record<string, unknown>, event.eventId);
    },
    heartbeatPublisher: async (subject, heartbeat) => {
      await transport.publishHeartbeat(subject, signControlMessageWithToken(deviceToken, heartbeat) as unknown as Record<string, unknown>, `heartbeat-${heartbeat.deviceId}-${heartbeat.timestamp}`);
    },
    logger: console,
  });
  transport = await startControlPlaneTransport(config, {
    onCommand: async (message, subject) => {
      if (subject !== `printops.control.command.${deviceId}`) return;
      const payload = message['payload'];
      const signature = message['signature'];
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof signature !== 'string'
        || !verifyControlMessageWithToken(deviceToken, payload, signature)) {
        console.warn('Discarded unauthenticated control command');
        return;
      }
      await agent.handleCommand(payload as ControlCommandEnvelope, { waitForCompletion: true });
    },
  }, { logger: console, allowOfflineStartup: true });

  agent.startHeartbeat();
  console.info(`Standalone control agent started for ${deviceId}`);
  const stop = () => {
    agent.stopHeartbeat();
    void transport.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error('Standalone control agent failed:', error);
  process.exitCode = 1;
});
