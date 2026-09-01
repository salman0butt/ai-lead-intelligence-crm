import { describe, expect, it } from 'vitest';
import { chooseWorkspaceId } from '../lib/workspace-selection.js';

const workspaces = [
  { id: 'workspace-a', name: 'A', role: 'OWNER' as const },
  { id: 'workspace-b', name: 'B', role: 'MEMBER' as const },
];

describe('chooseWorkspaceId', () => {
  it('restores a previously selected workspace when membership still exists', () => {
    expect(chooseWorkspaceId(workspaces, 'workspace-b')).toBe('workspace-b');
  });

  it('falls back to the first available workspace when the stored workspace is invalid', () => {
    expect(chooseWorkspaceId(workspaces, 'other')).toBe('workspace-a');
  });
});
