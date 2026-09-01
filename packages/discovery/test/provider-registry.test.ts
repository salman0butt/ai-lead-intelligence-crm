import { describe, expect, it } from 'vitest';
import {
  DiscoveryProviderRegistry,
  type BusinessDiscoveryProvider,
  type BusinessSearchInput,
} from '../src/index.js';

const provider: BusinessDiscoveryProvider = {
  name: 'google-places',
  async searchBusinesses(input: BusinessSearchInput) {
    void input;
    return { results: [], nextPageToken: null };
  },
  async getNextPage(input: BusinessSearchInput, pageToken: string) {
    void input;
    void pageToken;
    return { results: [], nextPageToken: null };
  },
  normalizeResult() {
    throw new Error('not used');
  },
};

describe('DiscoveryProviderRegistry', () => {
  it('resolves a registered provider by stable provider name', () => {
    const registry = new DiscoveryProviderRegistry();
    registry.register(provider);

    expect(registry.get('google-places')).toBe(provider);
  });

  it('fails clearly when a SearchTask references an unconfigured provider', () => {
    const registry = new DiscoveryProviderRegistry();

    expect(() => registry.get('google-places')).toThrow(
      'Discovery provider "google-places" is not configured',
    );
  });
});
