import type { Page } from 'playwright';

export interface GoogleMapsBrowserListing {
  name: string;
  formattedAddress: string;
  category: string | null;
  listingUrl: string;
  latitude: number | null;
  longitude: number | null;
}

interface RenderedListing {
  name: string;
  formattedAddress: string;
  category: string | null;
  listingUrl: string;
}

function coordinatesFromListingUrl(listingUrl: string): {
  latitude: number | null;
  longitude: number | null;
} {
  const match = listingUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/)/);
  if (!match) return { latitude: null, longitude: null };

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { latitude: null, longitude: null };
  }

  return { latitude, longitude };
}

export async function isGoogleMapsAccessBlocked(page: Page): Promise<boolean> {
  const snapshot = await page.evaluate(() => ({
    title: document.title,
    text: document.body?.innerText ?? '',
    href: window.location.href,
  }));

  const haystack = `${snapshot.title}\n${snapshot.text}\n${snapshot.href}`.toLowerCase();
  return [
    'our systems have detected unusual traffic',
    'complete the captcha',
    'captcha challenge',
    'verify you are human',
    '/sorry/',
  ].some((marker) => haystack.includes(marker));
}

export async function extractGoogleMapsListings(
  page: Page,
): Promise<GoogleMapsBrowserListing[]> {
  const rendered = await page.evaluate<RenderedListing[]>(() => {
    const clean = (value: string | null | undefined): string => (value ?? '').trim();
    const unique = new Set<string>();
    const results: RenderedListing[] = [];

    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]'),
    );

    for (const anchor of anchors) {
      const listingUrl = clean(anchor.href);
      if (!listingUrl || unique.has(listingUrl)) continue;

      const name = clean(anchor.getAttribute('aria-label')) || clean(anchor.textContent);
      if (!name) continue;

      const container =
        anchor.closest<HTMLElement>('[data-result-card], .Nv2PK, [role="article"]') ??
        anchor.parentElement;

      const explicitCategory = clean(
        container?.querySelector<HTMLElement>('[data-category]')?.textContent,
      );
      const explicitAddress = clean(
        container?.querySelector<HTMLElement>('[data-address]')?.textContent,
      );

      let category = explicitCategory || null;
      let formattedAddress = explicitAddress;

      if (container && (!category || !formattedAddress)) {
        const lines = container.innerText
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line !== name);

        for (const line of lines) {
          if (!line.includes('·')) continue;
          const segments = line
            .split('·')
            .map((segment) => segment.trim())
            .filter(Boolean);
          if (!category && segments[0] && !/^\d(?:[\d., ]*)?$/.test(segments[0])) {
            category = segments[0];
          }
          if (!formattedAddress && segments.length > 1) {
            const candidate = segments.slice(1).join(' · ');
            if (/\d|,/.test(candidate)) formattedAddress = candidate;
          }
          if (category && formattedAddress) break;
        }
      }

      unique.add(listingUrl);
      results.push({
        name,
        formattedAddress,
        category,
        listingUrl,
      });
    }

    return results;
  });

  return rendered.map((listing) => ({
    ...listing,
    ...coordinatesFromListingUrl(listing.listingUrl),
  }));
}

export async function hasReachedGoogleMapsEnd(page: Page): Promise<boolean> {
  const text = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
  return [
    "you've reached the end of the list",
    'you have reached the end of the list',
    'no more results',
  ].some((marker) => text.includes(marker));
}

export async function scrollGoogleMapsResults(page: Page): Promise<boolean> {
  const feed = page.locator('[role="feed"]').first();
  if ((await feed.count()) === 0) return false;

  await feed.evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
  });
  return true;
}
