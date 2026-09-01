import { describe, expect, it, vi } from 'vitest';
import { processCampaignPlanJob } from '../src/campaign-plan.processor.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const campaignId = '00000000-0000-4000-8000-000000000003';

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

describe('processCampaignPlanJob', () => {
  it('tracks one successful campaign planning attempt without doing discovery', async () => {
    const db = createDb();
    const task = vi.fn(async () => undefined);

    await processCampaignPlanJob(
      db.client as never,
      { id: jobId, data: { jobId, workspaceId, campaignId } },
      task,
    );

    expect(task).toHaveBeenCalledWith({ jobId, workspaceId, campaignId });
    expect(db.updates).toHaveLength(2);
    expect(db.updates[0]).toMatchObject({ status: 'RUNNING', attempts: { increment: 1 } });
    expect(db.updates[1]).toMatchObject({ status: 'COMPLETED', failureReason: null });
  });
});
