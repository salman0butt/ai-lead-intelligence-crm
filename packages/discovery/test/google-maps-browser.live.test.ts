import { describe, expect, it } from 'vitest';
import { DiscoveryAccessBlockedError } from '../src/browser/browser-errors.js';
import { GoogleMapsBrowserProvider } from '../src/browser/google-maps-browser.provider.js';

const live = process.env.RUN_LIVE_BROWSER_DISCOVERY_TESTS === '1' ? describe : describe.skip;

live('GoogleMapsBrowserProvider live public-page smoke', () => {
  it('discovers rendered businesses or reports an explicit access block without bypassing it', async () => {
    const provider = new GoogleMapsBrowserProvider({ scrollPauseMs: 750 });

    try {
      const page = await provider.searchBusinesses({
        query: 'Dentist',
        country: 'United States',
        region: 'Texas',
        city: 'Austin',
        geographicCell: 'Austin, Texas, United States',
        pageSize: 3,
      });

      expect(page.results.length).toBeGreaterThan(0);
      for (const raw of page.results) {
        const normalized = provider.normalizeResult(raw);
        expect(normalized.providerExternalId).toBeTruthy();
        expect(normalized.name).toBeTruthy();
        expect(normalized.formattedAddress).toBeTruthy();
        expect(normalized.rawReference).toMatch(/^https:\/\/www\.google\./);
      }
    } catch (error) {
      if (error instanceof DiscoveryAccessBlockedError) {
        console.warn(
          'Live Google Maps discovery smoke stopped because the public page presented an access block or CAPTCHA. No bypass was attempted.',
        );
        return;
      }
      throw error;
    }
  }, 60_000);
});
