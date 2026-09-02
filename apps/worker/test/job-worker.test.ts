import { describe, expect, it, vi } from 'vitest';
import { registerJobWorkers } from '../src/job-worker.js';

const work = vi.fn(async (queue: string, handler: unknown) => {
  void queue;
  void handler;
  return 'worker-id';
});

function createDatabase() {
  return {
    jobMetadata: {
      update: vi.fn(async () => undefined),
    },
  };
}

describe('registerJobWorkers', () => {
  it('registers system-test, campaign-plan, and campaign-discovery consumers', async () => {
    work.mockClear();

    await registerJobWorkers(
      createDatabase() as never,
      { work } as never,
      { get: vi.fn() } as never,
    );

    expect(work.mock.calls.map(([queue]) => queue)).toEqual([
      'system-test',
      'campaign-plan',
      'campaign-discovery',
    ]);
  });
});
