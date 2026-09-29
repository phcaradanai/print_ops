import { connect } from 'nats';

const url = process.env.PRINTOPS_CONTROL_NATS_URL;
const stream = process.env.PRINTOPS_CONTROL_NATS_STREAM;
if (!url || !stream) throw new Error('Control NATS URL and stream are required');

let connection;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    connection = await connect({ servers: url, timeout: 2000 });
    break;
  } catch (error) {
    if (attempt === 29) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

try {
  const manager = await connection.jetstreamManager();
  try {
    const existing = await manager.streams.info(stream);
    const expected = ['printops.control.command.*', 'printops.control.event.*', 'printops.control.heartbeat.*'];
    if (expected.some((subject) => !existing.config.subjects?.includes(subject))) {
      throw new Error(`Existing ${stream} stream does not contain the required control subjects`);
    }
  } catch (error) {
    if (error?.code !== '404') throw error;
    await manager.streams.add({
      name: stream,
      subjects: ['printops.control.command.*', 'printops.control.event.*', 'printops.control.heartbeat.*'],
      storage: 'file',
    });
  }
} finally {
  await connection?.drain();
}
