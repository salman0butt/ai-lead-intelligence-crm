import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { loadServerEnv } from '@ai-crm/config';
import type { DatabaseClient } from '@ai-crm/database';
import {
  PgBossQueueService,
  type EnqueueOptions,
  type QueueJobResult,
  type QueueName,
  type QueuePayloadInput,
  type QueueService,
} from '@ai-crm/queue';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class QueueProvider implements QueueService, OnModuleInit, OnModuleDestroy {
  private readonly queue: PgBossQueueService;

  constructor(@Inject(DATABASE) database: DatabaseClient) {
    const env = loadServerEnv(process.env);
    this.queue = new PgBossQueueService(env.DATABASE_URL, database);
  }

  async onModuleInit(): Promise<void> {
    await this.queue.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.stop();
  }

  enqueue(queue: QueueName, payload: QueuePayloadInput, options?: EnqueueOptions): Promise<QueueJobResult> {
    return this.queue.enqueue(queue, payload, options);
  }

  enqueueBulk(
    queue: QueueName,
    payloads: readonly QueuePayloadInput[],
    options?: EnqueueOptions,
  ): Promise<QueueJobResult[]> {
    return this.queue.enqueueBulk(queue, payloads, options);
  }

  cancel(queue: QueueName, jobId: string): Promise<QueueJobResult> {
    return this.queue.cancel(queue, jobId);
  }

  retry(queue: QueueName, jobId: string): Promise<QueueJobResult> {
    return this.queue.retry(queue, jobId);
  }

  schedule(
    queue: QueueName,
    payload: QueuePayloadInput,
    runAt: Date,
    options?: EnqueueOptions,
  ): Promise<QueueJobResult> {
    return this.queue.schedule(queue, payload, runAt, options);
  }

  getStatus(queue: QueueName, jobId: string): Promise<QueueJobResult | null> {
    return this.queue.getStatus(queue, jobId);
  }
}
