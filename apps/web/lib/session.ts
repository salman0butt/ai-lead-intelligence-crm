const TOKEN_KEY = 'ai-crm.session-token';
const WORKSPACE_KEY = 'ai-crm.workspace-id';

function getStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function getSessionToken(): string | null {
  return getStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function setSessionToken(token: string): void {
  getStorage()?.setItem(TOKEN_KEY, token);
}

export function clearSession(): void {
  const storage = getStorage();
  storage?.removeItem(TOKEN_KEY);
  storage?.removeItem(WORKSPACE_KEY);
}

export function getSelectedWorkspaceId(): string | null {
  return getStorage()?.getItem(WORKSPACE_KEY) ?? null;
}

export function setSelectedWorkspaceId(workspaceId: string): void {
  getStorage()?.setItem(WORKSPACE_KEY, workspaceId);
}
