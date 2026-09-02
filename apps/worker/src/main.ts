import { loadServerEnv } from '@ai-crm/config';
import { createPrismaClient } from '@ai-crm/database';
import { PgBossQueueService } from '@ai-crm/queue';
import { createDiscoveryProviderRegistry } from './discovery-runtime.js';
import { registerJobWorkers } from './job-worker.js';
import { createWorkerLifecycle } from './lifecycle.js';

async function main() {
  const env = loadServerEnv(process.env);
  const database = createPrismaClient(env.DATABASE_URL);
  const queue = new PgBossQueueService(env.DATABASE_URL, database);
  const providers = createDiscoveryProviderRegistry(env);
  const worker = createWorkerLifecycle(database, queue);

  await worker.start();
  await registerJobWorkers(database, queue, providers);
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
