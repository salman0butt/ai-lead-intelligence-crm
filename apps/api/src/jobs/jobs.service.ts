import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DatabaseClient } from '@ai-crm/database';
import type { JobTestInput } from '@ai-crm/schemas';
import type { QueueService } from '@ai-crm/queue';
import { DATABASE } from '../database/database.module.js';
import { QueueProvider } from './queue.provider.js';

@Injectable()
export class JobsService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(QueueProvider) private readonly queue: QueueService,
  ) {}

  async enqueueTest(userId: string, input: JobTestInput) {
    await this.assertMembership(userId, input.workspaceId);

    return this.queue.enqueue(
      'system-test',
      { workspaceId: input.workspaceId },
      {
        idempotencyKey: input.idempotencyKey ?? `system-test:${randomUUID()}`,
      },
    );
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.db.jobMetadata.findUnique({ where: { jobId } });
    if (!job) throw new NotFoundException('Job not found');

    await this.assertMembership(userId, job.workspaceId);
    return {
      jobId: job.jobId,
      queue: job.queue,
      status: job.status,
      workspaceId: job.workspaceId,
      attempts: job.attempts,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      failureReason: job.failureReason,
    };
  }

  private async assertMembership(userId: string, workspaceId: string): Promise<void> {
    const membership = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new ForbiddenException('Workspace access denied');
  }
}
