import { describe, expect, it, vi } from 'vitest';
import { WorkspacesService } from '../src/workspaces/workspaces.service.js';

describe('WorkspacesService', () => {
  it('denies dashboard access when the user is not a member of the workspace', async () => {
    const db = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new WorkspacesService(db as never);

    await expect(service.getDashboard('user-a', 'workspace-b')).rejects.toThrow('Workspace access denied');
  });
});
