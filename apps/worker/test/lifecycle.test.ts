import { describe, expect, it, vi } from 'vitest';
import { createWorkerLifecycle } from '../src/lifecycle.js';

describe('worker lifecycle', () => {
  it('connects on start and disconnects on stop', async () => {
    const database = { $connect: vi.fn(), $disconnect: vi.fn() };
    const worker = createWorkerLifecycle(database);

    await worker.start();
    await worker.stop();

    expect(database.$connect).toHaveBeenCalledOnce();
    expect(database.$disconnect).toHaveBeenCalledOnce();
  });
});
