import { describe, expect, it } from 'vitest';
import { formatCampaignGeography, getCampaignActions } from '../lib/campaigns';

describe('campaign frontend helpers', () => {
  it('formats geography from the most specific available fields', () => {
    expect(formatCampaignGeography({ country: 'Norway', region: null, city: 'Oslo' })).toBe('Oslo, Norway');
    expect(formatCampaignGeography({ country: 'Norway', region: 'Vestland', city: null })).toBe('Vestland, Norway');
    expect(formatCampaignGeography({ country: 'Norway', region: null, city: null })).toBe('Norway');
  });

  it('shows only lifecycle actions valid for the current status', () => {
    expect(getCampaignActions('DRAFT')).toEqual(['start', 'cancel']);
    expect(getCampaignActions('PLANNING')).toEqual(['pause', 'cancel']);
    expect(getCampaignActions('PAUSED')).toEqual(['resume', 'cancel']);
    expect(getCampaignActions('CANCELLED')).toEqual([]);
  });
});
