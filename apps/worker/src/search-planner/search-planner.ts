import { CampaignStatus, type DatabaseClient } from '@ai-crm/database';
import { DefaultGeographyCatalog, type GeographyCatalog, type GeographicTarget } from './geography.js';
import { expandNiche } from './niche-expander.js';

export interface SearchPlanningInput {
  workspaceId: string;
  campaignId: string;
}

export interface SearchPlanningResult {
  searchPlanId: string | null;
  generatedTaskCount: number;
  insertedTaskCount: number;
  skipped: boolean;
}

interface PlannedSearchTask extends GeographicTarget {
  query: string;
  provider: string;
}

export const DEFAULT_DISCOVERY_PROVIDER = 'google-maps-browser';

function dedupeTasks(tasks: PlannedSearchTask[]): PlannedSearchTask[] {
  const seen = new Set<string>();
  const unique: PlannedSearchTask[] = [];

  for (const task of tasks) {
    const key = [task.provider, task.country, task.region, task.city, task.query].join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(task);
  }

  return unique;
}

export async function planCampaignSearch(
  database: DatabaseClient,
  input: SearchPlanningInput,
  geographyCatalog: GeographyCatalog = new DefaultGeographyCatalog(),
): Promise<SearchPlanningResult> {
  const campaign = await database.campaign.findFirst({
    where: {
      id: input.campaignId,
      workspaceId: input.workspaceId,
    },
  });

  if (!campaign) throw new Error('Campaign not found for search planning');

  if (campaign.status === CampaignStatus.CANCELLED) {
    return {
      searchPlanId: null,
      generatedTaskCount: 0,
      insertedTaskCount: 0,
      skipped: true,
    };
  }

  if (campaign.status === CampaignStatus.DRAFT) {
    throw new Error('Draft campaign cannot be search planned');
  }

  const queries = expandNiche(campaign.niche);
  if (queries.length === 0) throw new Error('Campaign niche produced no search queries');

  const geography = geographyCatalog.expand({
    country: campaign.country,
    region: campaign.region,
    city: campaign.city,
  });
  if (geography.length === 0) throw new Error('Campaign targeting produced no geographic search targets');

  const tasks = dedupeTasks(
    queries.flatMap((query) =>
      geography.map((target) => ({
        ...target,
        query,
        provider: DEFAULT_DISCOVERY_PROVIDER,
      })),
    ),
  );

  return database.$transaction(async (tx) => {
    const plan = await tx.searchPlan.upsert({
      where: { campaignId: campaign.id },
      update: {},
      create: {
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
      },
    });

    const inserted = await tx.searchTask.createMany({
      data: tasks.map((task) => ({
        searchPlanId: plan.id,
        country: task.country,
        region: task.region,
        city: task.city,
        geographicCell: task.geographicCell,
        query: task.query,
        provider: task.provider,
      })),
      skipDuplicates: true,
    });

    return {
      searchPlanId: plan.id,
      generatedTaskCount: tasks.length,
      insertedTaskCount: inserted.count,
      skipped: false,
    };
  });
}
