import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CampaignStatus, createPrismaClient, SearchTaskStatus, type DatabaseClient } from '@ai-crm/database';
import { planCampaignSearch } from '../src/search-planner/search-planner.js';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('search planner integration', () => {
  let database: DatabaseClient;
  let userId: string;
  let workspaceId: string;
  const campaignIds: string[] = [];

  beforeAll(async () => {
    database = createPrismaClient(databaseUrl!);
    await database.$connect();

    const suffix = randomUUID();
    const user = await database.user.create({
      data: {
        email: `planner-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'Planner User',
      },
    });
    userId = user.id;

    const workspace = await database.workspace.create({
      data: { name: `Planner Workspace ${suffix}` },
    });
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    if (campaignIds.length) {
      await database.campaign.deleteMany({ where: { id: { in: campaignIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    if (userId) await database.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (workspaceId) await database.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
    await database.$disconnect();
  });

  async function createCampaign(status: CampaignStatus) {
    const campaign = await database.campaign.create({
      data: {
        workspaceId,
        createdByUserId: userId,
        name: `US Dentists ${randomUUID()}`,
        country: 'United States',
        niche: 'Dentist',
        requestedLeadCount: 10_000,
        status,
      },
    });
    campaignIds.push(campaign.id);
    return campaign;
  }

  it('creates browser discovery tasks and preserves completed task state across planner replay', async () => {
    const campaign = await createCampaign(CampaignStatus.PLANNING);

    const first = await planCampaignSearch(database, {
      workspaceId,
      campaignId: campaign.id,
    });

    expect(first.skipped).toBe(false);
    expect(first.searchPlanId).toEqual(expect.any(String));
    expect(first.generatedTaskCount).toBeGreaterThan(7);
    expect(first.insertedTaskCount).toBe(first.generatedTaskCount);
    await expect(database.searchPlan.count({ where: { campaignId: campaign.id } })).resolves.toBe(1);

    const tasks = await database.searchTask.findMany({
      where: { searchPlan: { campaignId: campaign.id } },
      orderBy: { id: 'asc' },
    });
    expect(tasks).toHaveLength(first.generatedTaskCount);
    expect(new Set(tasks.map((task) => task.provider))).toEqual(new Set(['google-maps-browser']));
    expect(tasks.every((task) => task.status === SearchTaskStatus.PENDING)).toBe(true);
    expect(tasks.every((task) => task.attemptCount === 0)).toBe(true);
    expect(tasks.every((task) => task.resultCount === 0)).toBe(true);
    expect(tasks.every((task) => task.uniqueBusinessCount === 0)).toBe(true);

    const completedTask = tasks[0]!;
    await database.searchTask.update({
      where: { id: completedTask.id },
      data: {
        status: SearchTaskStatus.COMPLETED,
        attemptCount: 2,
        resultCount: 20,
        uniqueBusinessCount: 17,
      },
    });

    const replay = await planCampaignSearch(database, {
      workspaceId,
      campaignId: campaign.id,
    });

    expect(replay.searchPlanId).toBe(first.searchPlanId);
    expect(replay.generatedTaskCount).toBe(first.generatedTaskCount);
    expect(replay.insertedTaskCount).toBe(0);
    await expect(
      database.searchTask.count({ where: { searchPlan: { campaignId: campaign.id } } }),
    ).resolves.toBe(tasks.length);

    const preserved = await database.searchTask.findUniqueOrThrow({ where: { id: completedTask.id } });
    expect(preserved).toMatchObject({
      status: SearchTaskStatus.COMPLETED,
      attemptCount: 2,
      resultCount: 20,
      uniqueBusinessCount: 17,
    });
  });

  it('rejects a workspace/campaign identifier mismatch', async () => {
    const campaign = await createCampaign(CampaignStatus.PLANNING);

    await expect(
      planCampaignSearch(database, {
        workspaceId: randomUUID(),
        campaignId: campaign.id,
      }),
    ).rejects.toThrow('Campaign not found for search planning');
  });

  it('skips cancelled campaigns without creating search space', async () => {
    const campaign = await createCampaign(CampaignStatus.CANCELLED);

    await expect(
      planCampaignSearch(database, { workspaceId, campaignId: campaign.id }),
    ).resolves.toEqual({
      searchPlanId: null,
      generatedTaskCount: 0,
      insertedTaskCount: 0,
      skipped: true,
    });

    await expect(database.searchPlan.count({ where: { campaignId: campaign.id } })).resolves.toBe(0);
  });
});
