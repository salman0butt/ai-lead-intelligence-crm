import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CampaignStatus, createPrismaClient, type DatabaseClient } from '@ai-crm/database';
import { PgBossQueueService } from '@ai-crm/queue';
import { processCampaignPlanJob } from '../src/campaign-plan.processor.js';
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
  let userId: string;

  beforeAll(async () => {
    database = createPrismaClient(databaseUrl!);
    await database.$connect();

    const suffix = randomUUID();
    const user = await database.user.create({
      data: {
        email: `worker-integration-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'Worker Integration User',
      },
    });
    userId = user.id;

    const workspace = await database.workspace.create({
      data: { name: `Worker Integration ${suffix}` },
    });
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    if (workspaceId) {
      await database.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
    }
    if (userId) {
      await database.user.delete({ where: { id: userId } }).catch(() => undefined);
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

  it('hands campaign planning from a stopped producer to an independent worker and durably schedules discovery', async () => {
    const campaign = await database.campaign.create({
      data: {
        workspaceId,
        createdByUserId: userId,
        name: `US Dentists ${randomUUID()}`,
        country: 'United States',
        niche: 'Dentist',
        requestedLeadCount: 10_000,
        status: CampaignStatus.PLANNING,
      },
    });

    const producer = new PgBossQueueService(databaseUrl!, database);
    await producer.start();
    const queued = await producer.enqueue(
      'campaign-plan',
      { workspaceId, campaignId: campaign.id },
      {
        idempotencyKey: `campaign-plan:${campaign.id}:${campaign.updatedAt.toISOString()}`,
        retryLimit: 0,
      },
    );
    await producer.stop();

    const worker = new PgBossQueueService(databaseUrl!, database);
    await worker.start();
    await worker.work('campaign-plan', async (job) => processCampaignPlanJob(database, worker, job));

    const completed = await waitForJob(database, queued.jobId, (job) => job.status === 'COMPLETED');
    expect(completed.attempts).toBe(1);
    await expect(database.searchPlan.count({ where: { campaignId: campaign.id } })).resolves.toBe(1);

    const taskCount = await database.searchTask.count({
      where: { searchPlan: { campaignId: campaign.id } },
    });
    expect(taskCount).toBeGreaterThan(7);

    const discoveredCampaign = await database.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(discoveredCampaign.status).toBe(CampaignStatus.DISCOVERING);

    const discoveryJobs = await database.jobMetadata.findMany({
      where: { queue: 'campaign-discovery', workspaceId },
    });
    expect(discoveryJobs).toHaveLength(taskCount);
    expect(discoveryJobs.every((job) => job.status === 'QUEUED')).toBe(true);

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
