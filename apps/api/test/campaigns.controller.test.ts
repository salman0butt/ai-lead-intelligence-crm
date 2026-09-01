import { describe, expect, it, vi } from 'vitest';
import { CampaignsController } from '../src/campaigns/campaigns.controller.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const campaignId = '00000000-0000-4000-8000-000000000003';
const user = { id: userId, email: 'user@example.com', name: 'User' };

function createService() {
  return {
    create: vi.fn(async () => ({ id: campaignId })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: campaignId })),
    start: vi.fn(async () => ({ campaign: { id: campaignId }, job: { jobId: 'job-id' } })),
    pause: vi.fn(async () => ({ id: campaignId, status: 'PAUSED' })),
    resume: vi.fn(async () => ({ id: campaignId, status: 'PLANNING' })),
    cancel: vi.fn(async () => ({ id: campaignId, status: 'CANCELLED' })),
  };
}

const createBody = {
  workspaceId,
  name: 'Oslo Dentists',
  country: 'Norway',
  region: '',
  city: 'Oslo',
  niche: 'Dentist',
  requestedLeadCount: 25000,
};

describe('CampaignsController', () => {
  it('parses creation input and delegates with the authenticated user id', async () => {
    const service = createService();
    const controller = new CampaignsController(service as never);

    await controller.create(user, createBody);

    expect(service.create).toHaveBeenCalledWith(userId, {
      ...createBody,
      region: undefined,
    });
  });

  it('delegates list and detail reads with validated identifiers', async () => {
    const service = createService();
    const controller = new CampaignsController(service as never);

    await controller.list(user, workspaceId);
    await controller.get(user, campaignId);

    expect(service.list).toHaveBeenCalledWith(userId, workspaceId);
    expect(service.get).toHaveBeenCalledWith(userId, campaignId);
  });

  it('delegates every lifecycle action to the service', async () => {
    const service = createService();
    const controller = new CampaignsController(service as never);

    await controller.start(user, campaignId);
    await controller.pause(user, campaignId);
    await controller.resume(user, campaignId);
    await controller.cancel(user, campaignId);

    expect(service.start).toHaveBeenCalledWith(userId, campaignId);
    expect(service.pause).toHaveBeenCalledWith(userId, campaignId);
    expect(service.resume).toHaveBeenCalledWith(userId, campaignId);
    expect(service.cancel).toHaveBeenCalledWith(userId, campaignId);
  });
});
