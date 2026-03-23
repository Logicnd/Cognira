import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
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
  const [error, setError] = useState('');

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
      await axios.post(`${API_URL}/billing/subscribe`, {
        plan: selectedPlan,
        billing_cycle: selectedCycle
      });
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
    <div className="min-h-screen bg-[#111213] text-zinc-100">
      <Head>
        <title>Cognira Billing Admin</title>
      </Head>

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Billing Admin</h1>
            <p className="text-sm text-zinc-400">Audit subscriptions, entitlements, and usage.</p>
          </div>
          <button
            onClick={() => void refresh()}
            className="rounded-lg border border-[#2f2f2f] bg-[#1a1b1d] px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
          >
            Refresh
          </button>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-[#2a2a2a] bg-[#17181a] p-4 space-y-2">
            <h2 className="text-sm font-semibold text-zinc-200">Current Subscription</h2>
            <div className="text-sm text-zinc-400">Plan: {subscription?.plan?.toUpperCase() || '-'}</div>
            <div className="text-sm text-zinc-400">Status: {subscription?.status || '-'}</div>
            <div className="text-sm text-zinc-400">Cycle: {subscription?.billing_cycle || '-'}</div>
            <div className="text-sm text-zinc-400">Amount: GBP {subscription?.amount_gbp ?? '-'}</div>
            <div className="text-sm text-zinc-400">Renewal: {subscription?.renewal_date || '-'}</div>
          </article>

          <article className="rounded-2xl border border-[#2a2a2a] bg-[#17181a] p-4 space-y-2">
            <h2 className="text-sm font-semibold text-zinc-200">Entitlements</h2>
            <div className="text-sm text-zinc-400">Cloud allowed: {entitlements?.rules.allow_cloud ? 'Yes' : 'No'}</div>
            <div className="text-sm text-zinc-400">Model tokens: {(entitlements?.rules.allowed_model_tokens || []).join(', ') || '-'}</div>
            <div className="text-sm text-zinc-400">Monthly limit: {entitlements?.usage.monthly_messages_limit ?? '-'}</div>
            <div className="text-sm text-zinc-400">Used: {entitlements?.usage.messages_used ?? '-'}</div>
            <div className="h-2 rounded-full bg-black/50 overflow-hidden mt-2">
              <div className="h-full bg-indigo-400" style={{ width: `${usagePct}%` }} />
            </div>
          </article>

          <article className="rounded-2xl border border-[#2a2a2a] bg-[#17181a] p-4 space-y-3">
            <h2 className="text-sm font-semibold text-zinc-200">Admin Actions</h2>
            <div className="flex gap-2">
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value as PlanName)}
                className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#101113] px-2 py-1.5 text-sm"
              >
                <option value="plus">Plus</option>
                <option value="business">Business</option>
                <option value="pro">Pro</option>
              </select>
              <select
                value={selectedCycle}
                onChange={(e) => setSelectedCycle(e.target.value as BillingCycle)}
                className="rounded-lg border border-[#2a2a2a] bg-[#101113] px-2 py-1.5 text-sm"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <button
              onClick={() => void changePlan()}
              disabled={busy}
              className="w-full rounded-lg border border-indigo-400/60 bg-indigo-500/20 px-3 py-1.5 text-sm text-indigo-100 hover:bg-indigo-500/30 disabled:opacity-50"
            >
              Apply Plan Change
            </button>
            <button
              onClick={() => void cancelSubscription()}
              disabled={busy}
              className="w-full rounded-lg border border-[#2a2a2a] bg-[#131416] px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
            >
              Cancel Subscription
            </button>
          </article>
        </section>

        <section className="rounded-2xl border border-[#2a2a2a] bg-[#17181a] p-4">
          <h2 className="text-sm font-semibold text-zinc-200 mb-3">Billing Audit Log</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#2b2b2b] text-zinc-400">
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
                    <tr key={event.id} className="border-b border-[#222] align-top">
                      <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">{event.created_at}</td>
                      <td className="py-2 pr-3 text-zinc-200">{event.event_type}</td>
                      <td className="py-2 pr-3 text-zinc-400">{event.old_plan || '-'}</td>
                      <td className="py-2 pr-3 text-zinc-400">{event.new_plan || '-'}</td>
                      <td className="py-2 pr-3 text-zinc-400">{event.billing_cycle || '-'}</td>
                      <td className="py-2 pr-3 text-zinc-400">{event.provider || '-'}</td>
                      <td className="py-2 text-xs text-zinc-500">
                        <pre className="whitespace-pre-wrap">{JSON.stringify(event.details || {}, null, 2)}</pre>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-4 text-zinc-500">No billing events recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
