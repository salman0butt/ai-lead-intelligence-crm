export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface UserSummary {
  id: string;
  email: string;
  name: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface AuthResponse {
  token: string;
  user: UserSummary;
  workspaces: WorkspaceSummary[];
}
