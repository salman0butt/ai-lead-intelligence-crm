import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  CampaignStatus,
  SearchTaskStatus,
  createPrismaClient,
  type DatabaseClient,
} from '@ai-crm/database';
import { processBusinessDiscoveryJob } from '../src/business-discovery.processor.js';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

type RawListing = {
  id: string;
  name: string;
  address: string;
};

function createProvider(
  results: RawListing[],
  error?: Error,
  nextCursor: string | null = null,
) {
  return {
    name: 'google-maps-browser',
    searchBusinesses: vi.fn(async () => {
      if (error) throw error;
      return { results, nextCursor };
    }),
    continueSearch: vi.fn(async () => {
      if (error) throw error;
      return { results, nextCursor };
    }),
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
  return {
    get: vi.fn(() => provider),
  };
}

function createQueue() {
  return {
    enqueue: vi.fn(async () => {
      throw new Error('continuation is not expected in first-page completion tests');
    }),
  };
}

async function createFixture(
  database: DatabaseClient,
  options: {
    campaignStatus?: 'DISCOVERING' | 'PAUSED' | 'CANCELLED';
    taskStatus?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
    query?: string;
  } = {},
) {
  const suffix = randomUUID();
  const user = await database.user.create({
    data: {
      email: `business-discovery-${suffix}@example.com`,
      passwordHash: 'integration-test-hash',
      name: 'Business Discovery User',
    },
  });
  const workspace = await database.workspace.create({
    data: { name: `Business Discovery ${suffix}` },
  });
  const campaign = await database.campaign.create({
    data: {
      workspaceId: workspace.id,
      createdByUserId: user.id,
      name: `Austin Dentists ${suffix}`,
      country: 'United States',
      region: 'Texas',
      city: 'Austin',
      niche: 'Dentist',
      requestedLeadCount: 10_000,
      status: options.campaignStatus ?? CampaignStatus.DISCOVERING,
    },
  });
  const plan = await database.searchPlan.create({
    data: {
      workspaceId: workspace.id,
      campaignId: campaign.id,
    },
  });
  const task = await database.searchTask.create({
    data: {
      searchPlanId: plan.id,
      country: 'United States',
      region: 'Texas',
      city: 'Austin',
      query: options.query ?? 'Dentist',
      provider: 'google-maps-browser',
      status: options.taskStatus ?? SearchTaskStatus.PENDING,
    },
  });
  const jobId = randomUUID();
  await database.jobMetadata.create({
    data: {
      jobId,
      queue: 'campaign-discovery',
      workspaceId: workspace.id,
      idempotencyKey: `test-discovery:${jobId}`,
    },
  });

  return { user, workspace, campaign, plan, task, jobId };
}

integration('business discovery processor', () => {
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

  it('normalizes one page, persists exact candidates/provenance, and aggregates source usage', async () => {
    const first = await createFixture(database);
    workspaceIds.push(first.workspace.id);
    userIds.push(first.user.id);

    const provider = createProvider([
      { id: 'maps-url-sha256:place-1', name: 'Example Dental', address: '123 Main St, Austin, TX' },
      { id: 'maps-url-sha256:place-2', name: 'Second Dental', address: '456 Main St, Austin, TX' },
    ]);
    const registry = createRegistry(provider);
    const queue = createQueue();

    await processBusinessDiscoveryJob(
      database,
      queue as never,
      registry as never,
      {
        id: first.jobId,
        data: {
          jobId: first.jobId,
          workspaceId: first.workspace.id,
          campaignId: first.campaign.id,
          searchTaskId: first.task.id,
          campaignVersion: first.campaign.updatedAt.toISOString(),
          pageNumber: '1',
        },
      },
    );

    const task = await database.searchTask.findUniqueOrThrow({ where: { id: first.task.id } });
    expect(task).toMatchObject({
      status: SearchTaskStatus.COMPLETED,
      attemptCount: 1,
      resultCount: 2,
      uniqueBusinessCount: 2,
      pageNumber: 1,
      continuationCursor: null,
    });
    await expect(
      database.businessCandidate.count({ where: { campaignId: first.campaign.id } }),
    ).resolves.toBe(2);
    await expect(
      database.businessSource.count({ where: { searchTaskId: first.task.id } }),
    ).resolves.toBe(2);
    await expect(
      database.providerUsage.findUniqueOrThrow({
        where: {
          campaignId_provider: {
            campaignId: first.campaign.id,
            provider: 'google-maps-browser',
          },
        },
      }),
    ).resolves.toMatchObject({
      requestCount: 1,
      resultCount: 2,
      errorCount: 0,
      rateLimitCount: 0,
    });
    await expect(
      database.jobMetadata.findUniqueOrThrow({ where: { jobId: first.jobId } }),
    ).resolves.toMatchObject({ status: 'COMPLETED', attempts: 1 });

    const secondTask = await database.searchTask.create({
      data: {
        searchPlanId: first.plan.id,
        country: 'United States',
        region: 'Texas',
        city: 'Austin',
        query: 'Dental clinic',
        provider: 'google-maps-browser',
      },
    });
    const secondJobId = randomUUID();
    await database.jobMetadata.create({
      data: {
        jobId: secondJobId,
        queue: 'campaign-discovery',
        workspaceId: first.workspace.id,
        idempotencyKey: `test-discovery:${secondJobId}`,
      },
    });
    const secondProvider = createProvider([
      { id: 'maps-url-sha256:place-1', name: 'Example Dental', address: '123 Main St, Austin, TX' },
      { id: 'maps-url-sha256:place-3', name: 'Third Dental', address: '789 Main St, Austin, TX' },
    ]);

    const currentCampaign = await database.campaign.findUniqueOrThrow({
      where: { id: first.campaign.id },
    });
    await processBusinessDiscoveryJob(
      database,
      queue as never,
      createRegistry(secondProvider) as never,
      {
        id: secondJobId,
        data: {
          jobId: secondJobId,
          workspaceId: first.workspace.id,
          campaignId: first.campaign.id,
          searchTaskId: secondTask.id,
          campaignVersion: currentCampaign.updatedAt.toISOString(),
          pageNumber: '1',
        },
      },
    );

    await expect(
      database.businessCandidate.count({ where: { campaignId: first.campaign.id } }),
    ).resolves.toBe(3);
    await expect(
      database.businessSource.count({ where: { businessCandidate: { campaignId: first.campaign.id } } }),
    ).resolves.toBe(4);
  });

  it('repairs a committed continuation after enqueue failure without repeating provider I/O', async () => {
    const fixture = await createFixture(database);
    workspaceIds.push(fixture.workspace.id);
    userIds.push(fixture.user.id);

    const provider = createProvider(
      [{ id: 'maps-url-sha256:page-1', name: 'Page One Dental', address: '100 Main St, Austin, TX' }],
      undefined,
      'cursor-2',
    );
    const registry = createRegistry(provider);
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('queue unavailable after page commit'))
      .mockResolvedValueOnce({
        jobId: randomUUID(),
        queue: 'campaign-discovery',
        status: 'QUEUED',
        workspaceId: fixture.workspace.id,
        attempts: 0,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      });
    const queue = { enqueue };
    const oldPageOneJob = {
      id: fixture.jobId,
      data: {
        jobId: fixture.jobId,
        workspaceId: fixture.workspace.id,
        campaignId: fixture.campaign.id,
        searchTaskId: fixture.task.id,
        campaignVersion: fixture.campaign.updatedAt.toISOString(),
        pageNumber: '1',
      },
    };

    await expect(
      processBusinessDiscoveryJob(database, queue as never, registry as never, oldPageOneJob),
    ).rejects.toThrow('queue unavailable after page commit');

    await expect(
      database.searchTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
    ).resolves.toMatchObject({
      status: SearchTaskStatus.PENDING,
      pageNumber: 2,
      continuationCursor: 'cursor-2',
      attemptCount: 1,
      resultCount: 1,
    });
    expect(provider.searchBusinesses).toHaveBeenCalledTimes(1);
    expect(provider.continueSearch).not.toHaveBeenCalled();

    await processBusinessDiscoveryJob(
      database,
      queue as never,
      registry as never,
      oldPageOneJob,
    );

    expect(provider.searchBusinesses).toHaveBeenCalledTimes(1);
    expect(provider.continueSearch).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenLastCalledWith(
      'campaign-discovery',
      {
        workspaceId: fixture.workspace.id,
        campaignId: fixture.campaign.id,
        searchTaskId: fixture.task.id,
        campaignVersion: fixture.campaign.updatedAt.toISOString(),
        pageNumber: '2',
      },
      {
        idempotencyKey:
          `campaign-discovery:${fixture.task.id}:${fixture.campaign.updatedAt.toISOString()}:page:2`,
      },
    );
  });

  it.each(['PAUSED', 'CANCELLED'] as const)(
    'completes a stale queued job without provider I/O when campaign is %s',
    async (campaignStatus) => {
      const fixture = await createFixture(database, { campaignStatus });
      workspaceIds.push(fixture.workspace.id);
      userIds.push(fixture.user.id);
      const provider = createProvider([]);

      await processBusinessDiscoveryJob(
        database,
        createQueue() as never,
        createRegistry(provider) as never,
        {
          id: fixture.jobId,
          data: {
            jobId: fixture.jobId,
            workspaceId: fixture.workspace.id,
            campaignId: fixture.campaign.id,
            searchTaskId: fixture.task.id,
            campaignVersion: fixture.campaign.updatedAt.toISOString(),
            pageNumber: '1',
          },
        },
      );

      expect(provider.searchBusinesses).not.toHaveBeenCalled();
      await expect(
        database.searchTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
      ).resolves.toMatchObject({ status: SearchTaskStatus.PENDING, attemptCount: 0 });
    },
  );

  it('completes a stale generation without provider I/O', async () => {
    const fixture = await createFixture(database);
    workspaceIds.push(fixture.workspace.id);
    userIds.push(fixture.user.id);
    const provider = createProvider([]);

    await processBusinessDiscoveryJob(
      database,
      createQueue() as never,
      createRegistry(provider) as never,
      {
        id: fixture.jobId,
        data: {
          jobId: fixture.jobId,
          workspaceId: fixture.workspace.id,
          campaignId: fixture.campaign.id,
          searchTaskId: fixture.task.id,
          campaignVersion: new Date(fixture.campaign.updatedAt.getTime() - 1_000).toISOString(),
          pageNumber: '1',
        },
      },
    );

    expect(provider.searchBusinesses).not.toHaveBeenCalled();
  });

  it('rejects identifier or page inconsistencies before provider I/O', async () => {
    const fixture = await createFixture(database);
    workspaceIds.push(fixture.workspace.id);
    userIds.push(fixture.user.id);
    const provider = createProvider([]);

    await expect(
      processBusinessDiscoveryJob(
        database,
        createQueue() as never,
        createRegistry(provider) as never,
        {
          id: fixture.jobId,
          data: {
            jobId: fixture.jobId,
            workspaceId: fixture.workspace.id,
            campaignId: randomUUID(),
            searchTaskId: fixture.task.id,
            campaignVersion: fixture.campaign.updatedAt.toISOString(),
            pageNumber: '2',
          },
        },
      ),
    ).rejects.toThrow();
    expect(provider.searchBusinesses).not.toHaveBeenCalled();
  });

  it('marks only the failing SearchTask failed and records provider error usage', async () => {
    const fixture = await createFixture(database);
    workspaceIds.push(fixture.workspace.id);
    userIds.push(fixture.user.id);
    const provider = createProvider([], new Error('provider unavailable'));

    await expect(
      processBusinessDiscoveryJob(
        database,
        createQueue() as never,
        createRegistry(provider) as never,
        {
          id: fixture.jobId,
          data: {
            jobId: fixture.jobId,
            workspaceId: fixture.workspace.id,
            campaignId: fixture.campaign.id,
            searchTaskId: fixture.task.id,
            campaignVersion: fixture.campaign.updatedAt.toISOString(),
            pageNumber: '1',
          },
        },
      ),
    ).rejects.toThrow('provider unavailable');

    await expect(
      database.searchTask.findUniqueOrThrow({ where: { id: fixture.task.id } }),
    ).resolves.toMatchObject({ status: SearchTaskStatus.FAILED, attemptCount: 1 });
    await expect(
      database.providerUsage.findUniqueOrThrow({
        where: {
          campaignId_provider: {
            campaignId: fixture.campaign.id,
            provider: 'google-maps-browser',
          },
        },
      }),
    ).resolves.toMatchObject({ requestCount: 1, resultCount: 0, errorCount: 1 });
    await expect(
      database.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } }),
    ).resolves.toMatchObject({ status: CampaignStatus.DISCOVERING });
  });
});