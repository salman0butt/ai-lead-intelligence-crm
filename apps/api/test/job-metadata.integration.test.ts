import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@ai-crm/database';
import { AuthService } from '../src/auth/auth.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('job metadata integration', () => {
  const db = createPrismaClient(databaseUrl!);
  const auth = new AuthService(db);

  beforeEach(async () => {
    await db.jobMetadata.deleteMany();
    await db.session.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('persists application-visible queue status with safe defaults', async () => {
    const registration = await auth.register({
      email: 'jobs@example.com',
      password: 'correct-horse-battery-staple',
      name: 'Jobs User',
      workspaceName: 'Jobs Workspace',
    });
    const workspaceId = registration.workspaces[0]!.id;
    const jobId = randomUUID();

    const created = await db.jobMetadata.create({
      data: {
        jobId,
        queue: 'system-test',
        workspaceId,
      },
    });

    expect(created).toMatchObject({
      jobId,
      queue: 'system-test',
      workspaceId,
      status: 'QUEUED',
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      failureReason: null,
    });
  });
});
