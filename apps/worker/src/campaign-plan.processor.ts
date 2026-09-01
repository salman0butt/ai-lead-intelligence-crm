import {
  CampaignStatus,
  SearchTaskStatus,
  type DatabaseClient,
} from '@ai-crm/database';
import type {
  QueuePayload,
  QueueService,
  QueueWorkJob,
} from '@ai-crm/queue';
import { scheduleSearchTaskDiscovery } from './discovery-scheduler.js';
import { planCampaignSearch } from './search-planner/search-planner.js';
import { processTrackedJob } from './tracked-job.js';

export interface CampaignPlanPayload extends QueuePayload {
  campaignId: string;
}

export type CampaignPlanTask = (payload: CampaignPlanPayload) => Promise<void>;

export async function processCampaignPlanJob(
  database: DatabaseClient,
  queue: QueueService,
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

    const planning = await planCampaignSearch(database, {
      workspaceId: payload.workspaceId,
      campaignId: payload.campaignId,
    });
    if (planning.skipped || !planning.searchPlanId) return;

    let campaign = await database.campaign.findUnique({
      where: { id: payload.campaignId },
    });
    if (!campaign || campaign.workspaceId !== payload.workspaceId) {
      throw new Error('campaign-plan campaign/workspace relationship is invalid');
    }

    if (
      campaign.status === CampaignStatus.PAUSED
      || campaign.status === CampaignStatus.CANCELLED
    ) {
      return;
    }

    if (campaign.status === CampaignStatus.PLANNING) {
      await database.campaign.updateMany({
        where: {
          id: payload.campaignId,
          workspaceId: payload.workspaceId,
          status: CampaignStatus.PLANNING,
        },
        data: { status: CampaignStatus.DISCOVERING },
      });

      campaign = await database.campaign.findUnique({
        where: { id: payload.campaignId },
      });
      if (!campaign || campaign.workspaceId !== payload.workspaceId) {
        throw new Error('campaign-plan campaign disappeared during discovery handoff');
      }
    }

    if (
      campaign.status === CampaignStatus.PAUSED
      || campaign.status === CampaignStatus.CANCELLED
    ) {
      return;
    }

    if (campaign.status !== CampaignStatus.DISCOVERING) {
      throw new Error(
        `campaign-plan cannot hand off campaign from status ${campaign.status}`,
      );
    }

    const searchTasks = await database.searchTask.findMany({
      where: {
        searchPlanId: planning.searchPlanId,
        status: { in: [SearchTaskStatus.PENDING, SearchTaskStatus.FAILED] },
      },
      select: { id: true, pageNumber: true },
      orderBy: { id: 'asc' },
    });
    const campaignVersion = campaign.updatedAt.toISOString();

    for (const searchTask of searchTasks) {
      await scheduleSearchTaskDiscovery(queue, {
        workspaceId: payload.workspaceId,
        campaignId: payload.campaignId,
        searchTaskId: searchTask.id,
        campaignVersion,
        pageNumber: String(searchTask.pageNumber),
      });
    }
  });
}
