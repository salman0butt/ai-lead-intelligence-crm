import {
  DiscoveryProviderError,
  type BusinessDiscoveryPage,
  type BusinessDiscoveryProvider,
  type BusinessSearchInput,
  type NormalizedBusiness,
} from './types.js';

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.primaryType,places.location,nextPageToken';

export interface GooglePlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  primaryType?: string;
  location?: { latitude?: number; longitude?: number };
}

interface GooglePlacesResponse {
  places?: GooglePlaceResult[];
  nextPageToken?: string | null;
  error?: { message?: string };
}

export class GooglePlacesDiscoveryProvider
  implements BusinessDiscoveryProvider<GooglePlaceResult>
{
  readonly name = 'google-places';
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, fetcher: typeof fetch = fetch) {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) throw new Error('Google Places API key is required');
    this.apiKey = trimmedKey;
    this.fetcher = fetcher;
  }

  searchBusinesses(
    input: BusinessSearchInput,
  ): Promise<BusinessDiscoveryPage<GooglePlaceResult>> {
    return this.search(input);
  }

  getNextPage(
    input: BusinessSearchInput,
    pageToken: string,
  ): Promise<BusinessDiscoveryPage<GooglePlaceResult>> {
    const trimmedToken = pageToken.trim();
    if (!trimmedToken) throw new Error('Google Places page token is required');
    return this.search(input, trimmedToken);
  }

  normalizeResult(raw: GooglePlaceResult): NormalizedBusiness {
    const providerExternalId = raw.id?.trim();
    const name = raw.displayName?.text?.trim();
    if (!providerExternalId) throw new Error('Google Places result is missing place id');
    if (!name) throw new Error(`Google Places result ${providerExternalId} is missing display name`);

    return {
      providerExternalId,
      name,
      formattedAddress: raw.formattedAddress?.trim() ?? '',
      category: raw.primaryType?.trim() || null,
      latitude: typeof raw.location?.latitude === 'number' ? raw.location.latitude : null,
      longitude: typeof raw.location?.longitude === 'number' ? raw.location.longitude : null,
      rawReference: `google-place:${providerExternalId}`,
    };
  }

  private async search(
    input: BusinessSearchInput,
    pageToken?: string,
  ): Promise<BusinessDiscoveryPage<GooglePlaceResult>> {
    const place =
      input.geographicCell.trim() ||
      input.city.trim() ||
      input.region.trim() ||
      input.country.trim();
    const query = input.query.trim();
    if (!query) throw new Error('Business search query is required');
    if (!place) throw new Error('Business search geography is required');

    const body: Record<string, string | number> = {
      textQuery: `${query} in ${place}`,
      pageSize: input.pageSize ?? 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const response = await this.fetcher(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    const payload = await this.readJson(response);
    if (!response.ok) {
      const message = payload.error?.message?.trim() || `Google Places request failed with HTTP ${response.status}`;
      throw new DiscoveryProviderError(message, response.status);
    }

    return {
      results: Array.isArray(payload.places) ? payload.places : [],
      nextPageToken: payload.nextPageToken?.trim() || null,
    };
  }

  private async readJson(response: Response): Promise<GooglePlacesResponse> {
    try {
      return (await response.json()) as GooglePlacesResponse;
    } catch (cause) {
      throw new DiscoveryProviderError(
        `Google Places returned an invalid JSON response with HTTP ${response.status}`,
        response.status,
        { cause },
      );
    }
  }
}
