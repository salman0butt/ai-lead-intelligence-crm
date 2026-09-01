'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createBrowserApiClient } from '../../lib/api-client';
import { formatCampaignGeography, type CampaignResponse } from '../../lib/campaigns';
import { getSelectedWorkspaceId, getSessionToken } from '../../lib/session';

export default function CampaignsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const api = useMemo(() => createBrowserApiClient(token), [token]);

  useEffect(() => {
    const storedToken = getSessionToken();
    const selectedWorkspaceId = getSelectedWorkspaceId();
    setToken(storedToken);
    setWorkspaceId(selectedWorkspaceId);
    setHydrated(true);
    if (!storedToken) router.replace('/login');
    else if (!selectedWorkspaceId) router.replace('/dashboard');
  }, [router]);

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', workspaceId],
    queryFn: () => api.get<CampaignResponse[]>(`/campaigns?workspaceId=${encodeURIComponent(workspaceId!)}`),
    enabled: Boolean(token && workspaceId),
  });

  if (!hydrated || campaignsQuery.isPending) {
    return <main className="p-8 text-sm text-slate-600">Loading campaigns…</main>;
  }
  if (!token || !workspaceId) return null;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">AI Lead Intelligence CRM</p>
            <h1 className="text-xl font-bold">Campaigns</h1>
          </div>
          <div className="flex gap-2">
            <Link className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium" href="/dashboard">Dashboard</Link>
            <Link className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white" href="/campaigns/new">New campaign</Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-8">
        {campaignsQuery.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{campaignsQuery.error.message}</div>
        ) : null}

        {campaignsQuery.data?.length ? (
          <div className="grid gap-4">
            {campaignsQuery.data.map((campaign) => (
              <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950">{campaign.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">{campaign.niche} · {formatCampaignGeography(campaign)}</p>
                  </div>
                  <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{campaign.status}</span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested leads</p>
                    <p className="mt-1 text-lg font-bold">{campaign.requestedLeadCount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target market</p>
                    <p className="mt-1 font-semibold">{formatCampaignGeography(campaign)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : null}

        {!campaignsQuery.isError && campaignsQuery.data?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-lg font-bold">No campaigns yet</h2>
            <p className="mt-2 text-sm text-slate-600">Create a campaign to define a market, niche, and requested lead target.</p>
            <Link className="mt-5 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white" href="/campaigns/new">Create campaign</Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
