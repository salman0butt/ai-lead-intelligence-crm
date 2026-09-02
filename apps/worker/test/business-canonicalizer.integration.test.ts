import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  CampaignStatus,
  DuplicateReason,
  createPrismaClient,
} from '@ai-crm/database';
import { normalizeIdentity } from '@ai-crm/discovery';
import {
  canonicalizeBusinessCandidate,
} from '../src/deduplication/business-canonicalizer.js';
import {
  acquireWorkspaceCanonicalizationLock,
} from '../src/deduplication/workspace-lock.js';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('business canonicalizer', () => {
  const database = createPrismaClient(databaseUrl!);
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    if (workspaceIds.length) {
      await database.workspace.deleteMany({
        where: { id: { in: workspaceIds.splice(0) } },
      });
    }
    if (userIds.length) {
      await database.user.deleteMany({
        where: { id: { in: userIds.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  async function createContext(label: string) {
    const suffix = randomUUID();
    const user = await database.user.create({
      data: {
        email: `m5-canonicalizer-${label}-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'M5 Canonicalizer User',
      },
    });
    userIds.push(user.id);

    const workspace = await database.workspace.create({
      data: { name: `M5 Canonicalizer ${label} ${suffix}` },
    });
    workspaceIds.push(workspace.id);

    const campaign = await createCampaign(workspace.id, user.id, `${label}-one`);
    return {
      userId: user.id,
      workspaceId: workspace.id,
      campaignId: campaign.id,
    };
  }

  async function createCampaign(workspaceId: string, userId: string, label: string) {
    return database.campaign.create({
      data: {
        workspaceId,
        createdByUserId: userId,
        name: `M5 ${label}`,
        country: 'United States',
        region: 'Texas',
        city: 'Austin',
        niche: 'Dentist',
        requestedLeadCount: 100,
        status: CampaignStatus.DISCOVERING,
      },
    });
  }

  async function createCandidate(input: {
    workspaceId: string;
    campaignId: string;
    providerExternalId?: string;
    provider?: string;
    name?: string;
    formattedAddress?: string;
    city?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    canonicalDomain?: string | null;
  }) {
    return database.businessCandidate.create({
      data: {
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        provider: input.provider ?? 'google-maps-browser',
        providerExternalId: input.providerExternalId ?? `maps-url-sha256:${randomUUID()}`,
        name: input.name ?? 'Acme Dental',
        formattedAddress: input.formattedAddress ?? '12 Main St, Austin, TX 78701',
        city: input.city,
        postalCode: input.postalCode,
        phone: input.phone,
        canonicalDomain: input.canonicalDomain,
      },
    });
  }

  async function seedBusiness(input: {
    workspaceId: string;
    name: string;
    formattedAddress: string;
    city?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    canonicalDomain?: string | null;
  }) {
    const normalized = normalizeIdentity(input);
    return database.business.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        normalizedName: normalized.normalizedName,
        formattedAddress: input.formattedAddress,
        normalizedAddress: normalized.normalizedAddress,
        city: input.city,
        normalizedCity: normalized.normalizedCity,
        postalCode: input.postalCode,
        normalizedPostalCode: normalized.normalizedPostalCode,
        phone: input.phone,
        normalizedPhone: normalized.normalizedPhone,
        canonicalDomain: normalized.canonicalDomain,
      },
    });
  }

  async function canonicalize(workspaceId: string, candidateId: string) {
    return database.$transaction(async (tx) => {
      await acquireWorkspaceCanonicalizationLock(tx, workspaceId);
      return canonicalizeBusinessCandidate(tx, candidateId);
    });
  }

  it('reuses provider identity across campaigns and remains idempotent on replay', async () => {
    const context = await createContext('provider');
    const secondCampaign = await createCampaign(context.workspaceId, context.userId, 'provider-two');
    const providerExternalId = `maps-url-sha256:${randomUUID()}`;

    const first = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      providerExternalId,
    });
    const second = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: secondCampaign.id,
      providerExternalId,
      name: 'Acme Dental Updated Listing',
      formattedAddress: '12 Main Street, Austin, TX 78701',
    });

    const firstResult = await canonicalize(context.workspaceId, first.id);
    const secondResult = await canonicalize(context.workspaceId, second.id);
    const replayResult = await canonicalize(context.workspaceId, second.id);

    expect(firstResult).toMatchObject({
      confidence: 0,
      reason: DuplicateReason.NEW_CANONICAL,
    });
    expect(secondResult).toEqual({
      businessId: firstResult.businessId,
      confidence: 1,
      reason: DuplicateReason.PROVIDER_EXTERNAL_ID,
    });
    expect(replayResult).toEqual(secondResult);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(1);
  });

  it('matches exact canonical domain before weaker identity rules', async () => {
    const context = await createContext('domain');
    const first = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      canonicalDomain: 'https://www.acme.example/path',
    });
    const secondCampaign = await createCampaign(context.workspaceId, context.userId, 'domain-two');
    const second = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: secondCampaign.id,
      name: 'Completely Different Display Name',
      formattedAddress: '99 Other Road, Austin, TX 78702',
      canonicalDomain: 'ACME.example',
    });

    const firstResult = await canonicalize(context.workspaceId, first.id);
    const secondResult = await canonicalize(context.workspaceId, second.id);

    expect(secondResult).toEqual({
      businessId: firstResult.businessId,
      confidence: 0.99,
      reason: DuplicateReason.CANONICAL_DOMAIN,
    });
  });

  it('matches exact normalized phone', async () => {
    const context = await createContext('phone');
    const first = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      phone: '+1 (512) 555-0100',
    });
    const secondCampaign = await createCampaign(context.workspaceId, context.userId, 'phone-two');
    const second = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: secondCampaign.id,
      name: 'Phone Match Alternate',
      formattedAddress: '99 Other Road, Austin, TX 78702',
      phone: '+1 512 555 0100',
    });

    const firstResult = await canonicalize(context.workspaceId, first.id);
    const secondResult = await canonicalize(context.workspaceId, second.id);

    expect(secondResult).toEqual({
      businessId: firstResult.businessId,
      confidence: 0.99,
      reason: DuplicateReason.PHONE,
    });
  });

  it('matches normalized name and address exactly', async () => {
    const context = await createContext('name-address');
    const first = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'ACME, Dental LLC',
      formattedAddress: '12 Main St., Austin, TX',
    });
    const secondCampaign = await createCampaign(context.workspaceId, context.userId, 'name-address-two');
    const second = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: secondCampaign.id,
      name: 'acme dental llc',
      formattedAddress: '12 MAIN ST AUSTIN TX',
    });

    const firstResult = await canonicalize(context.workspaceId, first.id);
    const secondResult = await canonicalize(context.workspaceId, second.id);

    expect(secondResult).toEqual({
      businessId: firstResult.businessId,
      confidence: 0.98,
      reason: DuplicateReason.NAME_ADDRESS_EXACT,
    });
  });

  it('matches normalized name, city, and postal code when addresses differ', async () => {
    const context = await createContext('name-city-postal');
    const first = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'Acme Dental',
      formattedAddress: '12 Main St',
      city: 'Austin',
      postalCode: '787 01',
    });
    const secondCampaign = await createCampaign(context.workspaceId, context.userId, 'name-city-postal-two');
    const second = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: secondCampaign.id,
      name: 'ACME DENTAL',
      formattedAddress: 'Suite 900, Different Building',
      city: 'AUSTIN',
      postalCode: '78701',
    });

    const firstResult = await canonicalize(context.workspaceId, first.id);
    const secondResult = await canonicalize(context.workspaceId, second.id);

    expect(secondResult).toEqual({
      businessId: firstResult.businessId,
      confidence: 0.97,
      reason: DuplicateReason.NAME_CITY_POSTAL_EXACT,
    });
  });

  it('never links matching provider identity across workspaces', async () => {
    const left = await createContext('workspace-left');
    const right = await createContext('workspace-right');
    const providerExternalId = `maps-url-sha256:${randomUUID()}`;
    const leftCandidate = await createCandidate({
      workspaceId: left.workspaceId,
      campaignId: left.campaignId,
      providerExternalId,
    });
    const rightCandidate = await createCandidate({
      workspaceId: right.workspaceId,
      campaignId: right.campaignId,
      providerExternalId,
    });

    const leftResult = await canonicalize(left.workspaceId, leftCandidate.id);
    const rightResult = await canonicalize(right.workspaceId, rightCandidate.id);

    expect(rightResult.businessId).not.toBe(leftResult.businessId);
    expect(await database.business.count()).toBe(2);
  });

  it('does not choose an arbitrary canonical business for ambiguous exact matches', async () => {
    const context = await createContext('exact-ambiguity');
    await seedBusiness({
      workspaceId: context.workspaceId,
      name: 'Acme Dental',
      formattedAddress: '12 Main St, Austin, TX',
    });
    await seedBusiness({
      workspaceId: context.workspaceId,
      name: 'Acme Dental',
      formattedAddress: '12 Main St, Austin, TX',
    });
    const candidate = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'ACME DENTAL',
      formattedAddress: '12 MAIN ST AUSTIN TX',
    });

    const result = await canonicalize(context.workspaceId, candidate.id);

    expect(result.reason).toBe(DuplicateReason.NEW_CANONICAL);
    expect(result.confidence).toBe(0);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(3);
  });

  it('vetoes weaker exact matching when available strong identifiers conflict', async () => {
    const context = await createContext('conflict');
    await seedBusiness({
      workspaceId: context.workspaceId,
      name: 'Acme Dental',
      formattedAddress: '12 Main St, Austin, TX',
      canonicalDomain: 'one.example',
    });
    const candidate = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'Acme Dental',
      formattedAddress: '12 Main St, Austin, TX',
      canonicalDomain: 'two.example',
    });

    const result = await canonicalize(context.workspaceId, candidate.id);

    expect(result.reason).toBe(DuplicateReason.NEW_CANONICAL);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(2);
  });

  it('auto-merges only a uniquely supported high-confidence fuzzy match', async () => {
    const context = await createContext('fuzzy-high');
    const existing = await seedBusiness({
      workspaceId: context.workspaceId,
      name: 'North Austin Advanced Family Cosmetic Dental Care and Orthodontic Wellness Center Group',
      formattedAddress: '1234 West Main Street Building One Floor Two Suite 200 Near Central Park Austin Texas',
      city: 'Austin',
    });
    const candidate = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'North Austin Advanced Family Cosmetic Dental Care and Orthodontic Wellness Centre Group',
      formattedAddress: '1234 West Main Street Building One Floor Two Suite 201 Near Central Park Austin Texas',
      city: 'Austin',
    });

    const result = await canonicalize(context.workspaceId, candidate.id);

    expect(result.businessId).toBe(existing.id);
    expect(result.reason).toBe(DuplicateReason.FUZZY_HIGH_CONFIDENCE);
    expect(result.confidence).toBeGreaterThanOrEqual(0.93);
  });

  it('does not fuzzy-merge without supporting geography', async () => {
    const context = await createContext('fuzzy-no-geo');
    await seedBusiness({
      workspaceId: context.workspaceId,
      name: 'North Austin Advanced Family Cosmetic Dental Care and Orthodontic Wellness Center Group',
      formattedAddress: '1234 West Main Street Building One Floor Two Suite 200 Near Central Park Austin Texas',
    });
    const candidate = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'North Austin Advanced Family Cosmetic Dental Care and Orthodontic Wellness Centre Group',
      formattedAddress: '1234 West Main Street Building One Floor Two Suite 201 Near Central Park Austin Texas',
    });

    const result = await canonicalize(context.workspaceId, candidate.id);

    expect(result.reason).toBe(DuplicateReason.NEW_CANONICAL);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(2);
  });

  it('records a rejected low-confidence fuzzy comparison without merging', async () => {
    const context = await createContext('fuzzy-low');
    await seedBusiness({
      workspaceId: context.workspaceId,
      name: 'Bright Smile Dental',
      formattedAddress: '123 Main Street Suite 2',
      city: 'Austin',
    });
    const candidate = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'Bright Smiles Dental',
      formattedAddress: '123 Main Street Suite 2A',
      city: 'Austin',
    });

    const result = await canonicalize(context.workspaceId, candidate.id);

    expect(result.reason).toBe(DuplicateReason.FUZZY_LOW_CONFIDENCE_NOT_MERGED);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.confidence).toBeLessThan(0.93);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(2);
  });

  it('rejects ambiguous high fuzzy candidates when the best score lacks the margin', async () => {
    const context = await createContext('fuzzy-ambiguous');
    const seed = {
      workspaceId: context.workspaceId,
      name: 'North Austin Advanced Family Cosmetic Dental Care and Orthodontic Wellness Center Group',
      formattedAddress: '1234 West Main Street Building One Floor Two Suite 200 Near Central Park Austin Texas',
      city: 'Austin',
    };
    await seedBusiness(seed);
    await seedBusiness(seed);
    const candidate = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      name: 'North Austin Advanced Family Cosmetic Dental Care and Orthodontic Wellness Centre Group',
      formattedAddress: '1234 West Main Street Building One Floor Two Suite 201 Near Central Park Austin Texas',
      city: 'Austin',
    });

    const result = await canonicalize(context.workspaceId, candidate.id);

    expect(result.reason).toBe(DuplicateReason.FUZZY_LOW_CONFIDENCE_NOT_MERGED);
    expect(result.confidence).toBeGreaterThanOrEqual(0.93);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(3);
  });

  it('serializes concurrent equivalent candidates within a workspace', async () => {
    const context = await createContext('concurrency');
    const secondCampaign = await createCampaign(context.workspaceId, context.userId, 'concurrency-two');
    const providerExternalId = `maps-url-sha256:${randomUUID()}`;
    const first = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      providerExternalId,
    });
    const second = await createCandidate({
      workspaceId: context.workspaceId,
      campaignId: secondCampaign.id,
      providerExternalId,
    });

    await Promise.all([
      canonicalize(context.workspaceId, first.id),
      canonicalize(context.workspaceId, second.id),
    ]);

    const candidates = await database.businessCandidate.findMany({
      where: { id: { in: [first.id, second.id] } },
    });
    expect(new Set(candidates.map((row) => row.matchedBusinessId)).size).toBe(1);
    expect(await database.business.count({ where: { workspaceId: context.workspaceId } })).toBe(1);
  });
});
