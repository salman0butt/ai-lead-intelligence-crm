import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import type { DatabaseClient } from '@ai-crm/database';
import { queueDefinitions, type QueueDefinition, type QueueName } from './queues.js';
import type {
  EnqueueOptions,
  QueueJobResult,
  QueueJobStatus,
  QueuePayload,
  QueuePayloadInput,
  QueueService,
  QueueWorkHandler,
} from './types.js';

interface BossJobReference {
  id: string;
  data?: Record<string, string>;
}

interface BossAdapter {
  on(event: string, handler: (error: unknown) => void): unknown;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  createQueue(name: string, options?: Record<string, unknown>): Promise<unknown>;
  send(
    name: string,
    data: Record<string, string>,
    options?: Record<string, unknown>,
  ): Promise<string | null>;
  cancel(name: string, id: string): Promise<unknown>;
  retry(name: string, id: string): Promise<unknown>;
  work(
    name: string,
    options: Record<string, unknown>,
    handler: (jobs: BossJobReference[]) => Promise<void>,
  ): Promise<string>;
}

type JobMetadataRecord = Awaited<ReturnType<DatabaseClient['jobMetadata']['findUnique']>>;

export class PgBossQueueService implements QueueService {
  private readonly boss: BossAdapter;

  constructor(
    databaseUrl: string,
    private readonly database: DatabaseClient,
    boss?: BossAdapter,
  ) {
    this.boss =
      boss ??
      (new PgBoss({
        connectionString: databaseUrl,
        useListenNotify: true,
      }) as unknown as BossAdapter);

    this.boss.on('error', (error) => {
      console.error('pg-boss error', error);
    });
  }

  async start(): Promise<void> {
    await this.boss.start();

    for (const definition of queueDefinitions) {
      await this.boss.createQueue(definition.deadLetter, this.deadLetterOptions(definition));
      await this.boss.createQueue(definition.name, this.queueOptions(definition));
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop();
  }

  async work(queue: QueueName, handler: QueueWorkHandler): Promise<string> {
    const definition = this.definition(queue);
    return this.boss.work(
      queue,
      {
        localConcurrency: definition.concurrency,
        pollingIntervalSeconds: 1,
        notifyPollingIntervalSeconds: 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          if (!job.data) continue;
          await handler({ id: job.id, data: job.data as QueuePayload });
        }
      },
    );
  }

  async enqueue(
    queue: QueueName,
    payload: QueuePayloadInput,
    options?: EnqueueOptions,
  ): Promise<QueueJobResult> {
    return this.send(queue, payload, options);
  }

  async enqueueBulk(
    queue: QueueName,
    payloads: readonly QueuePayloadInput[],
    options?: EnqueueOptions,
  ): Promise<QueueJobResult[]> {
    const jobs: QueueJobResult[] = [];

    for (const [index, payload] of payloads.entries()) {
      const itemOptions = options?.idempotencyKey
        ? { ...options, idempotencyKey: `${options.idempotencyKey}:${index}` }
        : options;
      jobs.push(await this.enqueue(queue, payload, itemOptions));
    }

    return jobs;
  }

  async cancel(queue: QueueName, jobId: string): Promise<QueueJobResult> {
    const existing = await this.getStatus(queue, jobId);
    if (!existing) throw new Error(`Unknown ${queue} job ${jobId}`);

    await this.boss.cancel(queue, jobId);
    const metadata = await this.database.jobMetadata.update({
      where: { jobId },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
      },
    });
    return this.toResult(metadata);
  }

  async retry(queue: QueueName, jobId: string): Promise<QueueJobResult> {
    const existing = await this.getStatus(queue, jobId);
    if (!existing) throw new Error(`Unknown ${queue} job ${jobId}`);

    await this.boss.retry(queue, jobId);
    const metadata = await this.database.jobMetadata.update({
      where: { jobId },
      data: {
        status: 'QUEUED',
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      },
    });
    return this.toResult(metadata);
  }

  async schedule(
    queue: QueueName,
    payload: QueuePayloadInput,
    runAt: Date,
    options?: EnqueueOptions,
  ): Promise<QueueJobResult> {
    return this.send(queue, payload, options, runAt);
  }

  async getStatus(queue: QueueName, jobId: string): Promise<QueueJobResult | null> {
    const metadata = await this.database.jobMetadata.findUnique({ where: { jobId } });
    if (!metadata || metadata.queue !== queue) return null;
    return this.toResult(metadata);
  }

  private async send(
    queue: QueueName,
    payload: QueuePayloadInput,
    options?: EnqueueOptions,
    startAfter?: Date,
  ): Promise<QueueJobResult> {
    const definition = this.definition(queue);
    const jobId = randomUUID();
    const metadata = await this.reserveMetadata(queue, payload.workspaceId, jobId, options?.idempotencyKey);

    if (metadata.jobId !== jobId) return this.toResult(metadata);

    const data = { ...payload, jobId };
    const retryBackoff = options?.retryBackoff ?? definition.retryBackoff;
    const sendOptions: Record<string, unknown> = {
      id: jobId,
      retryLimit: options?.retryLimit ?? definition.retryLimit,
      retryDelay: options?.retryDelay ?? definition.retryDelay,
      retryBackoff,
      ...(retryBackoff
        ? { retryDelayMax: options?.retryDelayMax ?? definition.retryDelayMax }
        : {}),
      expireInSeconds: options?.expireInSeconds ?? definition.expireInSeconds,
      ...(options?.priority !== undefined ? { priority: options.priority } : {}),
      ...(options?.idempotencyKey ? { singletonKey: options.idempotencyKey } : {}),
      ...(startAfter ? { startAfter } : {}),
    };

    try {
      const acceptedJobId = await this.boss.send(queue, data, sendOptions);
      if (!acceptedJobId) throw new Error(`pg-boss rejected ${queue} job ${jobId}`);
      if (acceptedJobId !== jobId) {
        throw new Error(`pg-boss returned unexpected job id ${acceptedJobId} for ${jobId}`);
      }
      return this.toResult(metadata);
    } catch (error) {
      await this.database.jobMetadata.delete({ where: { jobId } }).catch(() => undefined);
      throw error;
    }
  }

  private async reserveMetadata(
    queue: QueueName,
    workspaceId: string,
    jobId: string,
    idempotencyKey?: string,
  ): Promise<NonNullable<JobMetadataRecord>> {
    try {
      return await this.database.jobMetadata.create({
        data: {
          jobId,
          queue,
          workspaceId,
          status: 'QUEUED',
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      });
    } catch (error) {
      if (idempotencyKey) {
        const existing = await this.database.jobMetadata.findFirst({
          where: { queue, workspaceId, idempotencyKey },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  private definition(queue: QueueName): QueueDefinition {
    const definition = queueDefinitions.find((candidate) => candidate.name === queue);
    if (!definition) throw new Error(`Unknown queue: ${queue}`);
    return definition;
  }

  private queueOptions(definition: QueueDefinition): Record<string, unknown> {
    return {
      policy: 'standard',
      notify: true,
      retryLimit: definition.retryLimit,
      retryDelay: definition.retryDelay,
      retryBackoff: definition.retryBackoff,
      retryDelayMax: definition.retryDelayMax,
      expireInSeconds: definition.expireInSeconds,
      retentionSeconds: definition.retentionSeconds,
      deleteAfterSeconds: definition.deleteAfterSeconds,
      heartbeatSeconds: definition.heartbeatSeconds,
      deadLetter: definition.deadLetter,
    };
  }

  private deadLetterOptions(definition: QueueDefinition): Record<string, unknown> {
    return {
      policy: 'standard',
      retryLimit: 0,
      expireInSeconds: definition.expireInSeconds,
      retentionSeconds: definition.retentionSeconds,
      deleteAfterSeconds: definition.deleteAfterSeconds,
    };
  }

  private toResult(metadata: NonNullable<JobMetadataRecord>): QueueJobResult {
    return {
      jobId: metadata.jobId,
      queue: metadata.queue as QueueName,
      status: metadata.status as QueueJobStatus,
      workspaceId: metadata.workspaceId,
      attempts: metadata.attempts,
      createdAt: metadata.createdAt,
      startedAt: metadata.startedAt,
      finishedAt: metadata.finishedAt,
      failureReason: metadata.failureReason,
    };
  }
}
