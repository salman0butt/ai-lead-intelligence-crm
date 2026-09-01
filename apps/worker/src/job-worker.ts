import type { DatabaseClient } from '@ai-crm/database';
import type { PgBossQueueService } from '@ai-crm/queue';
import { processSystemTestJob, type SystemTestTask } from './system-test.processor.js';

export async function registerJobWorkers(
  database: DatabaseClient,
  queue: PgBossQueueService,
  systemTestTask?: SystemTestTask,
): Promise<void> {
  await queue.work('system-test', async (job) => {
    await processSystemTestJob(database, job, systemTestTask);
  });
}
