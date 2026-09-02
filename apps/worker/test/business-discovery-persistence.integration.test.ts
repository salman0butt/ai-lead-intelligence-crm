import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CampaignStatus, createPrismaClient } from '@ai-crm/database';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('business discovery persistence', () => {
  const database = createPrismaClient(databaseUrl!);
  const campaignIds: string[] = [];
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterEach(async () => {
    if (campaignIds.length) {
      await database.campaign.deleteMany({ where: { id: { in: campaignIds.splice(0) } } });
    }
    if (userIds.length) {
      await database.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
    if (workspaceIds.length) {
      await database.workspace.deleteMany({ where: { id: { in: workspaceIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it('persists browser cursor, normalized candidates, provenance, and usage defaults with exact uniqueness', async () => {
    const suffix = randomUUID();
    const user = await database.user.create({
      data: {
        email: `discovery-persistence-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'Discovery Persistence User',
      },
    });
    userIds.push(user.id);

    const workspace = await database.workspace.create({
      data: { name: `Discovery Persistence ${suffix}` },
    });
    workspaceIds.push(workspace.id);

    const campaign = await database.campaign.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        name: 'Austin Dentists',
        country: 'United States',
        region: 'Texas',
        city: 'Austin',
        niche: 'Dentist',
        requestedLeadCount: 10_000,
        status: CampaignStatus.PLANNING,
      },
    });
    campaignIds.push(campaign.id);

    const plan = await database.searchPlan.create({
      data: {
        workspaceId: workspace.id,
        campaignId: campaign.id,
        tasks: {
          create: {
            country: 'United States',
            region: 'Texas',
            city: 'Austin',
            query: 'Dentist',
            provider: 'google-maps-browser',
          },
        },
      },
      include: { tasks: true },
    });
    const task = plan.tasks[0]!;

    expect(task.pageNumber).toBe(1);
    expect(task.continuationCursor).toBeNull();

    const candidate = await database.businessCandidate.create({
      data: {
        workspaceId: workspace.id,
        campaignId: campaign.id,
        provider: 'google-maps-browser',
        providerExternalId: 'maps-url-sha256:place-1',
        name: 'Example Dental',
        formattedAddress: '123 Main St, Austin, TX',
        category: 'dentist',
        latitude: 30.1,
        longitude: -97.7,
        rawReference: 'https://www.google.com/maps/place/example-dental',
      },
    });

    const source = await database.businessSource.create({
      data: {
        businessCandidateId: candidate.id,
        searchTaskId: task.id,
        provider: 'google-maps-browser',
        providerExternalId: 'maps-url-sha256:place-1',
        rawPayload: { name: 'Example Dental' },
      },
    });

    const usage = await database.providerUsage.create({
      data: {
        workspaceId: workspace.id,
        campaignId: campaign.id,
        provider: 'google-maps-browser',
      },
    });

    expect(source.searchTaskId).toBe(task.id);
    expect(usage).toMatchObject({
      requestCount: 0,
      resultCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      costAmount: null,
      costCurrency: null,
    });

    await expect(
      database.businessCandidate.create({
        data: {
          workspaceId: workspace.id,
          campaignId: campaign.id,
          provider: 'google-maps-browser',
          providerExternalId: 'maps-url-sha256:place-1',
          name: 'Duplicate Example Dental',
          formattedAddress: '123 Main St, Austin, TX',
        },
      }),
    ).rejects.toThrow();

    await expect(
      database.businessSource.create({
        data: {
          businessCandidateId: candidate.id,
          searchTaskId: task.id,
          provider: 'google-maps-browser',
          providerExternalId: 'maps-url-sha256:place-1',
          rawPayload: { name: 'Example Dental' },
        },
      }),
    ).rejects.toThrow();
  });
});
