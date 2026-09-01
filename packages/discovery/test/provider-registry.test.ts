import { describe, expect, it } from 'vitest';
import {
  DiscoveryProviderRegistry,
  type BusinessDiscoveryProvider,
  type BusinessSearchInput,
} from '../src/index.js';

const provider: BusinessDiscoveryProvider = {
  name: 'google-maps-browser',
  async searchBusinesses(input: BusinessSearchInput) {
    void input;
    return { results: [], nextCursor: null };
  },
  async continueSearch(input: BusinessSearchInput, cursor: string) {
    void input;
    void cursor;
    return { results: [], nextCursor: null };
  },
  normalizeResult() {
    throw new Error('not used');
  },
};

describe('DiscoveryProviderRegistry', () => {
  it('resolves the browser provider by stable provider name', () => {
    const registry = new DiscoveryProviderRegistry();
    registry.register(provider);

    expect(registry.get('google-maps-browser')).toBe(provider);
  });

  it('fails clearly when a SearchTask references an unconfigured browser provider', () => {
    const registry = new DiscoveryProviderRegistry();

    expect(() => registry.get('google-maps-browser')).toThrow(
      'Discovery provider "google-maps-browser" is not configured',
    );
  });
});
