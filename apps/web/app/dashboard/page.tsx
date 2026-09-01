'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserSummary, WorkspaceSummary } from '@ai-crm/shared';
import { createBrowserApiClient } from '../../lib/api-client';
import { chooseWorkspaceId } from '../../lib/workspace-selection';
import { clearSession, getSelectedWorkspaceId, getSessionToken, setSelectedWorkspaceId } from '../../lib/session';

interface MeResponse {
  user: UserSummary;
  workspaces: WorkspaceSummary[];
}

interface DashboardResponse {
  workspace: { id: string; name: string };
  role: WorkspaceSummary['role'];
  status: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspace] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const api = useMemo(() => createBrowserApiClient(token), [token]);

  useEffect(() => {
    const storedToken = getSessionToken();
    setToken(storedToken);
    setHydrated(true);
    if (!storedToken) router.replace('/login');
  }, [router]);

  const meQuery = useQuery({
    queryKey: ['me', token],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    enabled: Boolean(token),
  });

  useEffect(() => {
    if (!meQuery.data) return;
    const nextWorkspaceId = chooseWorkspaceId(meQuery.data.workspaces, getSelectedWorkspaceId());
    setSelectedWorkspace(nextWorkspaceId);
    if (nextWorkspaceId) setSelectedWorkspaceId(nextWorkspaceId);
  }, [meQuery.data]);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', selectedWorkspaceId],
    queryFn: () => api.get<DashboardResponse>(`/workspaces/${selectedWorkspaceId}/dashboard`),
    enabled: Boolean(token && selectedWorkspaceId),
  });

  const createWorkspace = useMutation({
    mutationFn: (name: string) => api.post<WorkspaceSummary>('/workspaces', { name }),
    onSuccess: async (workspace) => {
      setSelectedWorkspaceId(workspace.id);
      setSelectedWorkspace(workspace.id);
      setNewWorkspaceName('');
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function selectWorkspace(workspaceId: string) {
    setSelectedWorkspace(workspaceId);
    setSelectedWorkspaceId(workspaceId);
  }

  function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (name) createWorkspace.mutate(name);
  }

  function logout() {
    clearSession();
    setToken(null);
    router.replace('/login');
  }

  if (!hydrated || (token && meQuery.isPending)) {
    return <main className="p-8 text-sm text-slate-600">Loading workspace…</main>;
  }
  if (!token) return null;

  if (meQuery.isError) {
    return (
      <main className="p-8">
        <p className="text-red-600">{meQuery.error.message}</p>
        <button className="mt-4 underline" onClick={logout}>Sign out</button>
      </main>
    );
  }

  const workspaces = meQuery.data?.workspaces ?? [];

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div><p className="text-sm font-semibold text-slate-500">AI Lead Intelligence CRM</p><h1 className="text-xl font-bold">Dashboard</h1></div>
          <div className="flex items-center gap-3">
            {selectedWorkspaceId ? <Link className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white" href="/campaigns">Campaigns</Link> : null}
            <span className="hidden text-sm text-slate-600 sm:inline">{meQuery.data?.user.email}</span>
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Workspace</h2>
          <select className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2" value={selectedWorkspaceId ?? ''} onChange={(event) => selectWorkspace(event.target.value)}>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <form className="mt-6 space-y-2 border-t border-slate-200 pt-5" onSubmit={submitWorkspace}>
            <label className="text-sm font-medium">Create another workspace<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Workspace name" value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} /></label>
            <button className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={createWorkspace.isPending} type="submit">{createWorkspace.isPending ? 'Creating…' : 'Create workspace'}</button>
            {createWorkspace.isError ? <p className="text-xs text-red-600">{createWorkspace.error.message}</p> : null}
          </form>
        </aside>

        <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          {dashboardQuery.isPending && selectedWorkspaceId ? <p className="text-slate-600">Loading dashboard…</p> : null}
          {dashboardQuery.isError ? <p className="text-red-600">{dashboardQuery.error.message}</p> : null}
          {dashboardQuery.data ? (
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Active workspace</p>
              <h2 className="mt-2 text-3xl font-bold">{dashboardQuery.data.workspace.name}</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-5"><p className="text-sm text-slate-500">Your role</p><p className="mt-1 font-semibold">{dashboardQuery.data.role}</p></div>
                <div className="rounded-xl bg-slate-50 p-5"><p className="text-sm text-slate-500">Platform status</p><p className="mt-1 font-semibold capitalize">{dashboardQuery.data.status}</p></div>
              </div>
              <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="font-bold">Campaign management is ready</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">Create workspace-scoped campaigns, control their lifecycle, and hand planning work durably to the PostgreSQL-backed worker. Discovery and enrichment come in later milestones.</p>
                <Link className="mt-4 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/campaigns">Open campaigns</Link>
              </div>
            </div>
          ) : null}
          {!selectedWorkspaceId ? <p className="text-slate-600">Create a workspace to continue.</p> : null}
        </section>
      </div>
    </main>
  );
}
