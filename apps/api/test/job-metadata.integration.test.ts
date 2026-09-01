import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@ai-crm/database';
import { AuthService } from '../src/auth/auth.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('job metadata integration', () => {
  const db = createPrismaClient(databaseUrl!);
  const auth = new AuthService(db);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    if (workspaceIds.length) await db.workspace.deleteMany({ where: { id: { in: workspaceIds.splice(0) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('persists application-visible queue status with safe defaults', async () => {
    const suffix = randomUUID();
    const registration = await auth.register({
      email: `jobs-${suffix}@example.com`,
      password: 'correct-horse-battery-staple',
      name: 'Jobs User',
      workspaceName: 'Jobs Workspace',
    });
    userIds.push(registration.user.id);
    const workspaceId = registration.workspaces[0]!.id;
    workspaceIds.push(workspaceId);
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
