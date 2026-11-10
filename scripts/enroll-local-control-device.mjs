import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';

const [identityArg, controlBase = 'http://127.0.0.1:3000'] = process.argv.slice(2);
const enrollmentToken = process.env.PRINTOPS_ENROLLMENT_TOKEN;
if (!identityArg || !enrollmentToken) {
  throw new Error('Usage: set PRINTOPS_ENROLLMENT_TOKEN, then run node scripts/enroll-local-control-device.mjs <identity-file> [control-base-url]');
}
const identityPath = resolve(identityArg);
const identity = JSON.parse(readFileSync(identityPath, 'utf8'));
if (!identity.installationId || identity.deviceId || identity.deviceToken) {
  throw new Error('Identity must be initialized and not already enrolled');
}

const response = await fetch(new URL('/api/v1/control/enroll', controlBase), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    enrollmentToken,
    installationId: identity.installationId,
    hostname: os.hostname(),
    platform: process.platform,
    architecture: process.arch,
    appVersion: '0.1.32',
    schemaVersion: 8,
    runnerVersion: '0.1.28',
  }),
});
if (!response.ok) throw new Error(`Control enrollment failed: HTTP ${response.status}`);
const enrollment = await response.json();
if (!enrollment.deviceId || !enrollment.deviceToken || enrollment.installationId !== identity.installationId) {
  throw new Error('Control enrollment response is incomplete');
}

if (!enrollment.controlPlane?.natsUrl || !enrollment.controlPlane?.stream) {
  throw new Error('Enrollment response has no broker endpoints; the control plane is too old to hand out NATS settings');
}

copyFileSync(identityPath, `${identityPath}.pre-enrollment.bak`);
writeFileSync(identityPath, JSON.stringify({
  ...identity,
  deviceId: enrollment.deviceId,
  deviceToken: enrollment.deviceToken,
  siteId: enrollment.siteId,
  // Broker endpoints issued by the control plane. Without them a client falls
  // back to NATS defaults that point at its own machine.
  controlPlane: {
    natsUrl: enrollment.controlPlane.natsUrl,
    stream: enrollment.controlPlane.stream,
  },
  enrolledAt: new Date().toISOString(),
}, null, 2));
console.log(`Enrolled device ${enrollment.deviceId}`);
