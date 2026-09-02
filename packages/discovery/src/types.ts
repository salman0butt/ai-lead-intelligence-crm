export interface BusinessSearchInput {
  query: string;
  country: string;
  region: string;
  city: string;
  geographicCell: string;
  pageSize?: number;
}

export interface BusinessDiscoveryPage<TRaw> {
  results: readonly TRaw[];
  nextCursor: string | null;
}

export interface NormalizedBusiness {
  providerExternalId: string;
  name: string;
  formattedAddress: string;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  rawReference: string | null;
}

export interface BusinessDiscoveryProvider<TRaw = unknown> {
  readonly name: string;
  searchBusinesses(input: BusinessSearchInput): Promise<BusinessDiscoveryPage<TRaw>>;
  continueSearch(input: BusinessSearchInput, cursor: string): Promise<BusinessDiscoveryPage<TRaw>>;
  normalizeResult(raw: TRaw): NormalizedBusiness;
  close?(): Promise<void>;
}

export class DiscoveryProviderError extends Error {
  readonly statusCode: number;
  readonly rateLimited: boolean;

  constructor(message: string, statusCode: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscoveryProviderError';
    this.statusCode = statusCode;
    this.rateLimited = statusCode === 429;
  }
}
