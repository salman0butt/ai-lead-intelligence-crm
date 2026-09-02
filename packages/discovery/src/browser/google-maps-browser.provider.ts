import type { BrowserSession } from './browser-session.js';
import { BrowserSessionFactory } from './browser-session.js';
import { DiscoveryAccessBlockedError } from './browser-errors.js';
import {
  decodeGoogleMapsCursor,
  encodeGoogleMapsCursor,
  type GoogleMapsCursorV1,
} from './cursor.js';
import {
  extractGoogleMapsListings,
  hasReachedGoogleMapsEnd,
  isGoogleMapsAccessBlocked,
  scrollGoogleMapsResults,
  type GoogleMapsBrowserListing,
} from './maps-listing-extractor.js';
import {
  buildGoogleMapsSearchUrl,
  mapsListingExternalId,
  normalizeMapsListingUrl,
} from './maps-url.js';
import {
  captureBrowserPageSnapshot,
  type BrowserPageInterpreter,
  type BrowserPageKind,
} from './page-interpreter.js';
import {
  DiscoveryProviderError,
  type BusinessDiscoveryPage,
  type BusinessDiscoveryProvider,
  type BusinessSearchInput,
  type NormalizedBusiness,
} from '../types.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_SEEN_IDS = 500;
const MAX_SCROLL_ROUNDS = 100;
const MAX_EMPTY_SCROLL_ROUNDS = 3;

export interface GoogleMapsBrowserProviderOptions {
  sessionFactory?: BrowserSessionFactory;
  searchUrlBuilder?: (input: BusinessSearchInput) => string;
  scrollPauseMs?: number;
  interpreter?: BrowserPageInterpreter;
}

function defaultSearchUrl(input: BusinessSearchInput): string {
  const place =
    input.geographicCell.trim() ||
    input.city.trim() ||
    input.region.trim() ||
    input.country.trim();
  if (!input.query.trim() || !place) {
    throw new Error('Google Maps browser discovery requires a query and geographic target');
  }
  return buildGoogleMapsSearchUrl(`${input.query.trim()} in ${place}`);
}

function pageSizeFor(input: BusinessSearchInput): number {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`Discovery pageSize must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return pageSize;
}

async function closeSession(session: BrowserSession): Promise<void> {
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
}

export class GoogleMapsBrowserProvider
  implements BusinessDiscoveryProvider<GoogleMapsBrowserListing>
{
  readonly name = 'google-maps-browser';

  private readonly sessionFactory: BrowserSessionFactory;
  private readonly searchUrlBuilder: (input: BusinessSearchInput) => string;
  private readonly scrollPauseMs: number;
  private readonly interpreter: BrowserPageInterpreter | undefined;

  constructor(options: GoogleMapsBrowserProviderOptions = {}) {
    this.sessionFactory =
      options.sessionFactory ??
      new BrowserSessionFactory({
        headless: true,
        navigationTimeoutMs: 30_000,
        actionTimeoutMs: 10_000,
      });
    this.searchUrlBuilder = options.searchUrlBuilder ?? defaultSearchUrl;
    this.scrollPauseMs = options.scrollPauseMs ?? 750;
    this.interpreter = options.interpreter;

    if (!Number.isFinite(this.scrollPauseMs) || this.scrollPauseMs < 0) {
      throw new Error('Google Maps browser scroll pause must be non-negative');
    }
  }

  async searchBusinesses(
    input: BusinessSearchInput,
  ): Promise<BusinessDiscoveryPage<GoogleMapsBrowserListing>> {
    return this.runSearch(input, { v: 1, seenIds: [], scrollRounds: 0 });
  }

  async continueSearch(
    input: BusinessSearchInput,
    cursor: string,
  ): Promise<BusinessDiscoveryPage<GoogleMapsBrowserListing>> {
    return this.runSearch(input, decodeGoogleMapsCursor(cursor));
  }

  normalizeResult(raw: GoogleMapsBrowserListing): NormalizedBusiness {
    const rawReference = normalizeMapsListingUrl(raw.listingUrl);
    return {
      providerExternalId: mapsListingExternalId(raw.listingUrl),
      name: raw.name.trim(),
      formattedAddress: raw.formattedAddress.trim(),
      category: raw.category?.trim() || null,
      latitude: raw.latitude,
      longitude: raw.longitude,
      rawReference,
    };
  }

  async close(): Promise<void> {
    // Sessions are intentionally opened and closed per page so continuation never depends on
    // process-local browser state. Durable continuation lives only in the cursor persisted by the worker.
  }

  private async runSearch(
    input: BusinessSearchInput,
    cursor: GoogleMapsCursorV1,
  ): Promise<BusinessDiscoveryPage<GoogleMapsBrowserListing>> {
    const pageSize = pageSizeFor(input);
    const session = await this.sessionFactory.open();

    try {
      await session.page.goto(this.searchUrlBuilder(input), { waitUntil: 'domcontentloaded' });
      if (this.scrollPauseMs > 0) await session.page.waitForTimeout(this.scrollPauseMs);
      await this.assertAccessAllowed(session);

      const seenIds = new Set(cursor.seenIds);
      const results: GoogleMapsBrowserListing[] = [];
      let scrollRounds = cursor.scrollRounds;
      let emptyScrollRounds = 0;
      let hasScrolled = false;
      let interpreterUsed = false;

      while (true) {
        const rendered = await extractGoogleMapsListings(session.page);
        const fresh = rendered.filter(
          (listing) => !seenIds.has(mapsListingExternalId(listing.listingUrl)),
        );

        let accepted = 0;
        for (const listing of fresh) {
          if (results.length >= pageSize || seenIds.size >= MAX_SEEN_IDS) break;
          seenIds.add(mapsListingExternalId(listing.listingUrl));
          results.push(listing);
          accepted += 1;
        }

        const reachedEnd = await hasReachedGoogleMapsEnd(session.page);
        const hasRenderedRemainder = fresh.length > accepted;

        if (results.length >= pageSize || seenIds.size >= MAX_SEEN_IDS) {
          return {
            results,
            nextCursor:
              reachedEnd && !hasRenderedRemainder
                ? null
                : encodeGoogleMapsCursor({
                    v: 1,
                    seenIds: [...seenIds],
                    scrollRounds,
                  }),
          };
        }

        if (reachedEnd) return { results, nextCursor: null };

        if (
          rendered.length === 0 &&
          results.length === 0 &&
          this.interpreter &&
          !interpreterUsed
        ) {
          interpreterUsed = true;
          const interpretation = await this.interpreter.interpret(
            await captureBrowserPageSnapshot(session.page),
          );
          const terminal = this.handleInterpretation(interpretation.kind);
          if (terminal) return terminal;
        }

        if (hasScrolled) {
          emptyScrollRounds = fresh.length === 0 ? emptyScrollRounds + 1 : 0;
          if (emptyScrollRounds >= MAX_EMPTY_SCROLL_ROUNDS) {
            return { results, nextCursor: null };
          }
        }

        if (scrollRounds >= MAX_SCROLL_ROUNDS) {
          return { results, nextCursor: null };
        }

        const scrolled = await scrollGoogleMapsResults(session.page);
        if (!scrolled) {
          if (interpreterUsed) {
            throw new DiscoveryProviderError(
              'Google Maps browser page layout could not be safely interpreted',
              422,
            );
          }
          return { results, nextCursor: null };
        }

        scrollRounds += 1;
        hasScrolled = true;
        if (this.scrollPauseMs > 0) await session.page.waitForTimeout(this.scrollPauseMs);
        await this.assertAccessAllowed(session);
      }
    } finally {
      await closeSession(session);
    }
  }

  private handleInterpretation(
    kind: BrowserPageKind,
  ): BusinessDiscoveryPage<GoogleMapsBrowserListing> | null {
    if (kind === 'NO_RESULTS') return { results: [], nextCursor: null };
    if (kind === 'BLOCKED_OR_CAPTCHA') {
      throw new DiscoveryAccessBlockedError(
        'Google Maps browser discovery stopped because the page was classified as blocked or CAPTCHA-protected',
      );
    }
    if (kind === 'CONSENT_PAGE') {
      throw new DiscoveryAccessBlockedError(
        'Google Maps browser discovery stopped because a consent page requires user interaction',
        { rateLimited: false },
      );
    }
    if (kind === 'UNKNOWN_LAYOUT') {
      throw new DiscoveryProviderError(
        'Google Maps browser page layout could not be safely interpreted',
        422,
      );
    }
    return null;
  }

  private async assertAccessAllowed(session: BrowserSession): Promise<void> {
    if (await isGoogleMapsAccessBlocked(session.page)) {
      throw new DiscoveryAccessBlockedError(
        'Google Maps browser discovery stopped because the public page presented an access block or CAPTCHA',
      );
    }
  }
}

export type { GoogleMapsBrowserListing } from './maps-listing-extractor.js';
