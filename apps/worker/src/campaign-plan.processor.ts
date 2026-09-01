import type { DatabaseClient } from '@ai-crm/database';
import type { QueuePayload, QueueWorkJob } from '@ai-crm/queue';
import { processTrackedJob } from './tracked-job.js';

export interface CampaignPlanPayload extends QueuePayload {
  campaignId: string;
}

export type CampaignPlanTask = (payload: CampaignPlanPayload) => Promise<void>;

const defaultTask: CampaignPlanTask = async () => undefined;

export async function processCampaignPlanJob(
  database: DatabaseClient,
  job: QueueWorkJob,
  task: CampaignPlanTask = defaultTask,
): Promise<void> {
  return processTrackedJob(database, job, async (trackedJob) => {
    const payload = trackedJob.data as CampaignPlanPayload;
    if (!payload.campaignId) throw new Error('campaign-plan payload requires campaignId');
    await task(payload);
  });
}
