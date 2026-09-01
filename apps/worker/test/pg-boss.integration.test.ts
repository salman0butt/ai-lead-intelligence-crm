import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type DatabaseClient } from '@ai-crm/database';
import { PgBossQueueService } from '@ai-crm/queue';
import { processSystemTestJob } from '../src/system-test.processor.js';

const databaseUrl = process.env['DATABASE_URL'];
const integration = databaseUrl ? describe.sequential : describe.skip;

async function waitForJob(
  database: DatabaseClient,
  jobId: string,
  predicate: (job: NonNullable<Awaited<ReturnType<DatabaseClient['jobMetadata']['findUnique']>>>) => boolean,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await database.jobMetadata.findUnique({ where: { jobId } });
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

integration('pg-boss PostgreSQL integration', () => {
  let database: DatabaseClient;
  let workspaceId: string;

  beforeAll(async () => {
    database = createPrismaClient(databaseUrl!);
    await database.$connect();
    const workspace = await database.workspace.create({
      data: { name: `M1 Integration ${randomUUID()}` },
    });
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    if (workspaceId) {
      await database.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
    }
    await database.$disconnect();
  });

  it('keeps a queued job durable after the producer stops and lets an independent worker complete it', async () => {
    const producer = new PgBossQueueService(databaseUrl!, database);
    await producer.start();
    const queued = await producer.enqueue(
      'system-test',
      { workspaceId },
      { idempotencyKey: `durability:${randomUUID()}`, retryLimit: 0 },
    );
    await producer.stop();

    const worker = new PgBossQueueService(databaseUrl!, database);
    await worker.start();
    await worker.work('system-test', async (job) => processSystemTestJob(database, job));

    const completed = await waitForJob(database, queued.jobId, (job) => job.status === 'COMPLETED');
    expect(completed.attempts).toBe(1);
    expect(completed.finishedAt).toBeInstanceOf(Date);

    await worker.stop();
  }, 30_000);

  it('returns one persisted job for duplicate scheduling with the same workspace-scoped key', async () => {
    const queue = new PgBossQueueService(databaseUrl!, database);
    await queue.start();
    const key = `duplicate:${randomUUID()}`;

    const first = await queue.enqueue('system-test', { workspaceId }, { idempotencyKey: key, retryLimit: 0 });
    const second = await queue.enqueue('system-test', { workspaceId }, { idempotencyKey: key, retryLimit: 0 });

    expect(second.jobId).toBe(first.jobId);
    await expect(
      database.jobMetadata.count({ where: { queue: 'system-test', workspaceId, idempotencyKey: key } }),
    ).resolves.toBe(1);

    await queue.cancel('system-test', first.jobId);
    await queue.stop();
  }, 30_000);

  it('retries failed work and records every attempt before eventually completing', async () => {
    const queue = new PgBossQueueService(databaseUrl!, database);
    await queue.start();
    let invocations = 0;
    await queue.work('system-test', async (job) =>
      processSystemTestJob(database, job, async () => {
        invocations += 1;
        if (invocations < 3) throw new Error(`retry-${invocations}`);
      }),
    );

    const queued = await queue.enqueue(
      'system-test',
      { workspaceId },
      {
        idempotencyKey: `retry:${randomUUID()}`,
        retryLimit: 2,
        retryDelay: 1,
        retryBackoff: true,
      },
    );

    const completed = await waitForJob(
      database,
      queued.jobId,
      (job) => job.status === 'COMPLETED' && job.attempts === 3,
    );
    expect(completed.failureReason).toBeNull();
    expect(invocations).toBe(3);

    await queue.stop();
  }, 30_000);

  it('keeps terminal failures visible after retries are exhausted', async () => {
    const queue = new PgBossQueueService(databaseUrl!, database);
    await queue.start();
    await queue.work('system-test', async (job) =>
      processSystemTestJob(database, job, async () => {
        throw new Error('terminal-system-test-failure');
      }),
    );

    const queued = await queue.enqueue(
      'system-test',
      { workspaceId },
      {
        idempotencyKey: `failure:${randomUUID()}`,
        retryLimit: 1,
        retryDelay: 1,
        retryBackoff: true,
      },
    );

    const failed = await waitForJob(
      database,
      queued.jobId,
      (job) => job.status === 'FAILED' && job.attempts >= 2,
    );
    expect(failed.attempts).toBe(2);
    expect(failed.failureReason).toBe('terminal-system-test-failure');
    expect(failed.finishedAt).toBeInstanceOf(Date);

    await queue.stop();
  }, 30_000);
});
