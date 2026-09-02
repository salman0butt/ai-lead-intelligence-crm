import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  CampaignStatus,
  DuplicateReason,
  createPrismaClient,
} from '@ai-crm/database';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('business deduplication schema', () => {
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

  it('stores a workspace-scoped canonical business and candidate match audit fields', async () => {
    const suffix = randomUUID();
    const user = await database.user.create({
      data: {
        email: `m5-schema-${suffix}@example.com`,
        passwordHash: 'integration-test-hash',
        name: 'M5 Schema User',
      },
    });
    userIds.push(user.id);

    const workspace = await database.workspace.create({
      data: { name: `M5 Schema ${suffix}` },
    });
    workspaceIds.push(workspace.id);

    const campaign = await database.campaign.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        name: 'M5 Schema Campaign',
        country: 'United States',
        region: 'Texas',
        city: 'Austin',
        niche: 'Dentist',
        requestedLeadCount: 100,
        status: CampaignStatus.DISCOVERING,
      },
    });

    const candidate = await database.businessCandidate.create({
      data: {
        workspaceId: workspace.id,
        campaignId: campaign.id,
        provider: 'google-maps-browser',
        providerExternalId: `maps-url-sha256:${suffix}`,
        name: 'Acme Dental',
        formattedAddress: '12 Main St, Austin, TX 78701',
        city: 'Austin',
        postalCode: '78701',
        phone: '+1 (512) 555-0100',
        canonicalDomain: 'acmedental.example',
      },
    });

    const business = await database.business.create({
      data: {
        workspaceId: workspace.id,
        name: 'Acme Dental',
        normalizedName: 'acme dental',
        formattedAddress: '12 Main St, Austin, TX 78701',
        normalizedAddress: '12 main st austin tx 78701',
        city: 'Austin',
        normalizedCity: 'austin',
        postalCode: '78701',
        normalizedPostalCode: '78701',
        phone: '+1 (512) 555-0100',
        normalizedPhone: '+15125550100',
        canonicalDomain: 'acmedental.example',
      },
    });

    const linked = await database.businessCandidate.update({
      where: { id: candidate.id },
      data: {
        matchedBusinessId: business.id,
        duplicateConfidence: 0,
        duplicateReason: DuplicateReason.NEW_CANONICAL,
      },
      include: { matchedBusiness: true },
    });

    expect(linked).toMatchObject({
      matchedBusinessId: business.id,
      duplicateConfidence: 0,
      duplicateReason: DuplicateReason.NEW_CANONICAL,
      city: 'Austin',
      postalCode: '78701',
      phone: '+1 (512) 555-0100',
      canonicalDomain: 'acmedental.example',
    });
    expect(linked.matchedBusiness).toMatchObject({
      id: business.id,
      workspaceId: workspace.id,
      normalizedName: 'acme dental',
      normalizedPhone: '+15125550100',
    });
  });
});
