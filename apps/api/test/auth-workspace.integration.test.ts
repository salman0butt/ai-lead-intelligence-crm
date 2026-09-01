import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@ai-crm/database';
import { AuthService } from '../src/auth/auth.service.js';
import { WorkspacesService } from '../src/workspaces/workspaces.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('authentication and workspace integration', () => {
  const db = createPrismaClient(databaseUrl!);
  const auth = new AuthService(db);
  const workspaces = new WorkspacesService(db);

  beforeEach(async () => {
    await db.session.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('registers, logs in, creates workspaces, and enforces tenant membership', async () => {
    const alice = await auth.register({
      email: 'alice@example.com',
      password: 'correct-horse-battery-staple',
      name: 'Alice',
      workspaceName: 'Alpha',
    });

    expect(alice.workspaces).toHaveLength(1);
    expect(await auth.authenticateToken(alice.token)).toMatchObject({ id: alice.user.id });

    const login = await auth.login({
      email: 'alice@example.com',
      password: 'correct-horse-battery-staple',
    });
    expect(login.user.id).toBe(alice.user.id);

    const beta = await workspaces.create(alice.user.id, 'Beta');
    await expect(workspaces.getDashboard(alice.user.id, beta.id)).resolves.toMatchObject({
      workspace: { id: beta.id, name: 'Beta' },
      role: 'OWNER',
    });

    const bob = await auth.register({
      email: 'bob@example.com',
      password: 'another-correct-horse-battery',
      name: 'Bob',
      workspaceName: 'Bob Workspace',
    });

    await expect(workspaces.getDashboard(bob.user.id, beta.id)).rejects.toThrow('Workspace access denied');
  });
});
