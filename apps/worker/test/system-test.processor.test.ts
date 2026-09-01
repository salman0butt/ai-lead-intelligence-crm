import { describe, expect, it, vi } from 'vitest';
import { processSystemTestJob } from '../src/system-test.processor.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';

function createDb() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    client: {
      jobMetadata: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return data;
        }),
      },
    },
  };
}

describe('processSystemTestJob', () => {
  it('records RUNNING and COMPLETED metadata for a successful attempt', async () => {
    const db = createDb();

    await processSystemTestJob(db.client as never, {
      id: jobId,
      data: { jobId, workspaceId },
    });

    expect(db.updates).toHaveLength(2);
    expect(db.updates[0]).toMatchObject({ status: 'RUNNING', attempts: { increment: 1 } });
    expect(db.updates[1]).toMatchObject({ status: 'COMPLETED', failureReason: null });
    expect(db.updates[1]?.finishedAt).toBeInstanceOf(Date);
  });

  it('records the latest failure reason and rethrows processor errors', async () => {
    const db = createDb();
    const error = new Error('synthetic system-test failure');

    await expect(
      processSystemTestJob(
        db.client as never,
        { id: jobId, data: { jobId, workspaceId, fail: 'true' } },
        async () => {
          throw error;
        },
      ),
    ).rejects.toThrow('synthetic system-test failure');

    expect(db.updates).toHaveLength(2);
    expect(db.updates[0]).toMatchObject({ status: 'RUNNING', attempts: { increment: 1 } });
    expect(db.updates[1]).toMatchObject({ status: 'FAILED', failureReason: 'synthetic system-test failure' });
  });
});
