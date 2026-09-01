import { describe, expect, it } from 'vitest';
import { createCampaignSchema } from '../src/index.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('createCampaignSchema', () => {
  it('accepts a large requested lead count without an arbitrary product cap', () => {
    const parsed = createCampaignSchema.parse({
      workspaceId,
      name: 'Oslo Dentists',
      country: 'Norway',
      region: '',
      city: 'Oslo',
      niche: 'Dentist',
      requestedLeadCount: 25000,
    });

    expect(parsed.region).toBeUndefined();
    expect(parsed.city).toBe('Oslo');
    expect(parsed.requestedLeadCount).toBe(25000);
  });

  it('rejects zero and fractional requested lead counts', () => {
    const base = {
      workspaceId,
      name: 'Oslo Dentists',
      country: 'Norway',
      niche: 'Dentist',
    };

    expect(createCampaignSchema.safeParse({ ...base, requestedLeadCount: 0 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, requestedLeadCount: 1.5 }).success).toBe(false);
  });

  it('normalizes blank optional geography fields away', () => {
    const parsed = createCampaignSchema.parse({
      workspaceId,
      name: 'Norway Dentists',
      country: 'Norway',
      region: '   ',
      city: '',
      niche: 'Dentist',
      requestedLeadCount: 100,
    });

    expect(parsed.region).toBeUndefined();
    expect(parsed.city).toBeUndefined();
  });
});
