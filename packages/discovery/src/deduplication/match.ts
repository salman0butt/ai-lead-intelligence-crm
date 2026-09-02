import { editSimilarity, tokenJaccard } from './similarity.js';

export const FUZZY_AUTO_MERGE_SCORE = 0.93;
export const FUZZY_NAME_MIN = 0.9;
export const FUZZY_ADDRESS_MIN = 0.88;
export const FUZZY_AMBIGUITY_MARGIN = 0.03;
export const FUZZY_LOW_CONFIDENCE_MIN = 0.8;

export interface FuzzyComparableIdentity {
  normalizedName: string;
  normalizedAddress: string;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
  normalizedPhone: string | null;
  canonicalDomain: string | null;
}

export interface FuzzyScore {
  nameSimilarity: number;
  addressSimilarity: number;
  score: number;
}

export function scoreFuzzyMatch(
  incoming: FuzzyComparableIdentity,
  existing: FuzzyComparableIdentity,
): FuzzyScore {
  const nameSimilarity =
    0.7 * editSimilarity(incoming.normalizedName, existing.normalizedName)
    + 0.3 * tokenJaccard(incoming.normalizedName, existing.normalizedName);
  const addressSimilarity =
    0.4 * editSimilarity(incoming.normalizedAddress, existing.normalizedAddress)
    + 0.6 * tokenJaccard(incoming.normalizedAddress, existing.normalizedAddress);

  return {
    nameSimilarity,
    addressSimilarity,
    score: 0.6 * nameSimilarity + 0.4 * addressSimilarity,
  };
}

export function hasStrongIdentifierConflict(
  incoming: FuzzyComparableIdentity,
  existing: FuzzyComparableIdentity,
): boolean {
  const domainConflict =
    incoming.canonicalDomain !== null
    && existing.canonicalDomain !== null
    && incoming.canonicalDomain !== existing.canonicalDomain;
  const phoneConflict =
    incoming.normalizedPhone !== null
    && existing.normalizedPhone !== null
    && incoming.normalizedPhone !== existing.normalizedPhone;

  return domainConflict || phoneConflict;
}

export function canAutoMergeFuzzy(
  best: FuzzyScore,
  secondBestScore: number | null,
  hasGeographySupport: boolean,
): boolean {
  if (!hasGeographySupport) return false;
  if (best.score < FUZZY_AUTO_MERGE_SCORE) return false;
  if (best.nameSimilarity < FUZZY_NAME_MIN) return false;
  if (best.addressSimilarity < FUZZY_ADDRESS_MIN) return false;
  if (secondBestScore === null) return true;

  return best.score - secondBestScore >= FUZZY_AMBIGUITY_MARGIN;
}
