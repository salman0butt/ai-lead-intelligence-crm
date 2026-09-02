import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  CampaignStatus,
  DuplicateReason,
  createPrismaClient,
} from '@ai-crm/database';
import { normalizeIdentity } from '@ai-crm/discovery';
import { backfillBusinessCandidates } from '../src/deduplication/canonicalization-backfill.js';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('candidate canonicalization backfill', () => {
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
        email: `m5-backfill-${label}-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'M5 Backfill User',
      },
    });
    userIds.push(user.id);
    const workspace = await database.workspace.create({
      data: { name: `M5 Backfill ${label} ${suffix}` },
    });
    workspaceIds.push(workspace.id);
    return { user, workspace };
  }

  async function createCampaign(workspaceId: string, userId: string, label: string) {
    return database.campaign.create({
      data: {
        workspaceId,
        createdByUserId: userId,
        name: `M5 Backfill ${label}`,
        country: 'United States',
        region: 'Texas',
        city: 'Austin',
        niche: 'Dentist',
        requestedLeadCount: 100,
        status: CampaignStatus.DISCOVERING,
      },
    });
  }

  it('canonicalizes pre-M5 candidates in bounded workspace batches using the live matching rules', async () => {
    const context = await createContext('batch');
    const isolated = await createContext('batch-isolated');
    const firstCampaign = await createCampaign(context.workspace.id, context.user.id, 'first');
    const secondCampaign = await createCampaign(context.workspace.id, context.user.id, 'second');
    const isolatedCampaign = await createCampaign(
      isolated.workspace.id,
      isolated.user.id,
      'isolated',
    );
    const providerExternalId = `maps-url-sha256:${randomUUID()}`;

    const first = await database.businessCandidate.create({
      data: {
        workspaceId: context.workspace.id,
        campaignId: firstCampaign.id,
        provider: 'google-maps-browser',
        providerExternalId,
        name: 'Legacy Dental',
        formattedAddress: '123 Main St, Austin, TX',
      },
    });
    const second = await database.businessCandidate.create({
      data: {
        workspaceId: context.workspace.id,
        campaignId: secondCampaign.id,
        provider: 'google-maps-browser',
        providerExternalId,
        name: 'Legacy Dental Updated',
        formattedAddress: '123 Main Street, Austin, TX',
      },
    });
    const isolatedCandidate = await database.businessCandidate.create({
      data: {
        workspaceId: isolated.workspace.id,
        campaignId: isolatedCampaign.id,
        provider: 'google-maps-browser',
        providerExternalId,
        name: 'Legacy Dental',
        formattedAddress: '123 Main St, Austin, TX',
      },
    });

    await expect(backfillBusinessCandidates(database, { batchSize: 1 })).resolves.toEqual({
      processed: 3,
      matched: 3,
    });

    const rows = await database.businessCandidate.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { createdAt: 'asc' },
    });
    const isolatedRow = await database.businessCandidate.findUniqueOrThrow({
      where: { id: isolatedCandidate.id },
    });

    expect(rows[0]?.matchedBusinessId).not.toBeNull();
    expect(rows[0]?.duplicateReason).toBe(DuplicateReason.NEW_CANONICAL);
    expect(rows[1]?.matchedBusinessId).toBe(rows[0]?.matchedBusinessId);
    expect(rows[1]?.duplicateReason).toBe(DuplicateReason.PROVIDER_EXTERNAL_ID);
    expect(rows[1]?.duplicateConfidence).toBe(1);
    expect(isolatedRow.matchedBusinessId).not.toBe(rows[0]?.matchedBusinessId);
    expect(isolatedRow.duplicateReason).toBe(DuplicateReason.NEW_CANONICAL);
    expect(await database.business.count({
      where: { workspaceId: context.workspace.id },
    })).toBe(1);
    expect(await database.business.count({
      where: { workspaceId: isolated.workspace.id },
    })).toBe(1);
  });

  it('defaults the batch size and is restart-safe when run twice', async () => {
    const context = await createContext('restart');
    const campaign = await createCampaign(context.workspace.id, context.user.id, 'restart');
    await database.businessCandidate.create({
      data: {
        workspaceId: context.workspace.id,
        campaignId: campaign.id,
        provider: 'google-maps-browser',
        providerExternalId: `maps-url-sha256:${randomUUID()}`,
        name: 'Restart Dental',
        formattedAddress: '456 Main St, Austin, TX',
      },
    });

    await expect(backfillBusinessCandidates(database)).resolves.toEqual({
      processed: 1,
      matched: 1,
    });
    await expect(backfillBusinessCandidates(database)).resolves.toEqual({
      processed: 0,
      matched: 0,
    });
    expect(await database.business.count({
      where: { workspaceId: context.workspace.id },
    })).toBe(1);
  });

  it('skips already canonicalized candidates while processing unmatched candidates', async () => {
    const context = await createContext('skip');
    const campaign = await createCampaign(context.workspace.id, context.user.id, 'skip');
    const normalized = normalizeIdentity({
      name: 'Already Canonical',
      formattedAddress: '789 Main St, Austin, TX',
    });
    const existingBusiness = await database.business.create({
      data: {
        workspaceId: context.workspace.id,
        name: 'Already Canonical',
        normalizedName: normalized.normalizedName,
        formattedAddress: '789 Main St, Austin, TX',
        normalizedAddress: normalized.normalizedAddress,
      },
    });
    await database.businessCandidate.create({
      data: {
        workspaceId: context.workspace.id,
        campaignId: campaign.id,
        provider: 'google-maps-browser',
        providerExternalId: `maps-url-sha256:${randomUUID()}`,
        name: 'Already Canonical',
        formattedAddress: '789 Main St, Austin, TX',
        matchedBusinessId: existingBusiness.id,
        duplicateConfidence: 0,
        duplicateReason: DuplicateReason.NEW_CANONICAL,
      },
    });
    const unmatched = await database.businessCandidate.create({
      data: {
        workspaceId: context.workspace.id,
        campaignId: campaign.id,
        provider: 'google-maps-browser',
        providerExternalId: `maps-url-sha256:${randomUUID()}`,
        name: 'New Legacy Dental',
        formattedAddress: '999 Main St, Austin, TX',
      },
    });

    await expect(backfillBusinessCandidates(database, { batchSize: 10 })).resolves.toEqual({
      processed: 1,
      matched: 1,
    });
    expect((await database.businessCandidate.findUniqueOrThrow({
      where: { id: unmatched.id },
    })).matchedBusinessId).not.toBeNull();
    expect(await database.business.count({
      where: { workspaceId: context.workspace.id },
    })).toBe(2);
  });

  it('rejects invalid batch sizes before changing database state', async () => {
    await expect(backfillBusinessCandidates(database, { batchSize: 0 })).rejects.toThrow(
      'positive integer',
    );
    await expect(backfillBusinessCandidates(database, { batchSize: 1.5 })).rejects.toThrow(
      'positive integer',
    );
  });
});
