import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';

function createDb(member: boolean) {
  return {
    workspaceMember: {
      findUnique: vi.fn(async () => (member ? { workspaceId, userId } : null)),
    },
    jobMetadata: {
      findUnique: vi.fn(async () => ({
        jobId,
        queue: 'system-test',
        status: 'QUEUED',
        workspaceId,
        attempts: 0,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      })),
    },
  };
}

function createQueue() {
  return {
    enqueue: vi.fn(async () => ({
      jobId,
      queue: 'system-test' as const,
      status: 'QUEUED' as const,
      workspaceId,
      attempts: 0,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      startedAt: null,
      finishedAt: null,
      failureReason: null,
    })),
  };
}

describe('JobsService', () => {
  it('rejects enqueue when the user is not a workspace member', async () => {
    const db = createDb(false);
    const queue = createQueue();
    const service = new JobsService(db as never, queue as never);

    await expect(service.enqueueTest(userId, { workspaceId })).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('generates a fresh idempotency key when the client omits one', async () => {
    const db = createDb(true);
    const queue = createQueue();
    const service = new JobsService(db as never, queue as never);

    await service.enqueueTest(userId, { workspaceId });

    const options = queue.enqueue.mock.calls[0]?.[2] as { idempotencyKey?: string } | undefined;
    expect(queue.enqueue).toHaveBeenCalledWith('system-test', { workspaceId }, expect.any(Object));
    expect(options?.idempotencyKey).toMatch(/^system-test:[0-9a-f-]{36}$/);
  });

  it('preserves an explicit idempotency key for retry-safe scheduling', async () => {
    const db = createDb(true);
    const queue = createQueue();
    const service = new JobsService(db as never, queue as never);

    await service.enqueueTest(userId, { workspaceId, idempotencyKey: 'client-request-1' });

    expect(queue.enqueue).toHaveBeenCalledWith(
      'system-test',
      { workspaceId },
      { idempotencyKey: 'client-request-1' },
    );
  });

  it('rejects viewing a job from a workspace the user cannot access', async () => {
    const db = createDb(false);
    const queue = createQueue();
    const service = new JobsService(db as never, queue as never);

    await expect(service.getJob(userId, jobId)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
