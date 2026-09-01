import { describe, expect, it, vi } from 'vitest';
import { processCampaignPlanJob } from '../src/campaign-plan.processor.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const campaignId = '00000000-0000-4000-8000-000000000003';

function createDb() {
  const updates: Array<Record<string, unknown>> = [];
  const campaignFindFirst = vi.fn(async () => ({
    id: campaignId,
    workspaceId,
    createdByUserId: '00000000-0000-4000-8000-000000000004',
    name: 'US Dentists',
    country: 'United States',
    region: null,
    city: null,
    niche: 'Dentist',
    requestedLeadCount: 10_000,
    status: 'PLANNING',
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const searchPlanUpsert = vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000005' }));
  const searchTaskCreateMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));

  return {
    updates,
    campaignFindFirst,
    searchPlanUpsert,
    searchTaskCreateMany,
    client: {
      jobMetadata: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return data;
        }),
      },
      campaign: { findFirst: campaignFindFirst },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          searchPlan: { upsert: searchPlanUpsert },
          searchTask: { createMany: searchTaskCreateMany },
        }),
      ),
    },
  };
}

describe('processCampaignPlanJob', () => {
  it('tracks one successful injected campaign planning attempt with identifier-only payload', async () => {
    const db = createDb();
    const task = vi.fn(async () => undefined);

    await processCampaignPlanJob(
      db.client as never,
      { id: jobId, data: { jobId, workspaceId, campaignId } },
      task,
    );

    expect(task).toHaveBeenCalledWith({ jobId, workspaceId, campaignId });
    expect(Object.keys(task.mock.calls[0]![0]).sort()).toEqual(['campaignId', 'jobId', 'workspaceId']);
    expect(db.updates).toHaveLength(2);
    expect(db.updates[0]).toMatchObject({ status: 'RUNNING', attempts: { increment: 1 } });
    expect(db.updates[1]).toMatchObject({ status: 'COMPLETED', failureReason: null });
  });

  it('uses the production search planner when no task override is provided', async () => {
    const db = createDb();

    await processCampaignPlanJob(
      db.client as never,
      { id: jobId, data: { jobId, workspaceId, campaignId } },
    );

    expect(db.campaignFindFirst).toHaveBeenCalledWith({
      where: { id: campaignId, workspaceId },
    });
    expect(db.searchPlanUpsert).toHaveBeenCalledTimes(1);
    expect(db.searchTaskCreateMany).toHaveBeenCalledTimes(1);
    expect(db.updates.at(-1)).toMatchObject({ status: 'COMPLETED', failureReason: null });
  });
});
