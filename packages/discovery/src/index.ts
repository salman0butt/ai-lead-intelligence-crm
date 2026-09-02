export { DiscoveryAccessBlockedError } from './browser/browser-errors.js';
export { BrowserSessionFactory } from './browser/browser-session.js';
export type { BrowserRuntimeOptions, BrowserSession } from './browser/browser-session.js';
export {
  decodeGoogleMapsCursor,
  encodeGoogleMapsCursor,
} from './browser/cursor.js';
export type { GoogleMapsCursorV1 } from './browser/cursor.js';
export { GoogleMapsBrowserProvider } from './browser/google-maps-browser.provider.js';
export type {
  GoogleMapsBrowserListing,
  GoogleMapsBrowserProviderOptions,
} from './browser/google-maps-browser.provider.js';
export {
  buildGoogleMapsSearchUrl,
  mapsListingExternalId,
  normalizeMapsListingUrl,
} from './browser/maps-url.js';
export { OpenAiBrowserPageInterpreter } from './browser/openai-page-interpreter.js';
export {
  captureBrowserPageSnapshot,
  sanitizeBrowserPageSnapshot,
} from './browser/page-interpreter.js';
export type {
  BrowserPageInterpretation,
  BrowserPageInterpreter,
  BrowserPageKind,
  BrowserPageSnapshot,
} from './browser/page-interpreter.js';
export { ConcurrencyLimitedDiscoveryProvider } from './concurrency-limited-provider.js';
export {
  canAutoMergeFuzzy,
  FUZZY_ADDRESS_MIN,
  FUZZY_AMBIGUITY_MARGIN,
  FUZZY_AUTO_MERGE_SCORE,
  FUZZY_LOW_CONFIDENCE_MIN,
  FUZZY_NAME_MIN,
  hasStrongIdentifierConflict,
  scoreFuzzyMatch,
} from './deduplication/match.js';
export type {
  FuzzyComparableIdentity,
  FuzzyScore,
} from './deduplication/match.js';
export {
  normalizeDomain,
  normalizeIdentity,
  normalizePhone,
  normalizePostalCode,
  normalizeText,
} from './deduplication/normalize.js';
export { editSimilarity, tokenJaccard } from './deduplication/similarity.js';
export type {
  BusinessIdentityInput,
  NormalizedBusinessIdentity,
} from './deduplication/types.js';
export { DiscoveryProviderRegistry } from './provider-registry.js';
export { DiscoveryProviderError } from './types.js';
export type {
  BusinessDiscoveryPage,
  BusinessDiscoveryProvider,
  BusinessSearchInput,
  NormalizedBusiness,
} from './types.js';
