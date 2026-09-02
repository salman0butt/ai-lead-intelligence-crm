import { describe, expect, it, vi } from 'vitest';
import { scheduleSearchTaskDiscovery } from '../src/discovery-scheduler.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const campaignId = '00000000-0000-4000-8000-000000000002';
const searchTaskId = '00000000-0000-4000-8000-000000000003';
const campaignVersion = '2026-09-01T18:20:00.000Z';

type EnqueueArgs = [
  queue: string,
  payload: Record<string, string>,
  options: { idempotencyKey: string },
];

function createQueue() {
  return {
    enqueue: vi.fn(async (...args: EnqueueArgs) => {
      void args;
      return {
        jobId: '00000000-0000-4000-8000-000000000004',
        queue: 'campaign-discovery' as const,
        status: 'QUEUED' as const,
        workspaceId,
        attempts: 0,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
        failureReason: null,
      };
    }),
  };
}

describe('scheduleSearchTaskDiscovery', () => {
  it('publishes an identifier/version/page-only campaign-discovery job with deterministic idempotency', async () => {
    const queue = createQueue();

    await scheduleSearchTaskDiscovery(queue as never, {
      workspaceId,
      campaignId,
      searchTaskId,
      campaignVersion,
      pageNumber: '1',
    });

    expect(queue.enqueue).toHaveBeenCalledWith(
      'campaign-discovery',
      { workspaceId, campaignId, searchTaskId, campaignVersion, pageNumber: '1' },
      {
        idempotencyKey:
          `campaign-discovery:${searchTaskId}:${campaignVersion}:page:1`,
      },
    );
    expect(Object.keys(queue.enqueue.mock.calls[0]![1]).sort()).toEqual([
      'campaignId',
      'campaignVersion',
      'pageNumber',
      'searchTaskId',
      'workspaceId',
    ]);
  });

  it('keeps each SearchTask independently schedulable', async () => {
    const queue = createQueue();
    const taskIds = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
    ];

    await Promise.all(
      taskIds.map((taskId) =>
        scheduleSearchTaskDiscovery(queue as never, {
          workspaceId,
          campaignId,
          searchTaskId: taskId,
          campaignVersion,
          pageNumber: '1',
        }),
      ),
    );

    expect(queue.enqueue).toHaveBeenCalledTimes(3);
    expect(queue.enqueue.mock.calls.map(([, payload]) => payload.searchTaskId)).toEqual(taskIds);
  });
});
