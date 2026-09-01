import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@ai-crm/database';
import { AuthService } from '../src/auth/auth.service.js';
import { WorkspacesService } from '../src/workspaces/workspaces.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('authentication and workspace integration', () => {
  const db = createPrismaClient(databaseUrl!);
  const auth = new AuthService(db);
  const workspaces = new WorkspacesService(db);
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    if (workspaceIds.length) await db.workspace.deleteMany({ where: { id: { in: workspaceIds.splice(0) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('registers, logs in, creates workspaces, and enforces tenant membership', async () => {
    const suffix = randomUUID();
    const aliceEmail = `alice-${suffix}@example.com`;
    const bobEmail = `bob-${suffix}@example.com`;
    const alice = await auth.register({
      email: aliceEmail,
      password: 'correct-horse-battery-staple',
      name: 'Alice',
      workspaceName: 'Alpha',
    });
    userIds.push(alice.user.id);
    workspaceIds.push(alice.workspaces[0]!.id);

    expect(alice.workspaces).toHaveLength(1);
    expect(await auth.authenticateToken(alice.token)).toMatchObject({ id: alice.user.id });

    const login = await auth.login({
      email: aliceEmail,
      password: 'correct-horse-battery-staple',
    });
    expect(login.user.id).toBe(alice.user.id);

    const beta = await workspaces.create(alice.user.id, 'Beta');
    workspaceIds.push(beta.id);
    await expect(workspaces.getDashboard(alice.user.id, beta.id)).resolves.toMatchObject({
      workspace: { id: beta.id, name: 'Beta' },
      role: 'OWNER',
    });

    const bob = await auth.register({
      email: bobEmail,
      password: 'another-correct-horse-battery',
      name: 'Bob',
      workspaceName: 'Bob Workspace',
    });
    userIds.push(bob.user.id);
    workspaceIds.push(bob.workspaces[0]!.id);

    await expect(workspaces.getDashboard(bob.user.id, beta.id)).rejects.toThrow('Workspace access denied');
  });
});
