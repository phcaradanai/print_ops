import { describe, it } from 'vitest';
import { runClientMatrix } from './ota-docker-client-matrix.js';

const wan = process.env.PRINTOPS_OTA_DOCKER_WAN_URL;
const lan = process.env.PRINTOPS_OTA_DOCKER_LAN_URL;

describe('Docker OTA client/service matrix', () => {
  it.skipIf(!wan || !lan)('accepts signed releases and rejects the controlled failure matrix', async () => {
    await runClientMatrix(wan!, lan!);
  });
});
