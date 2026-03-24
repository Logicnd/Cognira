import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type PlanName = 'plus' | 'business' | 'pro';
type BillingCycle = 'monthly' | 'yearly';

interface BillingSubscription {
  user_id: string;
  plan: PlanName;
  status: 'active' | 'cancelled';
  billing_cycle: BillingCycle;
  amount_gbp: number;
  renewal_date: string;
  updated_at: string;
}

interface BillingEntitlements {
  plan: PlanName;
  status: 'active' | 'cancelled';
  billing_cycle: BillingCycle;
  usage: {
    period_month: string;
    messages_used: number;
    monthly_messages_limit: number;
    messages_remaining: number;
  };
  rules: {
    allow_cloud: boolean;
    allowed_model_tokens: string[];
  };
  model_allowed: boolean;
}

interface BillingAuditEvent {
  id: number;
  user_id: string;
  event_type: string;
  old_plan: string | null;
  new_plan: string | null;
  billing_cycle: string | null;
  provider: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export default function BillingAdminPage() {
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [entitlements, setEntitlements] = useState<BillingEntitlements | null>(null);
  const [events, setEvents] = useState<BillingAuditEvent[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanName>('plus');
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>('monthly');
  const [busy, setBusy] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState('');

  const statusTone = useMemo(() => {
    if (!subscription) return 'bg-slate-500/10 text-slate-300 border-slate-400/30';
    return subscription.status === 'active'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30'
      : 'bg-rose-500/10 text-rose-300 border-rose-400/30';
  }, [subscription]);

  const refresh = async () => {
    try {
      setError('');
      const [subscriptionRes, entitlementsRes, auditRes] = await Promise.all([
        axios.get(`${API_URL}/billing/subscription`),
        axios.get(`${API_URL}/billing/entitlements`),
        axios.get(`${API_URL}/billing/audit`, { params: { limit: 200 } })
      ]);
      setSubscription((subscriptionRes.data?.subscription || null) as BillingSubscription | null);
      setEntitlements((entitlementsRes.data?.entitlements || null) as BillingEntitlements | null);
      setEvents((auditRes.data?.events || []) as BillingAuditEvent[]);
    } catch {
      setError('Failed to load billing admin data.');
    } finally {
      setIsInitialLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const usagePct = useMemo(() => {
    if (!entitlements) return 0;
    const limit = entitlements.usage.monthly_messages_limit;
    if (limit < 0) return 0;
    if (limit === 0) return 100;
    return Math.min(100, Math.round((entitlements.usage.messages_used / limit) * 100));
  }, [entitlements]);

  const changePlan = async () => {
    try {
      setBusy(true);
      setError('');
      const response = await axios.post(`${API_URL}/billing/subscribe`, {
        plan: selectedPlan,
        billing_cycle: selectedCycle
      });

      if (response.data?.status === 'pending_checkout' && response.data?.checkout?.checkout_url) {
        window.location.href = String(response.data.checkout.checkout_url);
        return;
      }

      await refresh();
    } catch {
      setError('Plan update failed.');
    } finally {
      setBusy(false);
    }
  };

  const cancelSubscription = async () => {
    try {
      setBusy(true);
      setError('');
      await axios.post(`${API_URL}/billing/cancel`);
      await refresh();
    } catch {
      setError('Cancellation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen text-slate-100">
      <Head>
        <title>Lumiora Billing Console</title>
      </Head>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8 space-y-6">
        <header className="rounded-3xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-[#25d0a2] uppercase">Lumiora Operations</p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight">Billing Console</h1>
              <p className="mt-1 text-sm text-slate-300">Control subscription lifecycle, audit events, and entitlement posture.</p>
              <div className="mt-3 inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold border-[rgba(143,178,212,0.24)] bg-slate-900/40 text-slate-200">
                API: {API_URL}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void refresh()}
                className="rounded-full border border-[rgba(143,178,212,0.24)] bg-[rgba(20,29,44,0.56)] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-[rgba(37,208,162,0.6)]"
              >
                Refresh
              </button>
              <Link
                href="/"
                className="rounded-full border border-[rgba(143,178,212,0.24)] bg-[rgba(20,29,44,0.56)] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-[rgba(37,208,162,0.6)]"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {isInitialLoading && (
          <>
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-label="Loading billing summary">
              <article className="animate-pulse rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5">
                <div className="h-4 w-40 rounded bg-slate-700/60" />
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-full rounded bg-slate-700/40" />
                  <div className="h-3 w-4/5 rounded bg-slate-700/40" />
                  <div className="h-3 w-3/4 rounded bg-slate-700/40" />
                  <div className="h-3 w-2/3 rounded bg-slate-700/40" />
                </div>
              </article>
              <article className="animate-pulse rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5">
                <div className="h-4 w-32 rounded bg-slate-700/60" />
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-full rounded bg-slate-700/40" />
                  <div className="h-3 w-5/6 rounded bg-slate-700/40" />
                  <div className="h-3 w-2/3 rounded bg-slate-700/40" />
                  <div className="mt-3 h-2 w-full rounded-full bg-slate-700/40" />
                </div>
              </article>
              <article className="animate-pulse rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5">
                <div className="h-4 w-28 rounded bg-slate-700/60" />
                <div className="mt-4 h-10 w-full rounded-xl bg-slate-700/40" />
                <div className="mt-3 h-9 w-full rounded-full bg-slate-700/40" />
                <div className="mt-2 h-9 w-full rounded-full bg-slate-700/40" />
              </article>
            </section>

            <section className="animate-pulse rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5" aria-label="Loading billing audit">
              <div className="h-4 w-44 rounded bg-slate-700/60" />
              <div className="mt-4 space-y-2">
                <div className="h-8 w-full rounded bg-slate-700/30" />
                <div className="h-8 w-full rounded bg-slate-700/30" />
                <div className="h-8 w-full rounded bg-slate-700/30" />
                <div className="h-8 w-full rounded bg-slate-700/30" />
              </div>
            </section>
          </>
        )}

        {!isInitialLoading && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-100">Current Subscription</h2>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}>
                {subscription?.status ?? 'unknown'}
              </span>
            </div>

            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between"><span>Plan</span><strong className="text-slate-100 uppercase">{subscription?.plan ?? '-'}</strong></div>
              <div className="flex items-center justify-between"><span>Cycle</span><strong className="text-slate-100">{subscription?.billing_cycle ?? '-'}</strong></div>
              <div className="flex items-center justify-between"><span>Amount</span><strong className="text-slate-100">GBP {subscription?.amount_gbp ?? '-'}</strong></div>
              <div className="flex items-center justify-between"><span>Renewal</span><strong className="text-slate-100">{subscription?.renewal_date ?? '-'}</strong></div>
            </div>
          </article>

          <article className="rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-100">Entitlements</h2>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex items-center justify-between"><span>Cloud models</span><strong className="text-slate-100">{entitlements?.rules.allow_cloud ? 'Allowed' : 'Blocked'}</strong></div>
              <div className="flex items-center justify-between"><span>Limit</span><strong className="text-slate-100">{entitlements?.usage.monthly_messages_limit ?? '-'}</strong></div>
              <div className="flex items-center justify-between"><span>Used</span><strong className="text-slate-100">{entitlements?.usage.messages_used ?? '-'}</strong></div>
              <div className="flex items-center justify-between"><span>Remaining</span><strong className="text-slate-100">{entitlements?.usage.messages_remaining ?? '-'}</strong></div>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-slate-900/70">
              <div
                className="h-full bg-gradient-to-r from-[#25d0a2] to-[#f2b53f] transition-all"
                style={{ width: `${usagePct}%` }}
              />
            </div>

            <p className="text-xs text-slate-400 break-words">
              Model tokens: {(entitlements?.rules.allowed_model_tokens || []).join(', ') || '-'}
            </p>
          </article>

          <article className="rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-100">Plan Actions</h2>
            <div className="flex gap-2">
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value as PlanName)}
                className="flex-1 rounded-xl border border-[rgba(143,178,212,0.24)] bg-[#101a2a] px-3 py-2 text-sm text-slate-100"
              >
                <option value="plus">Plus</option>
                <option value="business">Business</option>
                <option value="pro">Pro</option>
              </select>
              <select
                value={selectedCycle}
                onChange={(e) => setSelectedCycle(e.target.value as BillingCycle)}
                className="rounded-xl border border-[rgba(143,178,212,0.24)] bg-[#101a2a] px-3 py-2 text-sm text-slate-100"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <button
              onClick={() => void changePlan()}
              disabled={busy}
              className="w-full rounded-full border border-[rgba(37,208,162,0.65)] bg-gradient-to-r from-[#25d0a2] to-[#53e2bc] px-4 py-2 text-sm font-semibold text-[#021910] hover:brightness-105 disabled:opacity-50"
            >
              Apply Plan Change
            </button>
            <button
              onClick={() => void cancelSubscription()}
              disabled={busy}
              className="w-full rounded-full border border-[rgba(143,178,212,0.24)] bg-[rgba(20,29,44,0.56)] px-4 py-2 text-sm font-semibold text-slate-100 hover:border-rose-400/50 disabled:opacity-50"
            >
              Cancel Subscription
            </button>
            <p className="text-xs text-slate-400">In Stripe mode, plan changes redirect to checkout. In mock mode, updates apply immediately.</p>
          </article>
        </section>
        )}

        {!isInitialLoading && (
        <section className="rounded-2xl border border-[rgba(143,178,212,0.24)] bg-[rgba(21,29,43,0.78)] p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-100">Billing Audit Log</h2>
            <span className="rounded-full border border-[rgba(143,178,212,0.24)] bg-slate-900/35 px-2.5 py-1 text-xs text-slate-300">
              {events.length} events
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[rgba(143,178,212,0.24)] text-slate-300">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Old</th>
                  <th className="py-2 pr-3">New</th>
                  <th className="py-2 pr-3">Cycle</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.length > 0 ? (
                  events.map((event) => (
                    <tr key={event.id} className="border-b border-[rgba(143,178,212,0.2)] align-top">
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{event.created_at}</td>
                      <td className="py-2 pr-3 text-slate-100">{event.event_type}</td>
                      <td className="py-2 pr-3 text-slate-300">{event.old_plan || '-'}</td>
                      <td className="py-2 pr-3 text-slate-300">{event.new_plan || '-'}</td>
                      <td className="py-2 pr-3 text-slate-300">{event.billing_cycle || '-'}</td>
                      <td className="py-2 pr-3 text-slate-300">{event.provider || '-'}</td>
                      <td className="py-2 text-xs text-slate-400">
                        <pre className="whitespace-pre-wrap rounded-lg bg-slate-900/35 p-2">{JSON.stringify(event.details || {}, null, 2)}</pre>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-6 text-slate-400">No billing events recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
