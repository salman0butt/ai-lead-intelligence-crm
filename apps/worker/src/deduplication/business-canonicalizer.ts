import {
  DuplicateReason,
  type DatabaseTransactionClient,
} from '@ai-crm/database';
import {
  FUZZY_LOW_CONFIDENCE_MIN,
  canAutoMergeFuzzy,
  hasStrongIdentifierConflict,
  normalizeIdentity,
  scoreFuzzyMatch,
  type FuzzyComparableIdentity,
  type NormalizedBusinessIdentity,
} from '@ai-crm/discovery';

export interface BusinessCanonicalizationResult {
  businessId: string;
  confidence: number;
  reason: DuplicateReason;
}

type CandidateRecord = {
  id: string;
  workspaceId: string;
  provider: string;
  providerExternalId: string;
  name: string;
  formattedAddress: string;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  canonicalDomain: string | null;
  matchedBusinessId: string | null;
  duplicateConfidence: number | null;
  duplicateReason: DuplicateReason | null;
};

type MatchingBusiness = FuzzyComparableIdentity & {
  id: string;
  workspaceId: string;
  phone: string | null;
};

export async function canonicalizeBusinessCandidate(
  tx: DatabaseTransactionClient,
  candidateId: string,
): Promise<BusinessCanonicalizationResult> {
  const candidate = await tx.businessCandidate.findUnique({
    where: { id: candidateId },
  });
  if (!candidate) {
    throw new Error('BusinessCandidate not found for canonicalization');
  }

  if (candidate.matchedBusinessId) {
    return existingAssociation(tx, candidate);
  }

  const normalized = normalizeIdentity(candidate);

  const providerMatch = await findProviderIdentityMatch(tx, candidate);
  if (providerMatch) {
    return linkExisting(
      tx,
      candidate,
      providerMatch,
      normalized,
      1,
      DuplicateReason.PROVIDER_EXTERNAL_ID,
    );
  }

  if (normalized.canonicalDomain) {
    const domainMatches = await tx.business.findMany({
      where: {
        workspaceId: candidate.workspaceId,
        canonicalDomain: normalized.canonicalDomain,
      },
      take: 2,
    });
    if (domainMatches.length === 1) {
      return linkExisting(
        tx,
        candidate,
        domainMatches[0]!,
        normalized,
        0.99,
        DuplicateReason.CANONICAL_DOMAIN,
      );
    }
  }

  if (normalized.normalizedPhone) {
    const phoneMatches = await tx.business.findMany({
      where: {
        workspaceId: candidate.workspaceId,
        normalizedPhone: normalized.normalizedPhone,
      },
      take: 2,
    });
    if (phoneMatches.length === 1) {
      return linkExisting(
        tx,
        candidate,
        phoneMatches[0]!,
        normalized,
        0.99,
        DuplicateReason.PHONE,
      );
    }
  }

  if (normalized.normalizedName && normalized.normalizedAddress) {
    const nameAddressMatches = await tx.business.findMany({
      where: {
        workspaceId: candidate.workspaceId,
        normalizedName: normalized.normalizedName,
        normalizedAddress: normalized.normalizedAddress,
      },
    });
    const eligible = nameAddressMatches.filter(
      (business) => !hasStrongIdentifierConflict(normalized, business),
    );
    if (eligible.length === 1) {
      return linkExisting(
        tx,
        candidate,
        eligible[0]!,
        normalized,
        0.98,
        DuplicateReason.NAME_ADDRESS_EXACT,
      );
    }
  }

  if (
    normalized.normalizedName
    && normalized.normalizedCity
    && normalized.normalizedPostalCode
  ) {
    const nameGeoMatches = await tx.business.findMany({
      where: {
        workspaceId: candidate.workspaceId,
        normalizedName: normalized.normalizedName,
        normalizedCity: normalized.normalizedCity,
        normalizedPostalCode: normalized.normalizedPostalCode,
      },
    });
    const eligible = nameGeoMatches.filter(
      (business) => !hasStrongIdentifierConflict(normalized, business),
    );
    if (eligible.length === 1) {
      return linkExisting(
        tx,
        candidate,
        eligible[0]!,
        normalized,
        0.97,
        DuplicateReason.NAME_CITY_POSTAL_EXACT,
      );
    }
  }

  const fuzzyPool = await findFuzzyPool(tx, candidate.workspaceId, normalized);
  const scored = fuzzyPool
    .filter((business) => !hasStrongIdentifierConflict(normalized, business))
    .map((business) => ({
      business,
      score: scoreFuzzyMatch(normalized, business),
    }))
    .sort((left, right) => {
      const scoreOrder = right.score.score - left.score.score;
      return scoreOrder !== 0 ? scoreOrder : left.business.id.localeCompare(right.business.id);
    });

  const best = scored[0];
  const second = scored[1];
  if (
    best
    && canAutoMergeFuzzy(best.score, second?.score.score ?? null, fuzzyPool.length > 0)
  ) {
    return linkExisting(
      tx,
      candidate,
      best.business,
      normalized,
      best.score.score,
      DuplicateReason.FUZZY_HIGH_CONFIDENCE,
    );
  }

  if (best && best.score.score >= FUZZY_LOW_CONFIDENCE_MIN) {
    return createCanonical(
      tx,
      candidate,
      normalized,
      best.score.score,
      DuplicateReason.FUZZY_LOW_CONFIDENCE_NOT_MERGED,
    );
  }

  return createCanonical(
    tx,
    candidate,
    normalized,
    0,
    DuplicateReason.NEW_CANONICAL,
  );
}

async function existingAssociation(
  tx: DatabaseTransactionClient,
  candidate: CandidateRecord,
): Promise<BusinessCanonicalizationResult> {
  if (
    !candidate.matchedBusinessId
    || candidate.duplicateConfidence === null
    || candidate.duplicateReason === null
  ) {
    throw new Error('BusinessCandidate canonical association is incomplete');
  }

  const business = await tx.business.findUnique({
    where: { id: candidate.matchedBusinessId },
    select: { workspaceId: true },
  });
  if (!business || business.workspaceId !== candidate.workspaceId) {
    throw new Error('BusinessCandidate canonical association violates workspace isolation');
  }

  return {
    businessId: candidate.matchedBusinessId,
    confidence: candidate.duplicateConfidence,
    reason: candidate.duplicateReason,
  };
}

async function findProviderIdentityMatch(
  tx: DatabaseTransactionClient,
  candidate: CandidateRecord,
): Promise<MatchingBusiness | null> {
  const priorCandidates = await tx.businessCandidate.findMany({
    where: {
      id: { not: candidate.id },
      workspaceId: candidate.workspaceId,
      provider: candidate.provider,
      providerExternalId: candidate.providerExternalId,
      matchedBusinessId: { not: null },
    },
    select: { matchedBusinessId: true },
  });

  const businessIds = [...new Set(
    priorCandidates
      .map((item) => item.matchedBusinessId)
      .filter((id): id is string => id !== null),
  )];
  if (businessIds.length !== 1) return null;

  const business = await tx.business.findUnique({
    where: { id: businessIds[0]! },
  });
  if (!business || business.workspaceId !== candidate.workspaceId) return null;
  return business;
}

async function findFuzzyPool(
  tx: DatabaseTransactionClient,
  workspaceId: string,
  normalized: NormalizedBusinessIdentity,
): Promise<MatchingBusiness[]> {
  if (normalized.normalizedPostalCode) {
    return tx.business.findMany({
      where: {
        workspaceId,
        normalizedPostalCode: normalized.normalizedPostalCode,
      },
    });
  }

  if (normalized.normalizedCity) {
    return tx.business.findMany({
      where: {
        workspaceId,
        normalizedCity: normalized.normalizedCity,
      },
    });
  }

  return [];
}

async function linkExisting(
  tx: DatabaseTransactionClient,
  candidate: CandidateRecord,
  business: MatchingBusiness,
  normalized: NormalizedBusinessIdentity,
  confidence: number,
  reason: DuplicateReason,
): Promise<BusinessCanonicalizationResult> {
  if (business.workspaceId !== candidate.workspaceId) {
    throw new Error('Canonical Business must belong to the candidate workspace');
  }

  const businessUpdate: {
    phone?: string;
    normalizedPhone?: string;
    canonicalDomain?: string;
  } = {};
  if (business.phone === null && candidate.phone && normalized.normalizedPhone) {
    businessUpdate.phone = candidate.phone;
    businessUpdate.normalizedPhone = normalized.normalizedPhone;
  }
  if (business.canonicalDomain === null && normalized.canonicalDomain) {
    businessUpdate.canonicalDomain = normalized.canonicalDomain;
  }
  if (Object.keys(businessUpdate).length > 0) {
    await tx.business.update({
      where: { id: business.id },
      data: businessUpdate,
    });
  }

  await tx.businessCandidate.update({
    where: { id: candidate.id },
    data: {
      matchedBusinessId: business.id,
      duplicateConfidence: confidence,
      duplicateReason: reason,
    },
  });

  return { businessId: business.id, confidence, reason };
}

async function createCanonical(
  tx: DatabaseTransactionClient,
  candidate: CandidateRecord,
  normalized: NormalizedBusinessIdentity,
  confidence: number,
  reason: DuplicateReason,
): Promise<BusinessCanonicalizationResult> {
  const business = await tx.business.create({
    data: {
      workspaceId: candidate.workspaceId,
      name: candidate.name,
      normalizedName: normalized.normalizedName,
      formattedAddress: candidate.formattedAddress,
      normalizedAddress: normalized.normalizedAddress,
      city: candidate.city,
      normalizedCity: normalized.normalizedCity,
      postalCode: candidate.postalCode,
      normalizedPostalCode: normalized.normalizedPostalCode,
      phone: candidate.phone,
      normalizedPhone: normalized.normalizedPhone,
      canonicalDomain: normalized.canonicalDomain,
    },
  });

  await tx.businessCandidate.update({
    where: { id: candidate.id },
    data: {
      matchedBusinessId: business.id,
      duplicateConfidence: confidence,
      duplicateReason: reason,
    },
  });

  return { businessId: business.id, confidence, reason };
}
