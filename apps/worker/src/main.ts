import { loadServerEnv } from '@ai-crm/config';
import { createPrismaClient } from '@ai-crm/database';
import { createWorkerLifecycle } from './lifecycle.js';

async function main() {
  const env = loadServerEnv(process.env);
  const database = createPrismaClient(env.DATABASE_URL);
  const worker = createWorkerLifecycle(database);

  await worker.start();
  console.info('worker ready');

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.stop();
    process.exitCode = 0;
  };

  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

void main();
