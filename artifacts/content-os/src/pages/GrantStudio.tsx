import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Briefcase, Building2, CalendarPlus, HandHeart, Landmark, Library, Plus, RefreshCw, Sparkles, LayoutTemplate, Wand2 } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, StateMessage, LoadingState } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DeadlineChip, Field, Notice, ReadinessRing, StatusPill, selectClass } from '@/components/grants/GrantUi';
import { cn } from '@/lib/utils';
import { CalibrationPanel } from '@/components/grants/Competitiveness';
import { calendarUrl, deadlineLabel, errorMessage, grantsApi, useApplicants, useApplications, useGrantMeta, useInvalidateGrants, type ApplicantType, usePipeline, usd, syncStatusText } from '@/lib/grants';

const TYPE_CHOICES: { type: ApplicantType; title: string; body: string; icon: typeof HandHeart }[] = [
  { type: 'nonprofit_501c3', title: 'Nonprofit, 501(c)(3)', body: 'Tax-exempt charity with an IRS determination letter.', icon: HandHeart },
  { type: 'nonprofit_other', title: 'Nonprofit, other', body: 'Nonprofit without 501(c)(3) status.', icon: HandHeart },
  { type: 'small_business', title: 'Small business', body: 'Meets the SBA size standard for its industry.', icon: Briefcase },
  { type: 'for_profit', title: 'Other for-profit', body: 'For-profit organization that is not a small business.', icon: Building2 },
];

function splitList(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

export function AddOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const invalidate = useInvalidateGrants();
  const [type, setType] = useState<ApplicantType>('nonprofit_501c3');
  const [form, setForm] = useState({ name: '', state: '', mission: '', focusAreas: '', annualBudget: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return setError('Enter the organization’s legal name.');
    setSaving(true);
    setError('');
    try {
      const created = await grantsApi.createApplicant({
        name: form.name,
        applicantType: type,
        state: form.state || null,
        mission: form.mission || null,
        focusAreas: splitList(form.focusAreas),
        annualBudget: form.annualBudget ? Number(form.annualBudget.replace(/[$,]/g, '')) : null,
      });
      await invalidate();
      onOpenChange(false);
      navigate(`/grant-studio/organizations/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add an organization</DialogTitle>
          <DialogDescription>Grant Studio matches opportunities to this profile. You can add EIN, UEI and readiness documents next.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">What kind of organization?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TYPE_CHOICES.map((choice) => (
                <label
                  key={choice.type}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-brand',
                    type === choice.type ? 'border-brand/60 bg-brand/10' : 'border-border bg-background hover:bg-secondary',
                  )}
                >
                  <input type="radio" name="applicantType" value={choice.type} checked={type === choice.type} onChange={() => setType(choice.type)} className="sr-only" />
                  <choice.icon className={cn('mt-0.5 h-4 w-4 shrink-0', type === choice.type ? 'text-brand' : 'text-muted-foreground')} aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{choice.title}</span>
                    <span className="block text-xs text-muted-foreground">{choice.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="organization" required />
            </Field>
            <Field label="State" hint="Where you operate, for state programs.">
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="NC" />
            </Field>
            <Field label="Annual budget or revenue (USD)" hint="Used to judge award size.">
              <Input value={form.annualBudget} onChange={(e) => setForm({ ...form, annualBudget: e.target.value })} inputMode="numeric" placeholder="350000" />
            </Field>
            <Field label="Mission" className="sm:col-span-2">
              <Textarea value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} rows={3} />
            </Field>
            <Field label="Focus areas" hint="Comma separated, for example: youth literacy, workforce, clean water." className="sm:col-span-2">
              <Input value={form.focusAreas} onChange={(e) => setForm({ ...form, focusAreas: e.target.value })} />
            </Field>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add organization'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function GrantStudio() {
  const meta = useGrantMeta();
  const applicants = useApplicants();
  const applications = useApplications();
  const pipeline = usePipeline();
  const invalidate = useInvalidateGrants();
  const [adding, setAdding] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  async function refresh() {
    setSyncMessage('');
    try {
      const result = await grantsApi.sync();
      setSyncMessage(result.status === 'queued' ? '' : 'A refresh is already under way.');
      invalidate();
    } catch (err) {
      setSyncMessage(errorMessage(err));
    }
  }

  if (applicants.isLoading) return <LoadingState label="Loading Grant Studio…" />;
  if (applicants.isError) {
    return (
      <PageShell>
        <StateMessage tone="error" title="Grant Studio could not load" description={errorMessage(applicants.error)} action={<Button onClick={() => applicants.refetch()}>Try again</Button>} />
      </PageShell>
    );
  }

  const orgs = applicants.data ?? [];
  const inProgress = (applications.data ?? []).filter((a) => !a.outcome);
  const lastSync = meta.data?.lastSync;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Grant Studio"
        title="Grant Studio"
        description="Find grants each organization can win, write the application with grounded drafting and a reviewer’s checks, and export a submission-ready package."
        actions={
          <>
            <Button variant="outline" asChild className="gap-2">
              <Link href="/grants"><Library className="h-4 w-4" aria-hidden="true" /> Curated directory</Link>
            </Button>
            <Button variant="outline" asChild className="gap-2">
              <Link href="/grant-studio/templates"><LayoutTemplate className="h-4 w-4" aria-hidden="true" /> Templates</Link>
            </Button>
            <Button variant="outline" asChild className="gap-2">
              <Link href="/grant-studio/foundations"><Landmark className="h-4 w-4" aria-hidden="true" /> Foundations</Link>
            </Button>
            <Button variant="outline" asChild className="gap-2">
              <Link href="/get-started"><Wand2 className="h-4 w-4" aria-hidden="true" /> Get started</Link>
            </Button>
            <Button onClick={() => setAdding(true)} className="gap-2">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add organization
            </Button>
          </>
        }
      />

      {pipeline.data && (pipeline.data.inProgress > 0 || pipeline.data.awaitingDecision > 0 || pipeline.data.awarded > 0 || pipeline.data.declined > 0) && (
        <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Pipeline">
          {[
            { label: 'In progress', value: pipeline.data.inProgress.toLocaleString('en-US'), sub: `${pipeline.data.dueWithin30Days} due within 30 days` },
            { label: 'Awaiting decision', value: pipeline.data.awaitingDecision.toLocaleString('en-US'), sub: `${usd(pipeline.data.requestedSubmitted)} requested in all` },
            { label: 'Awarded', value: usd(pipeline.data.awardedTotal), sub: `${pipeline.data.awarded} award${pipeline.data.awarded === 1 ? '' : 's'}` },
            { label: 'Win rate', value: pipeline.data.winRate === null ? 'No decisions yet' : `${Math.round(pipeline.data.winRate * 100)}%`, sub: `${pipeline.data.awarded} won, ${pipeline.data.declined} declined` },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-border bg-card px-4 py-3">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="mt-1 text-lg font-semibold text-foreground">{stat.value}</dd>
              <dd className="text-xs text-muted-foreground">{stat.sub}</dd>
            </div>
          ))}
        </dl>
      )}
      {pipeline.data?.calibration && pipeline.data.calibration.decided + pipeline.data.calibration.bands.reduce((n, b) => n + b.pending, 0) > 0 && <CalibrationPanel calibration={pipeline.data.calibration} />}

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Notice
          tone={lastSync?.status === 'failed' ? 'error' : 'info'}
          title={`${(meta.data?.opportunities ?? 0).toLocaleString('en-US')} open opportunities from ${meta.data?.sources?.length ? meta.data.sources.map((s) => `${s.label} (${s.opportunities.toLocaleString('en-US')})`).join(' and ') : 'official sources'}`}
          action={
            <Button variant="outline" size="sm" onClick={refresh} disabled={meta.data?.syncRunning} className="gap-2">
              <RefreshCw className={cn('h-3.5 w-3.5', meta.data?.syncRunning && 'animate-spin')} aria-hidden="true" />
              {meta.data?.syncRunning ? 'Refreshing…' : 'Refresh now'}
            </Button>
          }
        >
          {lastSync?.status === 'failed'
            ? `The last refresh failed (${lastSync.error ?? 'unknown error'}). Showing the last stored opportunities.`
            : `Refreshed daily. Last refresh: ${formatWhen(lastSync?.finishedAt ?? lastSync?.startedAt)}. Every listing links to its official record.`}
          <span role="status" aria-live="polite" className="mt-1 block text-foreground">{syncStatusText(meta.data?.syncJob ?? null) ?? syncMessage}</span>
        </Notice>
        {meta.data?.aiDemo ? (
          <Notice tone="warn" title="Writing assistance is in demo mode">
            No AI provider is configured, so drafting adds a labelled outline scaffold and review runs rule checks only. Configure a provider in Settings for full drafting.
          </Notice>
        ) : (
          <Notice tone="ok" title={`Writing assistance: ${meta.data?.aiProvider ?? 'configured'}`}>
            Drafts use only your profile, the notice and your text; missing facts are marked [Add: …] for you to fill.
          </Notice>
        )}
      </div>

      {orgs.length === 0 ? (
        <Panel className="p-6 sm:p-8">
          <div className="mx-auto max-w-2xl text-center">
            <Sparkles className="mx-auto h-8 w-8 text-brand" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-semibold text-foreground">Start with the organization that is applying</h2>
            <p className="mt-2 text-sm text-muted-foreground">A nonprofit or a business. Grant Studio uses its type, mission and focus areas to find federal opportunities it is eligible for.</p>
            <ol className="mx-auto mt-6 grid max-w-xl gap-3 text-left sm:grid-cols-3">
              {['Add the organization', 'Review your matches', 'Write and export the application'].map((step, i) => (
                <li key={step} className="rounded-xl border border-border bg-background p-3 text-sm">
                  <span className="mb-1 block text-xs font-semibold text-brand">Step {i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button asChild className="gap-2"><Link href="/onboarding"><Wand2 className="h-4 w-4" aria-hidden="true" /> Set up with your EIN</Link></Button>
              <Button variant="outline" className="gap-2" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Add organization</Button>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel>
            <PanelHeader title="Organizations" description="Readiness shows registrations and documents funders require." />
            <ul className="divide-y divide-border">
              {orgs.map((org) => (
                <li key={org.id}>
                  <Link href={`/grant-studio/organizations/${org.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60">
                    <ReadinessRing score={org.readiness.score} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{org.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {org.applicantTypeLabel}
                        {org.state ? ` · ${org.state}` : ''}
                        {` · ${org.applicationCount ?? 0} application${org.applicationCount === 1 ? '' : 's'}`}
                      </p>
                      {(org.alerts?.newMatches || org.alerts?.closingSoon) ? (
                        <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                          {org.alerts.newMatches > 0 && <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-medium text-brand">{org.alerts.newMatches} new match{org.alerts.newMatches === 1 ? '' : 'es'}</span>}
                          {org.alerts.closingSoon > 0 && <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-amber-300">{org.alerts.closingSoon} closing within 14 days</span>}
                        </p>
                      ) : null}
                      {org.readiness.blockingOpen > 0 && (
                        <p className="mt-1 text-xs text-amber-300">{org.readiness.blockingOpen} required registration{org.readiness.blockingOpen === 1 ? '' : 's'} or document{org.readiness.blockingOpen === 1 ? '' : 's'} not ready</p>
                      )}
                    </div>
                    <span className="hidden items-center gap-1 text-xs font-medium text-brand sm:flex">Matches <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <PanelHeader
              title="Applications in progress"
              description="Closest deadline first."
              actions={inProgress.length > 0 ? (
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={calendarUrl('all')} download><CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Deadline calendar</a>
                </Button>
              ) : undefined}
            />
            {inProgress.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No applications yet. Open an organization’s matches and choose Start application.</p>
            ) : (
              <ul className="divide-y divide-border">
                {[...inProgress]
                  .sort((a, b) => (a.opportunity.daysLeft ?? 9999) - (b.opportunity.daysLeft ?? 9999))
                  .map((app) => (
                    <li key={app.id}>
                      <Link href={`/grant-studio/applications/${app.id}`} className="block px-5 py-4 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60">
                        <div className="flex items-start justify-between gap-3">
                          <p className="line-clamp-2 text-sm font-semibold text-foreground">{app.title}</p>
                          <StatusPill status={app.outcome ?? app.status} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{app.applicant?.name} · {app.opportunity.agency ?? 'Funder not recorded'}</p>
                        <div className="mt-2"><DeadlineChip daysLeft={app.opportunity.daysLeft} label={deadlineLabel({ ...app.opportunity, status: 'posted' })} /></div>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
      <AddOrganizationDialog open={adding} onOpenChange={setAdding} />
    </PageShell>
  );
}
