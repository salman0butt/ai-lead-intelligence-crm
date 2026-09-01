import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@ai-crm/database';
import { AuthService } from '../src/auth/auth.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('campaign persistence integration', () => {
  const db = createPrismaClient(databaseUrl!);
  const auth = new AuthService(db);
  const campaignIds: string[] = [];
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterEach(async () => {
    if (campaignIds.length) await db.campaign.deleteMany({ where: { id: { in: campaignIds.splice(0) } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    if (workspaceIds.length) await db.workspace.deleteMany({ where: { id: { in: workspaceIds.splice(0) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('persists targeting, ownership, a large lead target, and the DRAFT default', async () => {
    const suffix = randomUUID();
    const registration = await auth.register({
      email: `campaign-${suffix}@example.com`,
      password: 'correct-horse-battery-staple',
      name: 'Campaign User',
      workspaceName: 'Campaign Workspace',
    });
    userIds.push(registration.user.id);
    const workspaceId = registration.workspaces[0]!.id;
    workspaceIds.push(workspaceId);

    const created = await db.campaign.create({
      data: {
        workspaceId,
        createdByUserId: registration.user.id,
        name: 'Oslo Dentists',
        country: 'Norway',
        city: 'Oslo',
        niche: 'Dentist',
        requestedLeadCount: 25000,
      },
      include: { workspace: true, createdByUser: true },
    });
    campaignIds.push(created.id);

    expect(created).toMatchObject({
      workspaceId,
      createdByUserId: registration.user.id,
      name: 'Oslo Dentists',
      country: 'Norway',
      region: null,
      city: 'Oslo',
      niche: 'Dentist',
      requestedLeadCount: 25000,
      status: 'DRAFT',
    });
    expect(created.workspace.id).toBe(workspaceId);
    expect(created.createdByUser.id).toBe(registration.user.id);
  });
});
