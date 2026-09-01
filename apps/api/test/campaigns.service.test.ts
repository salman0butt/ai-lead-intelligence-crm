import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CampaignsService } from '../src/campaigns/campaigns.service.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const campaignId = '00000000-0000-4000-8000-000000000003';
const createdAt = new Date('2026-09-01T00:00:00Z');

type Status = 'DRAFT' | 'PLANNING' | 'PAUSED' | 'CANCELLED';

function createCampaign(status: Status = 'DRAFT') {
  return {
    id: campaignId,
    workspaceId,
    createdByUserId: userId,
    name: 'Oslo Dentists',
    country: 'Norway',
    region: null,
    city: 'Oslo',
    niche: 'Dentist',
    requestedLeadCount: 25000,
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

function createDb(options: { member?: boolean; status?: Status } = {}) {
  let campaign = createCampaign(options.status);
  const member = options.member ?? true;

  const statusMatches = (expected: unknown) => {
    if (typeof expected === 'string') return campaign.status === expected;
    if (expected && typeof expected === 'object' && 'in' in expected) {
      return Array.isArray((expected as { in?: unknown }).in)
        && (expected as { in: string[] }).in.includes(campaign.status);
    }
    return true;
  };

  const db = {
    workspaceMember: {
      findUnique: vi.fn(async () => (member ? { workspaceId, userId } : null)),
    },
    campaign: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...createCampaign(),
        ...data,
        region: data.region ?? null,
        city: data.city ?? null,
      })),
      findMany: vi.fn(async () => [{ ...campaign }]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (
        where.id === campaignId ? { ...campaign } : null
      )),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; workspaceId: string; status?: unknown };
        data: { status: Status };
      }) => {
        if (where.id !== campaignId || where.workspaceId !== workspaceId || !statusMatches(where.status)) {
          return { count: 0 };
        }
        campaign = { ...campaign, status: data.status, updatedAt: new Date() };
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (operation: (client: typeof db) => Promise<unknown>) => operation(db));

  return { db, getCampaign: () => ({ ...campaign }) };
}

type EnqueueArgs = [
  queue: string,
  payload: { workspaceId: string; campaignId: string },
  options: { idempotencyKey: string },
];

function createQueue(error?: Error) {
  return {
    enqueue: vi.fn(async (...args: EnqueueArgs) => {
      void args;
      if (error) throw error;
      return {
        jobId: '00000000-0000-4000-8000-000000000004',
        queue: 'campaign-plan' as const,
        status: 'QUEUED' as const,
        workspaceId,
        attempts: 0,
        createdAt,
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      };
    }),
  };
}

const input = {
  workspaceId,
  name: 'Oslo Dentists',
  country: 'Norway',
  region: undefined,
  city: 'Oslo',
  niche: 'Dentist',
  requestedLeadCount: 25000,
};

describe('CampaignsService', () => {
  it('rejects campaign creation outside the user workspace', async () => {
    const { db } = createDb({ member: false });
    const queue = createQueue();
    const service = new CampaignsService(db as never, queue as never);

    await expect(service.create(userId, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.campaign.create).not.toHaveBeenCalled();
  });

  it('creates and lists campaigns only after workspace membership validation', async () => {
    const { db } = createDb();
    const queue = createQueue();
    const service = new CampaignsService(db as never, queue as never);

    const created = await service.create(userId, input);
    const listed = await service.list(userId, workspaceId);

    expect(created).toMatchObject({ status: 'DRAFT', requestedLeadCount: 25000, region: null });
    expect(db.campaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId,
        createdByUserId: userId,
        requestedLeadCount: 25000,
        region: null,
      }),
    });
    expect(db.campaign.findMany).toHaveBeenCalledWith({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    expect(listed).toHaveLength(1);
  });

  it('rejects viewing a campaign whose workspace is inaccessible', async () => {
    const { db } = createDb({ member: false });
    const service = new CampaignsService(db as never, createQueue() as never);

    await expect(service.get(userId, campaignId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('starts a draft campaign atomically and schedules an identifier-only planning job', async () => {
    const { db } = createDb();
    const queue = createQueue();
    const service = new CampaignsService(db as never, queue as never);

    const result = await service.start(userId, campaignId);

    expect(db.$transaction).toHaveBeenCalled();
    expect(result.campaign.status).toBe('PLANNING');
    expect(queue.enqueue).toHaveBeenCalledWith(
      'campaign-plan',
      { workspaceId, campaignId },
      { idempotencyKey: `campaign-plan:${campaignId}` },
    );
    expect(Object.keys(queue.enqueue.mock.calls[0]![1]).sort()).toEqual(['campaignId', 'workspaceId']);
  });

  it('rolls a planning transition back to draft when queue publication fails', async () => {
    const { db, getCampaign } = createDb();
    const queue = createQueue(new Error('queue unavailable'));
    const service = new CampaignsService(db as never, queue as never);

    await expect(service.start(userId, campaignId)).rejects.toThrow('queue unavailable');
    expect(getCampaign().status).toBe('DRAFT');
    expect(db.campaign.updateMany).toHaveBeenCalledTimes(2);
  });

  it('enforces pause, resume, and cancel lifecycle transitions with conflicts for stale states', async () => {
    const planning = createDb({ status: 'PLANNING' });
    const service = new CampaignsService(planning.db as never, createQueue() as never);

    expect((await service.pause(userId, campaignId)).status).toBe('PAUSED');
    expect((await service.resume(userId, campaignId)).status).toBe('PLANNING');
    expect((await service.cancel(userId, campaignId)).status).toBe('CANCELLED');
    await expect(service.pause(userId, campaignId)).rejects.toBeInstanceOf(ConflictException);
  });
});
