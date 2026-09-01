import { describe, expect, it } from 'vitest';
import { PgBossQueueService } from '../../../packages/queue/src/pg-boss-queue.service.js';

function metadata(jobId = '00000000-0000-4000-8000-000000000001') {
  return {
    jobId,
    queue: 'system-test',
    status: 'QUEUED' as const,
    workspaceId: '00000000-0000-4000-8000-000000000002',
    attempts: 0,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    startedAt: null,
    finishedAt: null,
    failureReason: null,
  };
}

function createDatabase(existing = metadata()) {
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  return {
    creates,
    updates,
    client: {
      jobMetadata: {
        create: async ({ data }: { data: unknown }) => {
          creates.push(data);
          return existing;
        },
        findUnique: async () => existing,
        update: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { ...existing, ...(data as object) };
        },
      },
    },
  };
}

function createBoss() {
  const queues: Array<{ name: string; options: unknown }> = [];
  const sends: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const cancellations: Array<{ name: string; id: string }> = [];
  const retries: Array<{ name: string; id: string }> = [];
  let duplicate = false;

  return {
    queues,
    sends,
    cancellations,
    retries,
    setDuplicate(value: boolean) {
      duplicate = value;
    },
    client: {
      on: () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
      createQueue: async (name: string, options: unknown) => {
        queues.push({ name, options });
      },
      send: async (name: string, data: unknown, options: Record<string, unknown>) => {
        sends.push({ name, data, options });
        return duplicate ? null : String(options.id);
      },
      findJobs: async () => [{ id: '00000000-0000-4000-8000-000000000001' }],
      cancel: async (name: string, id: string) => {
        cancellations.push({ name, id });
      },
      retry: async (name: string, id: string) => {
        retries.push({ name, id });
      },
    },
  };
}

describe('PgBossQueueService', () => {
  it('creates dead-letter queues before their application queues', async () => {
    const db = createDatabase();
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    await queue.start();

    expect(boss.queues[0]?.name).toBe('system-test-dlq');
    expect(boss.queues[1]).toMatchObject({
      name: 'system-test',
      options: {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        retryDelayMax: 300,
        expireInSeconds: 900,
        heartbeatSeconds: 60,
        deadLetter: 'system-test-dlq',
      },
    });
  });

  it('enqueues identifier-only payloads with priority and singleton idempotency', async () => {
    const db = createDatabase();
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    const result = await queue.enqueue(
      'system-test',
      { workspaceId: '00000000-0000-4000-8000-000000000002' },
      { idempotencyKey: 'test:workspace:1', priority: 7 },
    );

    expect(result.jobId).toBeTruthy();
    expect(boss.sends).toHaveLength(1);
    expect(boss.sends[0]).toMatchObject({
      name: 'system-test',
      data: {
        workspaceId: '00000000-0000-4000-8000-000000000002',
      },
      options: {
        singletonKey: 'test:workspace:1',
        priority: 7,
        retryLimit: 3,
        retryBackoff: true,
        expireInSeconds: 900,
      },
    });
    expect((boss.sends[0]?.data as { jobId?: string }).jobId).toBe(result.jobId);
    expect(db.creates).toHaveLength(1);
  });

  it('returns existing metadata when a singleton duplicate is rejected by pg-boss', async () => {
    const existing = metadata();
    const db = createDatabase(existing);
    const boss = createBoss();
    boss.setDuplicate(true);
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    const result = await queue.enqueue(
      'system-test',
      { workspaceId: existing.workspaceId },
      { idempotencyKey: 'same-job' },
    );

    expect(result.jobId).toBe(existing.jobId);
    expect(db.creates).toHaveLength(0);
  });

  it('supports scheduled jobs, cancellation, retry, and status lookup', async () => {
    const existing = metadata();
    const db = createDatabase(existing);
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);
    const runAt = new Date('2026-09-02T10:00:00Z');

    await queue.schedule('system-test', { workspaceId: existing.workspaceId }, runAt);
    expect(boss.sends[0]?.options.startAfter).toEqual(runAt);

    await queue.cancel('system-test', existing.jobId);
    expect(boss.cancellations).toEqual([{ name: 'system-test', id: existing.jobId }]);

    await queue.retry('system-test', existing.jobId);
    expect(boss.retries).toEqual([{ name: 'system-test', id: existing.jobId }]);

    await expect(queue.getStatus('system-test', existing.jobId)).resolves.toMatchObject({ jobId: existing.jobId });
  });
});
