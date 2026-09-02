import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyLimitedDiscoveryProvider } from '../src/concurrency-limited-provider.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const input = {
  query: 'Dentist',
  country: 'United States',
  region: 'Texas',
  city: 'Austin',
  geographicCell: 'Austin, Texas, United States',
};

describe('ConcurrencyLimitedDiscoveryProvider', () => {
  it('limits concurrent provider I/O without changing the provider identity', async () => {
    const first = deferred<{ results: []; nextCursor: null }>();
    const second = deferred<{ results: []; nextCursor: null }>();
    let calls = 0;
    let active = 0;
    let maxActive = 0;

    const provider = {
      name: 'google-maps-browser',
      searchBusinesses: vi.fn(async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        const result = calls === 1 ? await first.promise : await second.promise;
        active -= 1;
        return result;
      }),
      continueSearch: vi.fn(async () => ({ results: [], nextCursor: null })),
      normalizeResult: vi.fn(() => ({
        providerExternalId: 'id',
        name: 'Example',
        formattedAddress: 'Austin, TX',
        category: null,
        latitude: null,
        longitude: null,
        rawReference: null,
      })),
    };

    const limited = new ConcurrencyLimitedDiscoveryProvider(provider, 1);
    const firstCall = limited.searchBusinesses(input);
    const secondCall = limited.searchBusinesses(input);

    await vi.waitFor(() => expect(provider.searchBusinesses).toHaveBeenCalledTimes(1));
    expect(limited.name).toBe('google-maps-browser');

    first.resolve({ results: [], nextCursor: null });
    await firstCall;
    await vi.waitFor(() => expect(provider.searchBusinesses).toHaveBeenCalledTimes(2));

    second.resolve({ results: [], nextCursor: null });
    await secondCall;

    expect(maxActive).toBe(1);
  });

  it('releases capacity after provider failures', async () => {
    const provider = {
      name: 'provider',
      searchBusinesses: vi
        .fn()
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce({ results: [], nextCursor: null }),
      continueSearch: vi.fn(async () => ({ results: [], nextCursor: null })),
      normalizeResult: vi.fn(() => ({
        providerExternalId: 'id',
        name: 'Example',
        formattedAddress: 'Austin, TX',
        category: null,
        latitude: null,
        longitude: null,
        rawReference: null,
      })),
    };
    const limited = new ConcurrencyLimitedDiscoveryProvider(provider, 1);

    await expect(limited.searchBusinesses(input)).rejects.toThrow('first failed');
    await expect(limited.searchBusinesses(input)).resolves.toEqual({
      results: [],
      nextCursor: null,
    });
  });
});
