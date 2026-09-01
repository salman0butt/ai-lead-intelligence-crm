import { describe, expect, it, vi } from 'vitest';
import { PgBossQueueService } from '../../../packages/queue/src/pg-boss-queue.service.js';

function metadata(jobId = '00000000-0000-4000-8000-000000000001') {
  return {
    jobId,
    queue: 'system-test',
    status: 'QUEUED' as const,
    workspaceId: '00000000-0000-4000-8000-000000000002',
    idempotencyKey: null,
    attempts: 0,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    startedAt: null,
    finishedAt: null,
    failureReason: null,
  };
}

function createDatabase(existing = metadata(), duplicateReservation = false) {
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  const deletes: unknown[] = [];
  return {
    creates,
    updates,
    deletes,
    client: {
      jobMetadata: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (duplicateReservation) throw new Error('unique violation');
          creates.push(data);
          return { ...existing, ...data };
        },
        findFirst: async () => existing,
        findUnique: async () => existing,
        update: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { ...existing, ...(data as object) };
        },
        delete: async ({ where }: { where: unknown }) => {
          deletes.push(where);
          return existing;
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
  const workers: Array<{ name: string; options: Record<string, unknown> }> = [];

  return {
    queues,
    sends,
    cancellations,
    retries,
    workers,
    client: {
      on: () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
      createQueue: async (name: string, options: unknown) => {
        queues.push({ name, options });
      },
      send: async (name: string, data: unknown, options: Record<string, unknown>) => {
        sends.push({ name, data, options });
        return String(options.id);
      },
      cancel: async (name: string, id: string) => {
        cancellations.push({ name, id });
      },
      retry: async (name: string, id: string) => {
        retries.push({ name, id });
      },
      work: async (
        name: string,
        options: Record<string, unknown>,
        handler: (jobs: Array<{ id: string; data: Record<string, string> }>) => Promise<void>,
      ) => {
        workers.push({ name, options });
        await handler([
          {
            id: '00000000-0000-4000-8000-000000000001',
            data: {
              jobId: '00000000-0000-4000-8000-000000000001',
              workspaceId: '00000000-0000-4000-8000-000000000002',
            },
          },
        ]);
        return 'worker-1';
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
        notify: true,
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

  it('reserves metadata before enqueueing identifier-only payloads', async () => {
    const db = createDatabase();
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    const result = await queue.enqueue(
      'system-test',
      { workspaceId: '00000000-0000-4000-8000-000000000002' },
      { idempotencyKey: 'test:workspace:1', priority: 7 },
    );

    expect(result.jobId).toBeTruthy();
    expect(db.creates).toHaveLength(1);
    expect(boss.sends).toHaveLength(1);
    expect(boss.sends[0]).toMatchObject({
      name: 'system-test',
      data: { workspaceId: '00000000-0000-4000-8000-000000000002' },
      options: {
        singletonKey: 'test:workspace:1',
        priority: 7,
        retryLimit: 3,
        retryBackoff: true,
        retryDelayMax: 300,
        expireInSeconds: 900,
      },
    });
    expect((boss.sends[0]?.data as { jobId?: string }).jobId).toBe(result.jobId);
  });

  it('does not send retryDelayMax when exponential backoff is disabled', async () => {
    const db = createDatabase();
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    await queue.enqueue(
      'system-test',
      { workspaceId: metadata().workspaceId },
      { retryBackoff: false, retryDelay: 1 },
    );

    expect(boss.sends[0]?.options.retryBackoff).toBe(false);
    expect(boss.sends[0]?.options.retryDelay).toBe(1);
    expect(boss.sends[0]?.options).not.toHaveProperty('retryDelayMax');
  });

  it('returns existing metadata when the database idempotency reservation conflicts', async () => {
    const existing = metadata();
    const db = createDatabase(existing, true);
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    const result = await queue.enqueue(
      'system-test',
      { workspaceId: existing.workspaceId },
      { idempotencyKey: 'same-job' },
    );

    expect(result.jobId).toBe(existing.jobId);
    expect(boss.sends).toHaveLength(0);
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

  it('suffixes bulk idempotency keys and registers v12 local-concurrency workers', async () => {
    const db = createDatabase();
    const boss = createBoss();
    const queue = new PgBossQueueService('postgresql://unused', db.client as never, boss.client as never);

    await queue.enqueueBulk(
      'system-test',
      [{ workspaceId: metadata().workspaceId }, { workspaceId: metadata().workspaceId }],
      { idempotencyKey: 'bulk' },
    );

    expect(boss.sends[0]?.options.singletonKey).toBe('bulk:0');
    expect(boss.sends[1]?.options.singletonKey).toBe('bulk:1');

    const handler = vi.fn(async () => undefined);
    await queue.work('system-test', handler);
    expect(boss.workers[0]).toMatchObject({
      name: 'system-test',
      options: { localConcurrency: 1, pollingIntervalSeconds: 1 },
    });
    expect(handler).toHaveBeenCalledOnce();
  });
});
