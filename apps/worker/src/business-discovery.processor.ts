import {
  CampaignStatus,
  SearchTaskStatus,
  type DatabaseClient,
} from '@ai-crm/database';
import {
  DiscoveryProviderError,
  type DiscoveryProviderRegistry,
  type NormalizedBusiness,
} from '@ai-crm/discovery';
import type { QueuePayload, QueueService, QueueWorkJob } from '@ai-crm/queue';
import { scheduleSearchTaskDiscovery } from './discovery-scheduler.js';
import { processTrackedJob } from './tracked-job.js';

export interface CampaignDiscoveryPayload extends QueuePayload {
  campaignId: string;
  searchTaskId: string;
  campaignVersion: string;
  pageNumber: string;
}

interface NormalizedResult {
  business: NormalizedBusiness;
  raw: unknown;
}

export async function processBusinessDiscoveryJob(
  database: DatabaseClient,
  queue: QueueService,
  providers: DiscoveryProviderRegistry,
  job: QueueWorkJob,
): Promise<void> {
  return processTrackedJob(database, job, async (trackedJob) => {
    const payload = trackedJob.data as CampaignDiscoveryPayload;
    validatePayload(payload);

    const persisted = await database.searchTask.findUnique({
      where: { id: payload.searchTaskId },
      include: {
        searchPlan: {
          include: { campaign: true },
        },
      },
    });
    if (!persisted) throw new Error('campaign-discovery SearchTask not found');

    const campaign = persisted.searchPlan.campaign;
    if (
      persisted.searchPlan.workspaceId !== payload.workspaceId
      || persisted.searchPlan.campaignId !== payload.campaignId
      || campaign.id !== payload.campaignId
      || campaign.workspaceId !== payload.workspaceId
    ) {
      throw new Error('campaign-discovery identifier relationship is invalid');
    }

    if (
      campaign.status !== CampaignStatus.DISCOVERING
      || campaign.updatedAt.toISOString() !== payload.campaignVersion
    ) {
      return;
    }

    if (
      persisted.status === SearchTaskStatus.COMPLETED
      || persisted.status === SearchTaskStatus.CANCELLED
    ) {
      return;
    }

    const payloadPage = Number(payload.pageNumber);
    if (!Number.isInteger(payloadPage) || payloadPage < 1) {
      throw new Error('campaign-discovery pageNumber must be a positive integer');
    }
    if (payloadPage < persisted.pageNumber) {
      return;
    }
    if (payloadPage > persisted.pageNumber) {
      throw new Error('campaign-discovery payload page is ahead of persisted SearchTask page');
    }

    const claimed = await database.searchTask.updateMany({
      where: {
        id: persisted.id,
        pageNumber: payloadPage,
        status: { in: [SearchTaskStatus.PENDING, SearchTaskStatus.FAILED] },
      },
      data: {
        status: SearchTaskStatus.RUNNING,
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return;

    let provider;
    try {
      provider = providers.get(persisted.provider);
    } catch (error) {
      await failDiscoveryTask(database, persisted.id);
      await recordProviderError(
        database,
        payload.workspaceId,
        payload.campaignId,
        persisted.provider,
        error,
      );
      throw error;
    }

    await database.providerUsage.upsert({
      where: {
        campaignId_provider: {
          campaignId: payload.campaignId,
          provider: persisted.provider,
        },
      },
      update: { requestCount: { increment: 1 } },
      create: {
        workspaceId: payload.workspaceId,
        campaignId: payload.campaignId,
        provider: persisted.provider,
        requestCount: 1,
      },
    });

    let page;
    let normalized: NormalizedResult[];
    try {
      const input = {
        query: persisted.query,
        country: persisted.country,
        region: persisted.region,
        city: persisted.city,
        geographicCell: persisted.geographicCell,
      };

      if (payloadPage === 1) {
        if (persisted.continuationCursor) {
          throw new Error('campaign-discovery first page unexpectedly has a persisted continuation cursor');
        }
        page = await provider.searchBusinesses(input);
      } else {
        if (!persisted.continuationCursor) {
          throw new Error('campaign-discovery continuation requires a persisted cursor');
        }
        page = await provider.continueSearch(input, persisted.continuationCursor);
      }

      normalized = page.results.map((raw) => ({
        raw,
        business: provider.normalizeResult(raw),
      }));
    } catch (error) {
      await failDiscoveryTask(database, persisted.id);
      await recordProviderError(
        database,
        payload.workspaceId,
        payload.campaignId,
        persisted.provider,
        error,
      );
      throw error;
    }

    const nextCursor = page.nextCursor?.trim() || null;
    let newProvenanceCount = 0;

    try {
      await database.$transaction(async (tx) => {
        for (const result of normalized) {
          const business = result.business;
          const candidate = await tx.businessCandidate.upsert({
            where: {
              campaignId_provider_providerExternalId: {
                campaignId: payload.campaignId,
                provider: persisted.provider,
                providerExternalId: business.providerExternalId,
              },
            },
            update: {
              name: business.name,
              formattedAddress: business.formattedAddress,
              category: business.category,
              latitude: business.latitude,
              longitude: business.longitude,
              rawReference: business.rawReference,
            },
            create: {
              workspaceId: payload.workspaceId,
              campaignId: payload.campaignId,
              provider: persisted.provider,
              providerExternalId: business.providerExternalId,
              name: business.name,
              formattedAddress: business.formattedAddress,
              category: business.category,
              latitude: business.latitude,
              longitude: business.longitude,
              rawReference: business.rawReference,
            },
          });

          const source = await tx.businessSource.createMany({
            data: [{
              businessCandidateId: candidate.id,
              searchTaskId: persisted.id,
              provider: persisted.provider,
              providerExternalId: business.providerExternalId,
              rawPayload: result.raw as never,
            }],
            skipDuplicates: true,
          });
          newProvenanceCount += source.count;
        }

        const updatedTask = await tx.searchTask.updateMany({
          where: {
            id: persisted.id,
            status: SearchTaskStatus.RUNNING,
            pageNumber: payloadPage,
          },
          data: {
            status: nextCursor ? SearchTaskStatus.PENDING : SearchTaskStatus.COMPLETED,
            resultCount: { increment: page.results.length },
            uniqueBusinessCount: { increment: newProvenanceCount },
            continuationCursor: nextCursor,
            pageNumber: nextCursor ? payloadPage + 1 : payloadPage,
          },
        });
        if (updatedTask.count !== 1) {
          throw new Error('campaign-discovery lost SearchTask result persistence race');
        }

        await tx.providerUsage.update({
          where: {
            campaignId_provider: {
              campaignId: payload.campaignId,
              provider: persisted.provider,
            },
          },
          data: { resultCount: { increment: page.results.length } },
        });
      });
    } catch (error) {
      await failDiscoveryTask(database, persisted.id);
      throw error;
    }

    if (nextCursor) {
      await scheduleSearchTaskDiscovery(queue, {
        workspaceId: payload.workspaceId,
        campaignId: payload.campaignId,
        searchTaskId: persisted.id,
        campaignVersion: payload.campaignVersion,
        pageNumber: String(payloadPage + 1),
      });
    }
  });
}

function validatePayload(payload: CampaignDiscoveryPayload): void {
  if (!payload.campaignId) throw new Error('campaign-discovery payload requires campaignId');
  if (!payload.searchTaskId) throw new Error('campaign-discovery payload requires searchTaskId');
  if (!payload.campaignVersion) throw new Error('campaign-discovery payload requires campaignVersion');
  if (!payload.pageNumber) throw new Error('campaign-discovery payload requires pageNumber');
}

async function failDiscoveryTask(database: DatabaseClient, searchTaskId: string): Promise<void> {
  await database.searchTask.updateMany({
    where: { id: searchTaskId, status: SearchTaskStatus.RUNNING },
    data: { status: SearchTaskStatus.FAILED },
  });
}

async function recordProviderError(
  database: DatabaseClient,
  workspaceId: string,
  campaignId: string,
  provider: string,
  error: unknown,
): Promise<void> {
  const rateLimited = error instanceof DiscoveryProviderError && error.rateLimited;
  await database.providerUsage.upsert({
    where: {
      campaignId_provider: { campaignId, provider },
    },
    update: {
      errorCount: { increment: 1 },
      ...(rateLimited ? { rateLimitCount: { increment: 1 } } : {}),
    },
    create: {
      workspaceId,
      campaignId,
      provider,
      errorCount: 1,
      rateLimitCount: rateLimited ? 1 : 0,
    },
  });
}
