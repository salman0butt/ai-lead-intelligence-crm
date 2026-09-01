import type { QueueName } from './queues.js';

export type QueueJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface QueuePayloadInput {
  workspaceId: string;
  [key: string]: string;
}

export interface QueuePayload extends QueuePayloadInput {
  jobId: string;
}

export interface EnqueueOptions {
  idempotencyKey?: string;
  priority?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  expireInSeconds?: number;
}

export interface QueueJobResult {
  jobId: string;
  queue: QueueName;
  status: QueueJobStatus;
  workspaceId: string;
  attempts: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  failureReason: string | null;
}

export interface QueueService {
  enqueue(queue: QueueName, payload: QueuePayloadInput, options?: EnqueueOptions): Promise<QueueJobResult>;
  enqueueBulk(
    queue: QueueName,
    payloads: readonly QueuePayloadInput[],
    options?: EnqueueOptions,
  ): Promise<QueueJobResult[]>;
  cancel(queue: QueueName, jobId: string): Promise<QueueJobResult>;
  retry(queue: QueueName, jobId: string): Promise<QueueJobResult>;
  schedule(
    queue: QueueName,
    payload: QueuePayloadInput,
    runAt: Date,
    options?: EnqueueOptions,
  ): Promise<QueueJobResult>;
  getStatus(queue: QueueName, jobId: string): Promise<QueueJobResult | null>;
}
