import { describe, expect, it, vi } from 'vitest';
import {
  DiscoveryProviderError,
  GooglePlacesDiscoveryProvider,
  type BusinessSearchInput,
} from '../src/index.js';

const searchInput: BusinessSearchInput = {
  query: 'Dentist',
  country: 'United States',
  region: 'Texas',
  city: '',
  geographicCell: '',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GooglePlacesDiscoveryProvider', () => {
  it('sends a first-page Places Text Search with the narrow production field mask', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        places: [
          {
            id: 'place-1',
            displayName: { text: 'Example Dental' },
            formattedAddress: '123 Main St, Austin, TX',
            primaryType: 'dentist',
            location: { latitude: 30.1, longitude: -97.7 },
          },
        ],
        nextPageToken: 'token-2',
      }),
    );
    const provider = new GooglePlacesDiscoveryProvider('test-key', fetcher as typeof fetch);

    const page = await provider.searchBusinesses(searchInput);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'test-key',
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.primaryType,places.location,nextPageToken',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      textQuery: 'Dentist in Texas',
      pageSize: 20,
    });
    expect(page.nextPageToken).toBe('token-2');
    expect(page.results).toHaveLength(1);
  });

  it('uses the persisted provider token while preserving search parameters for the next page', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ places: [] }));
    const provider = new GooglePlacesDiscoveryProvider('test-key', fetcher as typeof fetch);

    await provider.getNextPage(searchInput, 'token-2');

    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      textQuery: 'Dentist in Texas',
      pageSize: 20,
      pageToken: 'token-2',
    });
  });

  it('normalizes provider-specific place data into the discovery contract', () => {
    const provider = new GooglePlacesDiscoveryProvider('test-key', vi.fn() as unknown as typeof fetch);

    expect(
      provider.normalizeResult({
        id: 'place-1',
        displayName: { text: 'Example Dental' },
        formattedAddress: '123 Main St, Austin, TX',
        primaryType: 'dentist',
        location: { latitude: 30.1, longitude: -97.7 },
      }),
    ).toEqual({
      providerExternalId: 'place-1',
      name: 'Example Dental',
      formattedAddress: '123 Main St, Austin, TX',
      category: 'dentist',
      latitude: 30.1,
      longitude: -97.7,
      rawReference: 'google-place:place-1',
    });
  });

  it('treats a missing places array as an empty successful page', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ nextPageToken: null }));
    const provider = new GooglePlacesDiscoveryProvider('test-key', fetcher as typeof fetch);

    await expect(provider.searchBusinesses(searchInput)).resolves.toEqual({
      results: [],
      nextPageToken: null,
    });
  });

  it('surfaces HTTP failures as typed provider errors and identifies rate limits', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: { message: 'quota exceeded' } }, 429));
    const provider = new GooglePlacesDiscoveryProvider('test-key', fetcher as typeof fetch);

    try {
      await provider.searchBusinesses(searchInput);
      throw new Error('expected provider call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(DiscoveryProviderError);
      expect(error).toMatchObject({ statusCode: 429, rateLimited: true });
    }
  });
});
