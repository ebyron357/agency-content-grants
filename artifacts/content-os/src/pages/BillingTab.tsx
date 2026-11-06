import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/grants/GrantUi';
import { apiGet, apiPost } from '@/lib/api';
import { errorMessage } from '@/lib/grants';
import { usePermissions } from '@/lib/account';
import { cn } from '@/lib/utils';

/**
 * Settings → Billing (api-server routes/billing.ts, docs/BILLING.md). Owners
 * only. Shows the plan, its status, trial days left and usage against the
 * plan's limits; upgrades go to Stripe Checkout, changes and cancellation to
 * the Stripe customer portal. With billing off, it says so and nothing is limited.
 */

interface Limits { users: number | null; organizations: number | null; aiDraftedApplications: number | null }

interface PlanView {
  key: string;
  name: string;
  description: string;
  kind: 'subscription' | 'one_time';
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  oneTimePriceCents: number | null;
  limits: Limits;
  extraOrganizationPriceCents: number | null;
  features: string[];
  trialDays: number;
  purchasable: boolean;
  pricesPublished: boolean;
}

export interface BillingView {
  enabled: boolean;
  mode: 'test' | 'live' | null;
  missingSettings: string[];
  forcedOff: boolean;
  workspace: { id: string; name: string; kind: string };
  subscription: {
    planKey: string | null;
    status: string;
    billingInterval: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    extraOrganizations: number;
    hasBillingAccount: boolean;
    hasStripeSubscription: boolean;
  } | null;
  entitlement: { mode: 'unlimited' | 'plan' | 'none'; reason: string; planKey: string | null; planName: string | null; limits: Limits; trialDaysLeft: number | null };
  usage: Limits & { users: number; organizations: number; aiDraftedApplications: number };
  usageResetsOn: string;
  trialAvailable: boolean;
  plans: PlanView[];
  pricesPublished: boolean;
  purchases: { id: string; planKey: string; applicationId: string | null; amountCents: number | null; currency: string | null; createdAt: string }[];
}

const money = (cents: number | null) => (cents === null ? '' : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: cents % 100 ? 2 : 0 })}`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
/** Monthly usage resets at midnight UTC on the 1st; show that calendar date, not the local day before it. */
const utcDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

const STATUS_TEXT: Record<string, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  incomplete: 'Waiting for payment',
  incomplete_expired: 'Payment not completed',
  paused: 'Paused',
  none: 'No plan',
};

function statusLine(b: BillingView): { title: string; detail: string; tone: 'ok' | 'warn' | 'error' | 'info' } {
  const e = b.entitlement;
  const s = b.subscription;
  if (e.reason === 'agency_workspace') return { title: 'Agency workspace', detail: 'Your own workspace is never limited and needs no plan.', tone: 'ok' };
  if (e.reason === 'managed_plan') return { title: 'Agency-managed', detail: 'The agency runs this workspace for you. There are no limits and no charge.', tone: 'ok' };
  if (e.reason === 'trial') return { title: `Free trial of ${e.planName}: ${e.trialDaysLeft} day${e.trialDaysLeft === 1 ? '' : 's'} left`, detail: `The trial ends on ${day(s?.trialEndsAt ?? null)}. No card is needed until you choose a plan.`, tone: 'ok' };
  if (e.reason === 'trial_ended') return { title: 'Your free trial has ended', detail: 'Choose a plan to keep adding organizations, people and AI drafts. Everything you made is still here.', tone: 'warn' };
  if (e.reason === 'no_plan') return { title: 'No plan yet', detail: 'Start a free trial or choose a plan. Until then, new organizations, invitations and AI drafts are paused; existing work stays available.', tone: 'warn' };
  if (e.reason === 'unknown_plan') return { title: 'We do not recognize this workspace’s plan', detail: 'New organizations, invitations and AI drafts are paused until it is fixed. Open Manage billing, or contact the agency.', tone: 'error' };
  if (e.reason === 'past_due') return { title: `${e.planName}: payment overdue`, detail: 'Stripe is retrying the payment. Update your card in Manage billing to avoid an interruption.', tone: 'warn' };
  if (e.reason === 'inactive') return { title: `${e.planName ?? 'Plan'}: ${STATUS_TEXT[s?.status ?? 'none'] ?? s?.status}`, detail: 'Choose a plan, or fix the payment in Manage billing, to continue adding new work.', tone: 'error' };
  const renew = s?.currentPeriodEnd ? (s.cancelAtPeriodEnd ? `Ends on ${day(s.currentPeriodEnd)}.` : `Renews on ${day(s.currentPeriodEnd)}.`) : '';
  return { title: `${e.planName} plan${s?.billingInterval === 'year' ? ', billed yearly' : s?.billingInterval === 'month' ? ', billed monthly' : ''}`, detail: renew, tone: s?.cancelAtPeriodEnd ? 'warn' : 'ok' };
}

function UsageMeter({ label, used, limit, note }: { label: string; used: number; limit: number | null; note?: string }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const full = limit !== null && used >= limit;
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn('text-sm font-semibold tabular-nums', full ? 'text-amber-300' : 'text-foreground')}>
          {used}{limit === null ? '' : ` of ${limit}`}
        </span>
      </div>
      {limit === null ? (
        <p className="mt-2 text-xs text-muted-foreground">No limit</p>
      ) : (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${used} of ${limit}`}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <div className={cn('h-full rounded-full', full ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${pct}%` }} />
        </div>
      )}
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export default function BillingTab() {
  const { can } = usePermissions();
  const qc = useQueryClient();
  const allowed = can('billing.manage');
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const billing = useQuery({ queryKey: ['billing'], queryFn: () => apiGet<BillingView>('/billing'), enabled: allowed });
  const returned = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('checkout') : null;

  async function go(key: string, path: string, body?: unknown) {
    setBusy(key);
    setError('');
    try {
      const r = (await apiPost(path, body)) as { url?: string } | null;
      if (r?.url) {
        window.location.assign(r.url);
        return;
      }
      await qc.invalidateQueries({ queryKey: ['billing'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) return <Notice tone="info" title="Owners only">Only a workspace owner can see and change billing. Ask an owner if you need a different plan.</Notice>;
  if (billing.isLoading) return <LoadingState label="Loading billing…" className="min-h-[20vh]" />;
  if (billing.isError || !billing.data) return <StateMessage tone="error" title="Billing could not load" description={errorMessage(billing.error)} action={<Button onClick={() => billing.refetch()}>Try again</Button>} />;
  const b = billing.data;

  if (!b.enabled) {
    return (
      <Notice tone="info" title="Billing is off">
        {b.forcedOff
          ? 'Billing is switched off on this server (BILLING_DISABLED). Nothing is limited and nobody is charged.'
          : `Nothing is limited and nobody is charged. To switch billing on, the owner adds these settings on the server: ${b.missingSettings.join(', ')}.`}
      </Notice>
    );
  }

  const status = statusLine(b);
  const subscriptionPlans = b.plans.filter((p) => p.kind === 'subscription' && p.purchasable);
  const expert = b.plans.find((p) => p.key === 'expert_review');
  const limits = b.entitlement.limits;
  const unlimited = b.entitlement.mode === 'unlimited';
  const paying = !!b.subscription?.hasStripeSubscription && !['canceled', 'incomplete_expired'].includes(b.subscription.status);

  return (
    <div className="space-y-5">
      {b.mode === 'test' && <Notice tone="warn" title="Stripe test mode">Payments use Stripe test cards; nobody is charged.</Notice>}
      {!b.pricesPublished && (
        <Notice tone="warn" title="Proposed prices">These prices are proposals and have not been published yet. They can change before launch.</Notice>
      )}
      {returned === 'success' && <Notice tone="ok" title="Thank you">Stripe confirmed your checkout. Your plan updates here within a minute.</Notice>}
      {returned === 'cancelled' && <Notice tone="info">Checkout was cancelled. Nothing changed.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Panel>
        <PanelHeader
          title="Your plan"
          description={b.workspace.name}
          actions={b.subscription?.hasBillingAccount ? (
            <Button size="sm" variant="secondary" className="gap-1.5" disabled={busy !== null} onClick={() => go('portal', '/billing/portal')}>
              Manage billing <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : undefined}
        />
        <div className="space-y-4 px-5 py-4">
          <Notice tone={status.tone} title={status.title}>{status.detail}</Notice>
          {!unlimited && (
            <div className="grid gap-3 sm:grid-cols-3">
              <UsageMeter label="Users" used={b.usage.users} limit={limits.users} note="Members and open invitations" />
              <UsageMeter label="Organizations" used={b.usage.organizations} limit={limits.organizations} />
              <UsageMeter label="AI-drafted applications this month" used={b.usage.aiDraftedApplications} limit={limits.aiDraftedApplications} note={`Resets on ${utcDay(b.usageResetsOn)}`} />
            </div>
          )}
        </div>
      </Panel>

      {b.workspace.kind !== 'agency' && b.entitlement.reason !== 'managed_plan' && (
        <Panel>
          <PanelHeader
            title={paying ? 'Change plan' : 'Choose a plan'}
            description={paying ? 'Change or cancel your plan in Manage billing.' : `Every plan starts with a ${subscriptionPlans[0]?.trialDays ?? 14}-day free trial, no card needed. Yearly billing gives two months free.`}
          />
          <div className="px-5 pt-4">
            <div role="group" aria-label="Billing period" className="inline-flex rounded-xl border border-border bg-background p-1">
              {(['month', 'year'] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={interval === i}
                  onClick={() => setInterval(i)}
                  className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', interval === i ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {i === 'month' ? 'Monthly' : 'Yearly (2 months free)'}
                </button>
              ))}
            </div>
          </div>
          <ul className="grid gap-3 px-5 py-4 lg:grid-cols-3">
            {subscriptionPlans.map((p) => {
              const current = b.subscription?.planKey === p.key && b.entitlement.mode === 'plan';
              const price = interval === 'year' ? p.annualPriceCents : p.monthlyPriceCents;
              return (
                <li key={p.key} className={cn('flex flex-col rounded-2xl border bg-background px-4 py-4', current ? 'border-brand/60' : 'border-border')}>
                  <h3 className="text-sm font-semibold text-foreground">{p.name}{current ? ' · current plan' : ''}</h3>
                  <p className="mt-1 text-2xl font-semibold text-foreground">
                    {money(price)}<span className="text-xs font-normal text-muted-foreground">{interval === 'year' ? ' a year' : ' a month'}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
                    {p.features.map((f) => <li key={f}>· {f}</li>)}
                  </ul>
                  <div className="mt-4 flex flex-col gap-2">
                    {!paying && (
                      <Button size="sm" disabled={busy !== null} onClick={() => go(`checkout-${p.key}`, '/billing/checkout', { planKey: p.key, interval })} aria-label={`Subscribe to ${p.name}, ${interval === 'year' ? 'yearly' : 'monthly'}`}>
                        {busy === `checkout-${p.key}` ? 'Opening Stripe…' : current ? 'Add a card and subscribe' : `Subscribe to ${p.name}`}
                      </Button>
                    )}
                    {b.trialAvailable && p.trialDays > 0 && (
                      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => go(`trial-${p.key}`, '/billing/trial', { planKey: p.key })} aria-label={`Start a free ${p.trialDays}-day trial of ${p.name}`}>
                        {busy === `trial-${p.key}` ? 'Starting…' : `Start ${p.trialDays}-day free trial`}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {expert && (
        <Panel>
          <PanelHeader title={expert.name} description={`${money(expert.oneTimePriceCents)} per application, one time. ${expert.description}`} />
          {b.purchases.length > 0 && (
            <ul className="divide-y divide-border">
              {b.purchases.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm">
                  <span className="text-foreground">{p.planKey === 'expert_review' ? 'Expert review' : p.planKey}</span>
                  <span className="text-xs text-muted-foreground">{money(p.amountCents)} · {day(p.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
