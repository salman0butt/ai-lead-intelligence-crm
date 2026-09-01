import { describe, expect, it, vi } from 'vitest';
import { processCampaignPlanJob, type CampaignPlanPayload } from '../src/campaign-plan.processor.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const campaignId = '00000000-0000-4000-8000-000000000003';
const searchPlanId = '00000000-0000-4000-8000-000000000005';
const taskOneId = '00000000-0000-4000-8000-000000000006';
const taskTwoId = '00000000-0000-4000-8000-000000000007';
const planningVersion = new Date('2026-09-01T18:20:00.000Z');
const discoveringVersion = new Date('2026-09-01T18:21:00.000Z');

type Status = 'PLANNING' | 'DISCOVERING' | 'PAUSED' | 'CANCELLED';

type EnqueueArgs = [
  queue: string,
  payload: Record<string, string>,
  options: { idempotencyKey: string },
];

function createQueue() {
  return {
    enqueue: vi.fn(async (...args: EnqueueArgs) => {
      const [queue] = args;
      return {
        jobId: '00000000-0000-4000-8000-000000000010',
        queue: queue as 'campaign-discovery',
        status: 'QUEUED' as const,
        workspaceId,
        attempts: 0,
        createdAt: planningVersion,
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      };
    }),
  };
}

function createCampaign(status: Status, updatedAt = planningVersion) {
  return {
    id: campaignId,
    workspaceId,
    createdByUserId: '00000000-0000-4000-8000-000000000004',
    name: 'US Dentists',
    country: 'United States',
    region: null,
    city: null,
    niche: 'Dentist',
    requestedLeadCount: 10_000,
    status,
    createdAt: planningVersion,
    updatedAt,
  };
}

function createDb(options: { initialStatus?: Status; statusAfterPlanning?: Status } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  let campaign = createCampaign(options.initialStatus ?? 'PLANNING');
  let planningComplete = false;

  const campaignFindFirst = vi.fn(async () => ({ ...campaign }));
  const campaignFindUnique = vi.fn(async () => {
    if (planningComplete && options.statusAfterPlanning) {
      campaign = createCampaign(options.statusAfterPlanning, discoveringVersion);
    }
    return { ...campaign };
  });
  const campaignUpdateMany = vi.fn(async ({ where, data }: {
    where: { id: string; workspaceId: string; status: Status };
    data: { status: Status };
  }) => {
    if (
      where.id !== campaignId
      || where.workspaceId !== workspaceId
      || campaign.status !== where.status
    ) return { count: 0 };

    campaign = createCampaign(data.status, discoveringVersion);
    return { count: 1 };
  });
  const searchPlanUpsert = vi.fn(async () => ({ id: searchPlanId }));
  const searchTaskCreateMany = vi.fn(async ({ data }: { data: unknown[] }) => {
    planningComplete = true;
    return { count: data.length };
  });
  const searchTaskFindMany = vi.fn(async () => [
    { id: taskOneId, pageNumber: 1 },
    { id: taskTwoId, pageNumber: 2 },
  ]);

  const db = {
    jobMetadata: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return data;
      }),
    },
    campaign: {
      findFirst: campaignFindFirst,
      findUnique: campaignFindUnique,
      updateMany: campaignUpdateMany,
    },
    searchTask: { findMany: searchTaskFindMany },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        searchPlan: { upsert: searchPlanUpsert },
        searchTask: { createMany: searchTaskCreateMany },
      }),
    ),
  };

  return {
    updates,
    campaignFindFirst,
    campaignFindUnique,
    campaignUpdateMany,
    searchPlanUpsert,
    searchTaskCreateMany,
    searchTaskFindMany,
    client: db,
    getCampaign: () => ({ ...campaign }),
  };
}

type DesiredProcessor = (
  database: never,
  queue: never,
  job: { id: string; data: CampaignPlanPayload },
  task?: (payload: CampaignPlanPayload) => Promise<void>,
) => Promise<void>;

const runProcessor = processCampaignPlanJob as unknown as DesiredProcessor;

describe('processCampaignPlanJob', () => {
  it('tracks one successful injected campaign planning attempt with identifier-only payload', async () => {
    const db = createDb();
    const queue = createQueue();
    const task = vi.fn(async (...args: [CampaignPlanPayload]) => {
      void args;
    });

    await runProcessor(
      db.client as never,
      queue as never,
      { id: jobId, data: { jobId, workspaceId, campaignId } },
      task,
    );

    const payload = task.mock.calls[0]?.[0];
    expect(payload).toEqual({ jobId, workspaceId, campaignId });
    expect(Object.keys(payload!).sort()).toEqual(['campaignId', 'jobId', 'workspaceId']);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(2);
    expect(db.updates[0]).toMatchObject({ status: 'RUNNING', attempts: { increment: 1 } });
    expect(db.updates[1]).toMatchObject({ status: 'COMPLETED', failureReason: null });
  });

  it('plans, transitions to DISCOVERING, and schedules each unfinished SearchTask with the transition generation', async () => {
    const db = createDb();
    const queue = createQueue();

    await runProcessor(
      db.client as never,
      queue as never,
      { id: jobId, data: { jobId, workspaceId, campaignId } },
    );

    expect(db.campaignFindFirst).toHaveBeenCalledWith({
      where: { id: campaignId, workspaceId },
    });
    expect(db.searchPlanUpsert).toHaveBeenCalledTimes(1);
    expect(db.searchTaskCreateMany).toHaveBeenCalledTimes(1);
    expect(db.campaignUpdateMany).toHaveBeenCalledWith({
      where: { id: campaignId, workspaceId, status: 'PLANNING' },
      data: { status: 'DISCOVERING' },
    });
    expect(db.getCampaign().status).toBe('DISCOVERING');
    expect(db.searchTaskFindMany).toHaveBeenCalledWith({
      where: { searchPlanId, status: { in: ['PENDING', 'FAILED'] } },
      select: { id: true, pageNumber: true },
      orderBy: { id: 'asc' },
    });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenNthCalledWith(
      1,
      'campaign-discovery',
      {
        workspaceId,
        campaignId,
        searchTaskId: taskOneId,
        campaignVersion: discoveringVersion.toISOString(),
        pageNumber: '1',
      },
      {
        idempotencyKey:
          `campaign-discovery:${taskOneId}:${discoveringVersion.toISOString()}:page:1`,
      },
    );
    expect(db.updates.at(-1)).toMatchObject({ status: 'COMPLETED', failureReason: null });
  });

  it('replays an already DISCOVERING campaign without changing its generation', async () => {
    const db = createDb({ initialStatus: 'DISCOVERING' });
    const queue = createQueue();

    await runProcessor(
      db.client as never,
      queue as never,
      { id: jobId, data: { jobId, workspaceId, campaignId } },
    );

    expect(db.campaignUpdateMany).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue.mock.calls[0]![1].campaignVersion).toBe(planningVersion.toISOString());
  });

  it.each(['PAUSED', 'CANCELLED'] as const)(
    'does not schedule discovery when the campaign becomes %s after planning',
    async (status) => {
      const db = createDb({ statusAfterPlanning: status });
      const queue = createQueue();

      await runProcessor(
        db.client as never,
        queue as never,
        { id: jobId, data: { jobId, workspaceId, campaignId } },
      );

      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(db.searchTaskFindMany).not.toHaveBeenCalled();
      expect(db.updates.at(-1)).toMatchObject({ status: 'COMPLETED', failureReason: null });
    },
  );
});
