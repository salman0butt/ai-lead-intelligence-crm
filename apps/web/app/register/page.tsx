'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import type { AuthResponse } from '@ai-crm/shared';
import { createBrowserApiClient } from '../../lib/api-client';
import { setSelectedWorkspaceId, setSessionToken } from '../../lib/session';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBrowserApiClient().post<AuthResponse>('/auth/register', form);
      setSessionToken(result.token);
      const firstWorkspace = result.workspaces[0];
      if (firstWorkspace) setSelectedWorkspaceId(firstWorkspace.id);
      router.push('/dashboard');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-slate-500">AI Lead Intelligence CRM</p>
        <h1 className="mt-2 text-3xl font-bold">Create your account</h1>
        <p className="mt-2 text-sm text-slate-600">Your first workspace is created with your account.</p>
        <form className="mt-8 grid gap-4" onSubmit={submit}>
          <label className="text-sm font-medium">Name<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.name} onChange={(event) => update('name', event.target.value)} required /></label>
          <label className="text-sm font-medium">Email<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} required /></label>
          <label className="text-sm font-medium">Password<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" type="password" minLength={12} autoComplete="new-password" value={form.password} onChange={(event) => update('password', event.target.value)} required /></label>
          <label className="text-sm font-medium">Workspace name<input className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={form.workspaceName} onChange={(event) => update('workspaceName', event.target.value)} required /></label>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 font-semibold text-white disabled:opacity-50" disabled={submitting} type="submit">{submitting ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="mt-6 text-sm text-slate-600">Already registered? <Link className="font-semibold text-slate-950 underline" href="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
