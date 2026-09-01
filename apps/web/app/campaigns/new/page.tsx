'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createBrowserApiClient } from '../../../lib/api-client';
import type { CampaignResponse } from '../../../lib/campaigns';
import { getSelectedWorkspaceId, getSessionToken } from '../../../lib/session';

interface CampaignFormState {
  name: string;
  country: string;
  region: string;
  city: string;
  niche: string;
  requestedLeadCount: string;
}

const initialForm: CampaignFormState = {
  name: '',
  country: '',
  region: '',
  city: '',
  niche: '',
  requestedLeadCount: '100',
};

export default function NewCampaignPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState(initialForm);
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

  const createCampaign = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error('Select a workspace before creating a campaign');
      return api.post<CampaignResponse>('/campaigns', {
        workspaceId,
        name: form.name,
        country: form.country,
        region: form.region,
        city: form.city,
        niche: form.niche,
        requestedLeadCount: Number(form.requestedLeadCount),
      });
    },
    onSuccess: (campaign) => {
      router.push(`/campaigns/${campaign.id}`);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createCampaign.mutate();
  }

  function updateField(field: keyof CampaignFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  if (!hydrated) return <main className="p-8 text-sm text-slate-600">Loading campaign form…</main>;
  if (!token || !workspaceId) return null;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">Campaigns</p>
            <h1 className="text-3xl font-bold text-slate-950">Create campaign</h1>
          </div>
          <Link className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium" href="/campaigns">Back</Link>
        </div>

        <form className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" onSubmit={submit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Campaign name
              <input required maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="Oslo Dentists" />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Country
              <input required maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.country} onChange={(event) => updateField('country', event.target.value)} placeholder="Norway" />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Region <span className="font-normal text-slate-400">(optional)</span>
              <input maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.region} onChange={(event) => updateField('region', event.target.value)} placeholder="Oslo" />
            </label>

            <label className="text-sm font-medium text-slate-700">
              City <span className="font-normal text-slate-400">(optional)</span>
              <input maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.city} onChange={(event) => updateField('city', event.target.value)} placeholder="Oslo" />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Niche
              <input required maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.niche} onChange={(event) => updateField('niche', event.target.value)} placeholder="Dentist" />
            </label>

            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Requested lead count
              <input required min={1} step={1} type="number" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.requestedLeadCount} onChange={(event) => updateField('requestedLeadCount', event.target.value)} />
              <span className="mt-1 block text-xs font-normal text-slate-500">Use the actual target you want. Milestone 2 does not impose a small product cap.</span>
            </label>
          </div>

          {createCampaign.isError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{createCampaign.error.message}</p> : null}

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-5">
            <Link className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" href="/campaigns">Cancel</Link>
            <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={createCampaign.isPending} type="submit">
              {createCampaign.isPending ? 'Creating…' : 'Create campaign'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
