import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createPrismaClient, SearchTaskStatus } from '@ai-crm/database';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('search plan persistence', () => {
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

  it('persists search task planning fields with resumable defaults', async () => {
    const suffix = randomUUID();
    const user = await database.user.create({
      data: {
        email: `search-plan-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'Search Planner User',
      },
    });
    userIds.push(user.id);

    const workspace = await database.workspace.create({
      data: { name: `Search Planner ${suffix}` },
    });
    workspaceIds.push(workspace.id);

    const campaign = await database.campaign.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        name: 'US Dentists',
        country: 'United States',
        niche: 'Dentist',
        requestedLeadCount: 10_000,
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
            region: 'California',
            city: '',
            geographicCell: '',
            query: 'Dentist',
            provider: 'google-places',
          },
        },
      },
      include: { tasks: true },
    });

    expect(plan.campaignId).toBe(campaign.id);
    expect(plan.workspaceId).toBe(workspace.id);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      country: 'United States',
      region: 'California',
      city: '',
      geographicCell: '',
      query: 'Dentist',
      provider: 'google-places',
      status: SearchTaskStatus.PENDING,
      attemptCount: 0,
      resultCount: 0,
      uniqueBusinessCount: 0,
    });
  });
});
