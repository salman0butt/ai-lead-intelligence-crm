import { describe, expect, it } from 'vitest';
import * as discovery from '../src/index.js';

type Comparable = {
  normalizedName: string;
  normalizedAddress: string;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
  normalizedPhone: string | null;
  canonicalDomain: string | null;
};

type Score = {
  nameSimilarity: number;
  addressSimilarity: number;
  score: number;
};

type MatchApi = {
  editSimilarity?: (left: string, right: string) => number;
  tokenJaccard?: (left: string, right: string) => number;
  scoreFuzzyMatch?: (incoming: Comparable, existing: Comparable) => Score;
  hasStrongIdentifierConflict?: (incoming: Comparable, existing: Comparable) => boolean;
  canAutoMergeFuzzy?: (
    best: Score,
    secondBestScore: number | null,
    hasGeographySupport: boolean,
  ) => boolean;
};

const matching = discovery as MatchApi;

const baseIdentity: Comparable = {
  normalizedName: 'acme dental clinic',
  normalizedAddress: '12 main st austin tx',
  normalizedCity: 'austin',
  normalizedPostalCode: '78701',
  normalizedPhone: null,
  canonicalDomain: null,
};

describe('deterministic deduplication similarity', () => {
  it('computes normalized edit similarity in the inclusive zero-to-one range', () => {
    expect(matching.editSimilarity?.('acme', 'acme')).toBe(1);
    expect(matching.editSimilarity?.('', 'acme')).toBe(0);
    expect(matching.editSimilarity?.('acme', '')).toBe(0);
    expect(matching.editSimilarity?.('', '')).toBe(1);

    const near = matching.editSimilarity?.('acme dental', 'acme dentl');
    expect(near).toBeGreaterThan(0.8);
    expect(near).toBeLessThan(1);
  });

  it('computes token Jaccard deterministically', () => {
    expect(matching.tokenJaccard?.('acme dental clinic', 'acme dental clinic')).toBe(1);
    expect(matching.tokenJaccard?.('acme dental', 'different business')).toBe(0);
    expect(matching.tokenJaccard?.('acme dental clinic', 'acme dental group')).toBeCloseTo(0.5);
  });

  it('uses the required fuzzy component weights', () => {
    const existing: Comparable = {
      ...baseIdentity,
      normalizedName: 'acme dental clinc',
      normalizedAddress: '12 main street austin tx',
    };

    const editName = matching.editSimilarity?.(
      baseIdentity.normalizedName,
      existing.normalizedName,
    ) ?? -1;
    const jaccardName = matching.tokenJaccard?.(
      baseIdentity.normalizedName,
      existing.normalizedName,
    ) ?? -1;
    const editAddress = matching.editSimilarity?.(
      baseIdentity.normalizedAddress,
      existing.normalizedAddress,
    ) ?? -1;
    const jaccardAddress = matching.tokenJaccard?.(
      baseIdentity.normalizedAddress,
      existing.normalizedAddress,
    ) ?? -1;

    const score = matching.scoreFuzzyMatch?.(baseIdentity, existing);
    const expectedName = 0.7 * editName + 0.3 * jaccardName;
    const expectedAddress = 0.4 * editAddress + 0.6 * jaccardAddress;

    expect(score?.nameSimilarity).toBeCloseTo(expectedName, 10);
    expect(score?.addressSimilarity).toBeCloseTo(expectedAddress, 10);
    expect(score?.score).toBeCloseTo(0.6 * expectedName + 0.4 * expectedAddress, 10);
  });

  it('vetoes weaker matches only when non-null strong identifiers conflict', () => {
    expect(
      matching.hasStrongIdentifierConflict?.(
        { ...baseIdentity, canonicalDomain: 'a.example' },
        { ...baseIdentity, canonicalDomain: 'b.example' },
      ),
    ).toBe(true);
    expect(
      matching.hasStrongIdentifierConflict?.(
        { ...baseIdentity, normalizedPhone: '+15550001' },
        { ...baseIdentity, normalizedPhone: '+15550002' },
      ),
    ).toBe(true);
    expect(
      matching.hasStrongIdentifierConflict?.(
        { ...baseIdentity, canonicalDomain: 'a.example' },
        { ...baseIdentity, canonicalDomain: null },
      ),
    ).toBe(false);
    expect(
      matching.hasStrongIdentifierConflict?.(
        { ...baseIdentity, canonicalDomain: 'a.example', normalizedPhone: '+15550001' },
        { ...baseIdentity, canonicalDomain: 'a.example', normalizedPhone: '+15550001' },
      ),
    ).toBe(false);
  });

  it('auto-merges at the exact score, component, geography, and ambiguity boundaries', () => {
    const threshold: Score = {
      score: 0.93,
      nameSimilarity: 0.9,
      addressSimilarity: 0.88,
    };

    expect(matching.canAutoMergeFuzzy?.(threshold, null, true)).toBe(true);
    expect(matching.canAutoMergeFuzzy?.(threshold, 0.9, true)).toBe(true);
    expect(matching.canAutoMergeFuzzy?.({ ...threshold, score: 0.9299 }, null, true)).toBe(false);
    expect(
      matching.canAutoMergeFuzzy?.({ ...threshold, nameSimilarity: 0.8999 }, null, true),
    ).toBe(false);
    expect(
      matching.canAutoMergeFuzzy?.({ ...threshold, addressSimilarity: 0.8799 }, null, true),
    ).toBe(false);
    expect(matching.canAutoMergeFuzzy?.(threshold, null, false)).toBe(false);
    expect(matching.canAutoMergeFuzzy?.(threshold, 0.9001, true)).toBe(false);
  });
});
