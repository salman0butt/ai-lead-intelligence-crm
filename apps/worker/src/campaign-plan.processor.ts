import type { DatabaseClient } from '@ai-crm/database';
import type { QueuePayload, QueueWorkJob } from '@ai-crm/queue';
import { planCampaignSearch } from './search-planner/search-planner.js';
import { processTrackedJob } from './tracked-job.js';

export interface CampaignPlanPayload extends QueuePayload {
  campaignId: string;
}

export type CampaignPlanTask = (payload: CampaignPlanPayload) => Promise<void>;

export async function processCampaignPlanJob(
  database: DatabaseClient,
  job: QueueWorkJob,
  task?: CampaignPlanTask,
): Promise<void> {
  return processTrackedJob(database, job, async (trackedJob) => {
    const payload = trackedJob.data as CampaignPlanPayload;
    if (!payload.campaignId) throw new Error('campaign-plan payload requires campaignId');

    if (task) {
      await task(payload);
      return;
    }

    await planCampaignSearch(database, {
      workspaceId: payload.workspaceId,
      campaignId: payload.campaignId,
    });
  });
}
