import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  CampaignStatus,
  DuplicateReason,
  SearchTaskStatus,
  createPrismaClient,
  type DatabaseClient,
} from '@ai-crm/database';
import { normalizeIdentity } from '@ai-crm/discovery';
import { processBusinessDiscoveryJob } from '../src/business-discovery.processor.js';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

type RawListing = {
  id: string;
  name: string;
  address: string;
};

function createProvider(results: RawListing[]) {
  return {
    name: 'google-maps-browser',
    searchBusinesses: vi.fn(async () => ({ results, nextCursor: null })),
    continueSearch: vi.fn(async () => ({ results, nextCursor: null })),
    normalizeResult: vi.fn((raw: RawListing) => ({
      providerExternalId: raw.id,
      name: raw.name,
      formattedAddress: raw.address,
      category: 'dentist',
      latitude: 30.1,
      longitude: -97.7,
      rawReference: `https://www.google.com/maps/place/${raw.id}`,
    })),
  };
}

function createRegistry(provider: ReturnType<typeof createProvider>) {
  return { get: vi.fn(() => provider) };
}

function createQueue() {
  return {
    enqueue: vi.fn(async () => {
      throw new Error('continuation is not expected');
    }),
  };
}

async function createWorkspace(database: DatabaseClient, label: string) {
  const suffix = randomUUID();
  const user = await database.user.create({
    data: {
      email: `m5-discovery-${label}-${suffix}@example.com`,
      passwordHash: 'integration-test-hash',
      name: 'M5 Discovery User',
    },
  });
  const workspace = await database.workspace.create({
    data: { name: `M5 Discovery ${label} ${suffix}` },
  });
  return { user, workspace };
}

async function createCampaignTaskJob(
  database: DatabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    label: string;
  },
) {
  const campaign = await database.campaign.create({
    data: {
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      name: `M5 Discovery ${input.label}`,
      country: 'United States',
      region: 'Texas',
      city: 'Austin',
      niche: 'Dentist',
      requestedLeadCount: 100,
      status: CampaignStatus.DISCOVERING,
    },
  });
  const plan = await database.searchPlan.create({
    data: {
      workspaceId: input.workspaceId,
      campaignId: campaign.id,
    },
  });
  const task = await database.searchTask.create({
    data: {
      searchPlanId: plan.id,
      country: 'United States',
      region: 'Texas',
      city: 'Austin',
      query: `Dentist ${input.label}`,
      provider: 'google-maps-browser',
      status: SearchTaskStatus.PENDING,
    },
  });
  const jobId = randomUUID();
  await database.jobMetadata.create({
    data: {
      jobId,
      queue: 'campaign-discovery',
      workspaceId: input.workspaceId,
      idempotencyKey: `m5-discovery:${jobId}`,
    },
  });
  return { campaign, task, jobId };
}

async function runDiscovery(
  database: DatabaseClient,
  fixture: Awaited<ReturnType<typeof createCampaignTaskJob>>,
  workspaceId: string,
  provider: ReturnType<typeof createProvider>,
) {
  return processBusinessDiscoveryJob(
    database,
    createQueue() as never,
    createRegistry(provider) as never,
    {
      id: fixture.jobId,
      data: {
        jobId: fixture.jobId,
        workspaceId,
        campaignId: fixture.campaign.id,
        searchTaskId: fixture.task.id,
        campaignVersion: fixture.campaign.updatedAt.toISOString(),
        pageNumber: '1',
      },
    },
  );
}

integration('business discovery canonicalization', () => {
  const database = createPrismaClient(databaseUrl!);
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    if (workspaceIds.length) {
      await database.workspace.deleteMany({ where: { id: { in: workspaceIds.splice(0) } } });
    }
    if (userIds.length) {
      await database.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('links every successfully persisted discovery candidate to a canonical Business', async () => {
    const context = await createWorkspace(database, 'single');
    workspaceIds.push(context.workspace.id);
    userIds.push(context.user.id);
    const fixture = await createCampaignTaskJob(database, {
      workspaceId: context.workspace.id,
      userId: context.user.id,
      label: 'single',
    });

    await runDiscovery(
      database,
      fixture,
      context.workspace.id,
      createProvider([
        {
          id: 'maps-url-sha256:canonical-1',
          name: 'Canonical Dental',
          address: '123 Main St, Austin, TX',
        },
      ]),
    );

    const candidate = await database.businessCandidate.findFirstOrThrow({
      where: { campaignId: fixture.campaign.id },
    });
    expect(candidate.matchedBusinessId).not.toBeNull();
    expect(candidate.duplicateConfidence).toBe(0);
    expect(candidate.duplicateReason).toBe(DuplicateReason.NEW_CANONICAL);
    expect(await database.business.count({
      where: { workspaceId: context.workspace.id },
    })).toBe(1);
  });

  it('maps the same provider listing found by two campaigns to one workspace Business', async () => {
    const context = await createWorkspace(database, 'cross-campaign');
    workspaceIds.push(context.workspace.id);
    userIds.push(context.user.id);
    const first = await createCampaignTaskJob(database, {
      workspaceId: context.workspace.id,
      userId: context.user.id,
      label: 'first',
    });
    const second = await createCampaignTaskJob(database, {
      workspaceId: context.workspace.id,
      userId: context.user.id,
      label: 'second',
    });
    const listing = {
      id: 'maps-url-sha256:shared-provider-id',
      name: 'Shared Dental',
      address: '456 Main St, Austin, TX',
    };

    await runDiscovery(database, first, context.workspace.id, createProvider([listing]));
    await runDiscovery(database, second, context.workspace.id, createProvider([listing]));

    const candidates = await database.businessCandidate.findMany({
      where: {
        workspaceId: context.workspace.id,
        providerExternalId: listing.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.matchedBusinessId).not.toBeNull();
    expect(candidates[1]?.matchedBusinessId).toBe(candidates[0]?.matchedBusinessId);
    expect(candidates[1]?.duplicateReason).toBe(DuplicateReason.PROVIDER_EXTERNAL_ID);
    expect(candidates[1]?.duplicateConfidence).toBe(1);
    expect(await database.business.count({
      where: { workspaceId: context.workspace.id },
    })).toBe(1);
  });

  it('rolls back page persistence when canonicalization detects an invalid cross-workspace association', async () => {
    const context = await createWorkspace(database, 'rollback');
    workspaceIds.push(context.workspace.id);
    userIds.push(context.user.id);
    const foreignContext = await createWorkspace(database, 'foreign');
    workspaceIds.push(foreignContext.workspace.id);
    userIds.push(foreignContext.user.id);
    const fixture = await createCampaignTaskJob(database, {
      workspaceId: context.workspace.id,
      userId: context.user.id,
      label: 'rollback',
    });

    const normalized = normalizeIdentity({
      name: 'Foreign Canonical',
      formattedAddress: '999 Other St, Austin, TX',
    });
    const foreignBusiness = await database.business.create({
      data: {
        workspaceId: foreignContext.workspace.id,
        name: 'Foreign Canonical',
        normalizedName: normalized.normalizedName,
        formattedAddress: '999 Other St, Austin, TX',
        normalizedAddress: normalized.normalizedAddress,
      },
    });
    const providerExternalId = 'maps-url-sha256:corrupted-candidate';
    const originalName = 'Preexisting Candidate';
    const candidate = await database.businessCandidate.create({
      data: {
        workspaceId: context.workspace.id,
        campaignId: fixture.campaign.id,
        provider: 'google-maps-browser',
        providerExternalId,
        name: originalName,
        formattedAddress: '123 Before St, Austin, TX',
        matchedBusinessId: foreignBusiness.id,
        duplicateConfidence: 0,
        duplicateReason: DuplicateReason.NEW_CANONICAL,
      },
    });

    await expect(runDiscovery(
      database,
      fixture,
      context.workspace.id,
      createProvider([
        {
          id: providerExternalId,
          name: 'Changed During Upsert',
          address: '123 After St, Austin, TX',
        },
      ]),
    )).rejects.toThrow('workspace isolation');

    await expect(database.businessCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    })).resolves.toMatchObject({
      name: originalName,
      matchedBusinessId: foreignBusiness.id,
    });
    await expect(database.businessSource.count({
      where: { searchTaskId: fixture.task.id },
    })).resolves.toBe(0);
    await expect(database.searchTask.findUniqueOrThrow({
      where: { id: fixture.task.id },
    })).resolves.toMatchObject({
      status: SearchTaskStatus.FAILED,
      resultCount: 0,
      uniqueBusinessCount: 0,
    });
    await expect(database.providerUsage.findUniqueOrThrow({
      where: {
        campaignId_provider: {
          campaignId: fixture.campaign.id,
          provider: 'google-maps-browser',
        },
      },
    })).resolves.toMatchObject({
      requestCount: 1,
      resultCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
    });
  });
});
