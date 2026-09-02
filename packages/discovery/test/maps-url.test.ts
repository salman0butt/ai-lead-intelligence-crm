import { describe, expect, it } from 'vitest';
import {
  buildGoogleMapsSearchUrl,
  mapsListingExternalId,
  normalizeMapsListingUrl,
} from '../src/browser/maps-url.js';

describe('Google Maps browser URL helpers', () => {
  it('builds a normal public Maps search URL from discovery text', () => {
    expect(buildGoogleMapsSearchUrl('Dentist in Austin, Texas, United States')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Dentist%20in%20Austin%2C%20Texas%2C%20United%20States',
    );
  });

  it('normalizes tracking-only differences to the same public listing reference', () => {
    const first =
      'https://www.google.com/maps/place/Example+Dental/@30.1,-97.7,17z/data=!4m5!3m4!1sabc!8m2!3d30.1!4d-97.7?entry=ttu&utm_source=test#tracking';
    const second =
      'https://www.google.com/maps/place/Example+Dental/@30.1,-97.7,17z/data=!4m5!3m4!1sabc!8m2!3d30.1!4d-97.7?hl=en';

    expect(normalizeMapsListingUrl(first)).toBe(normalizeMapsListingUrl(second));
    expect(mapsListingExternalId(first)).toBe(mapsListingExternalId(second));
    expect(mapsListingExternalId(first)).toMatch(/^maps-url-sha256:[a-f0-9]{64}$/);
  });

  it('rejects non-Google-Maps listing URLs', () => {
    expect(() => normalizeMapsListingUrl('https://example.com/business')).toThrow(
      'Google Maps listing URL is required',
    );
  });
});
