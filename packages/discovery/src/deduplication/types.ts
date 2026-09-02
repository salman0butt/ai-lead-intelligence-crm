export interface BusinessIdentityInput {
  name: string;
  formattedAddress: string;
  city?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  canonicalDomain?: string | null;
}

export interface NormalizedBusinessIdentity {
  normalizedName: string;
  normalizedAddress: string;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
  normalizedPhone: string | null;
  canonicalDomain: string | null;
}
