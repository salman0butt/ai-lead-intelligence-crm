import { describe, expect, it } from 'vitest';
import { jobTestSchema } from '../src/index.js';

describe('jobTestSchema', () => {
  it('requires a workspace UUID and accepts an optional idempotency key', () => {
    expect(() => jobTestSchema.parse({ workspaceId: 'not-a-uuid' })).toThrow();
    expect(
      jobTestSchema.parse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'system-test:workspace:1',
      }),
    ).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      idempotencyKey: 'system-test:workspace:1',
    });
  });
});
