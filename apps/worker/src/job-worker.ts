import type { DatabaseClient } from '@ai-crm/database';
import type { PgBossQueueService } from '@ai-crm/queue';
import { processCampaignPlanJob, type CampaignPlanTask } from './campaign-plan.processor.js';
import { processSystemTestJob, type SystemTestTask } from './system-test.processor.js';

export async function registerJobWorkers(
  database: DatabaseClient,
  queue: PgBossQueueService,
  systemTestTask?: SystemTestTask,
  campaignPlanTask?: CampaignPlanTask,
): Promise<void> {
  await queue.work('system-test', async (job) => {
    await processSystemTestJob(database, job, systemTestTask);
  });
  await queue.work('campaign-plan', async (job) => {
    await processCampaignPlanJob(database, job, campaignPlanTask);
  });
}
