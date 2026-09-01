'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createBrowserApiClient } from '../../../lib/api-client';
import {
  formatCampaignGeography,
  getCampaignActions,
  type CampaignLifecycleAction,
  type CampaignResponse,
} from '../../../lib/campaigns';
import { getSessionToken } from '../../../lib/session';

const actionLabels: Record<CampaignLifecycleAction, string> = {
  start: 'Start planning',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel campaign',
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const api = useMemo(() => createBrowserApiClient(token), [token]);

  useEffect(() => {
    const storedToken = getSessionToken();
    setToken(storedToken);
    setHydrated(true);
    if (!storedToken) router.replace('/login');
  }, [router]);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<CampaignResponse>(`/campaigns/${campaignId}`),
    enabled: Boolean(token && campaignId),
  });

  const lifecycleMutation = useMutation({
    mutationFn: (action: CampaignLifecycleAction) => api.post<unknown>(`/campaigns/${campaignId}/${action}`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] }),
        queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
      ]);
    },
  });

  if (!hydrated || campaignQuery.isPending) {
    return <main className="p-8 text-sm text-slate-600">Loading campaign…</main>;
  }
  if (!token) return null;

  if (campaignQuery.isError) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-white p-8">
          <p className="text-red-700">{campaignQuery.error.message}</p>
          <Link className="mt-4 inline-flex text-sm font-semibold underline" href="/campaigns">Back to campaigns</Link>
        </div>
      </main>
    );
  }

  const campaign = campaignQuery.data;
  if (!campaign) return null;
  const actions = getCampaignActions(campaign.status);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">Campaign</p>
            <h1 className="text-xl font-bold">{campaign.name}</h1>
          </div>
          <Link className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium" href="/campaigns">All campaigns</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[1fr_300px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Target</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-950">{campaign.niche}</h2>
              <p className="mt-1 text-slate-600">{formatCampaignGeography(campaign)}</p>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{campaign.status}</span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested leads</p>
              <p className="mt-1 text-2xl font-bold">{campaign.requestedLeadCount.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location</p>
              <p className="mt-1 font-semibold">{formatCampaignGeography(campaign)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created</p>
              <p className="mt-1 font-semibold">{new Date(campaign.createdAt).toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated</p>
              <p className="mt-1 font-semibold">{new Date(campaign.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        </section>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold">Lifecycle</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Planning is durable through the PostgreSQL-backed job system. Discovery is intentionally not part of Milestone 2.</p>

          <div className="mt-5 space-y-2">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate(action)}
                className={action === 'cancel'
                  ? 'w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50'
                  : 'w-full rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'}
              >
                {lifecycleMutation.isPending && lifecycleMutation.variables === action ? 'Working…' : actionLabels[action]}
              </button>
            ))}
          </div>

          {actions.length === 0 ? <p className="mt-5 text-sm text-slate-500">This campaign is terminal and has no available lifecycle actions.</p> : null}
          {lifecycleMutation.isError ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{lifecycleMutation.error.message}</p> : null}
        </aside>
      </div>
    </main>
  );
}
