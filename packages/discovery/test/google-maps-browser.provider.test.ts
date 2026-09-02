import { describe, expect, it } from 'vitest';
import {
  decodeGoogleMapsCursor,
  encodeGoogleMapsCursor,
} from '../src/browser/cursor.js';
import { GoogleMapsBrowserProvider } from '../src/browser/google-maps-browser.provider.js';

describe('Google Maps browser cursor', () => {
  it('round-trips bounded durable continuation state', () => {
    const encoded = encodeGoogleMapsCursor({
      v: 1,
      seenIds: ['maps-url-sha256:a', 'maps-url-sha256:b'],
      scrollRounds: 4,
    });

    expect(decodeGoogleMapsCursor(encoded)).toEqual({
      v: 1,
      seenIds: ['maps-url-sha256:a', 'maps-url-sha256:b'],
      scrollRounds: 4,
    });
  });

  it('rejects unbounded or malformed cursor state', () => {
    expect(() => decodeGoogleMapsCursor('not-a-valid-cursor')).toThrow(/cursor/i);
    expect(() => encodeGoogleMapsCursor({
      v: 1,
      seenIds: Array.from({ length: 501 }, (_, index) => `id-${index}`),
      scrollRounds: 0,
    })).toThrow(/seen/i);
    expect(() => encodeGoogleMapsCursor({
      v: 1,
      seenIds: [],
      scrollRounds: 101,
    })).toThrow(/scroll/i);
  });
});

describe('GoogleMapsBrowserProvider normalization', () => {
  it('normalizes a rendered listing without collecting contact fields', () => {
    const provider = new GoogleMapsBrowserProvider();
    const normalized = provider.normalizeResult({
      name: 'Example Dental',
      formattedAddress: '123 Main St, Austin, TX',
      category: 'Dentist',
      listingUrl: 'https://www.google.com/maps/place/Example+Dental/@30.1,-97.7,17z/data=!4m5!3m4!1sabc!8m2!3d30.1!4d-97.7?entry=ttu',
      latitude: 30.1,
      longitude: -97.7,
    });

    expect(normalized).toMatchObject({
      name: 'Example Dental',
      formattedAddress: '123 Main St, Austin, TX',
      category: 'Dentist',
      latitude: 30.1,
      longitude: -97.7,
    });
    expect(normalized.providerExternalId).toMatch(/^maps-url-sha256:[a-f0-9]{64}$/);
    expect(normalized.rawReference).toBe('https://www.google.com/maps/place/Example+Dental/@30.1,-97.7,17z/data=!4m5!3m4!1sabc!8m2!3d30.1!4d-97.7');
    expect(normalized).not.toHaveProperty('phone');
    expect(normalized).not.toHaveProperty('email');
    expect(normalized).not.toHaveProperty('website');
  });
});
