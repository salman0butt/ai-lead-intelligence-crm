import type { DatabaseClient } from '@ai-crm/database';
import type { DiscoveryProviderRegistry } from '@ai-crm/discovery';
import type { PgBossQueueService } from '@ai-crm/queue';
import { processBusinessDiscoveryJob } from './business-discovery.processor.js';
import { processCampaignPlanJob, type CampaignPlanTask } from './campaign-plan.processor.js';
import { processSystemTestJob, type SystemTestTask } from './system-test.processor.js';

export async function registerJobWorkers(
  database: DatabaseClient,
  queue: PgBossQueueService,
  providers: DiscoveryProviderRegistry,
  systemTestTask?: SystemTestTask,
  campaignPlanTask?: CampaignPlanTask,
): Promise<void> {
  await queue.work('system-test', async (job) => {
    await processSystemTestJob(database, job, systemTestTask);
  });
  await queue.work('campaign-plan', async (job) => {
    await processCampaignPlanJob(database, queue, job, campaignPlanTask);
  });
  await queue.work('campaign-discovery', async (job) => {
    await processBusinessDiscoveryJob(database, queue, providers, job);
  });
}
