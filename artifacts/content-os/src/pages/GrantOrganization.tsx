import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, ExternalLink, Search, Trash2 } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, StateMessage, LoadingState } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FactLibrary } from '@/components/grants/FactLibrary';
import { DeadlineChip, Field, Notice, ReadinessRing, ReasonList, ScoreBadge, StatusPill, selectClass } from '@/components/grants/GrantUi';
import { awardRange, deadlineLabel, errorMessage, grantsApi, useApplicant, useGrantMeta, useInvalidateGrants, useMatches, type Applicant, type ReadinessRow } from '@/lib/grants';

function MatchesTab({ applicant }: { applicant: Applicant }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const hasTopics = applicant.focusAreas.length > 0 || Boolean(applicant.mission);
  const [relevantOnly, setRelevantOnly] = useState(hasTopics);
  const [newOnly, setNewOnly] = useState(false);
  const [marking, setMarking] = useState(false);
  const invalidate = useInvalidateGrants();
  const matches = useMatches(applicant.id, submitted, relevantOnly && hasTopics, newOnly);

  async function markSeen() {
    setMarking(true);
    try {
      await grantsApi.markMatchesSeen(applicant.id);
      setNewOnly(false);
      await invalidate();
    } finally {
      setMarking(false);
    }
  }
  const meta = useGrantMeta();

  return (
    <div className="space-y-4">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="match-search">Search matches</label>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="match-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, agency or opportunity number" className="pl-9" />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {applicant.focusAreas.length === 0 && (
        <Notice tone="warn" title="Add focus areas to improve matching">Matches use eligibility, award size and deadlines today. Add focus areas on the Profile tab to rank opportunities by topic.</Notice>
      )}

      {matches.isLoading && <LoadingState label="Finding opportunities…" className="min-h-[20vh]" />}
      {matches.isError && <StateMessage tone="error" title="Matches could not load" description={errorMessage(matches.error)} action={<Button onClick={() => matches.refetch()}>Try again</Button>} />}
      {matches.data && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-sm text-muted-foreground">
              {matches.data.newTotal > 0 && <span className="font-medium text-brand">{`${matches.data.newTotal.toLocaleString('en-US')} new · `}</span>}
              {hasTopics && `${matches.data.relevantTotal.toLocaleString('en-US')} on your topics · `}
              {matches.data.total.toLocaleString('en-US')} eligible of {matches.data.considered.toLocaleString('en-US')} open opportunities
              {matches.data.excluded > 0 && ` · ${matches.data.excluded.toLocaleString('en-US')} excluded by eligibility, deadline or cost share`}
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-4">
              {hasTopics && (
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={relevantOnly} onChange={(e) => setRelevantOnly(e.target.checked)} className="h-4 w-4 accent-primary" />
                  Only my topics
                </label>
              )}
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} className="h-4 w-4 accent-primary" />
                Only new
              </label>
              {matches.data.newTotal > 0 && (
                <Button size="sm" variant="outline" onClick={markSeen} disabled={marking}>{marking ? 'Saving…' : 'Mark all as seen'}</Button>
              )}
            </div>
          </div>
          {matches.data.broadTopics.length > 0 && (
            <Notice tone="info" title="Some focus areas are very broad">
              {matches.data.broadTopics.map((t) => `“${t}”`).join(', ')} appear{matches.data.broadTopics.length === 1 ? 's' : ''} in most eligible opportunities, so {matches.data.broadTopics.length === 1 ? 'it does' : 'they do'} little to narrow your matches. Add specific areas on the Profile tab, for example “adult literacy” or “rural broadband”.
            </Notice>
          )}
          {matches.data.closingSoonTotal > 0 && !newOnly && (
            <Notice tone="warn" title={`${matches.data.closingSoonTotal} match${matches.data.closingSoonTotal === 1 ? '' : 'es'} close within 14 days`}>Federal applications usually take weeks. Start these now or skip them.</Notice>
          )}
          {newOnly && matches.data.matches.length === 0 && (
            <Notice tone="info" title="Nothing new since you last looked">New opportunities from the daily refresh appear here. Clear Only new to see every match.</Notice>
          )}
          {relevantOnly && hasTopics && matches.data.relevantTotal === 0 && matches.data.total > 0 && (
            <Notice tone="info" title="Nothing on your topics yet">No eligible opportunity uses your focus areas or mission words. Clear Only my topics to see every eligible opportunity, or broaden the focus areas on the Profile tab.</Notice>
          )}
          {matches.data.considered === 0 && (
            <StateMessage
              title="No opportunities stored yet"
              description={meta.data?.syncRunning ? 'The first refresh from Grants.gov is running. Check back in a few minutes.' : 'Run Refresh now on the Grant Studio page to load open federal opportunities.'}
              action={<Button asChild variant="outline"><Link href="/grant-studio">Go to Grant Studio</Link></Button>}
            />
          )}
          <ul className="space-y-3">
            {matches.data.matches.map(({ opportunity: o, match, isNew }) => (
              <li key={o.id}>
                <article className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold leading-snug text-foreground">
                        <Link href={`/grant-studio/opportunities/${o.id}?org=${applicant.id}`} className="hover:text-brand focus-visible:text-brand">{o.title}</Link>
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">{o.agency ?? 'Agency not recorded'}{o.number ? ` · ${o.number}` : ''}</p>
                    </div>
                    <ScoreBadge score={match.score} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isNew && <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">New</span>}
                    <DeadlineChip daysLeft={o.daysLeft} label={deadlineLabel(o)} />
                    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">{awardRange(o)}</span>
                    {o.status === 'forecasted' && <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">Forecast</span>}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <ReasonList items={match.reasons} kind="reason" />
                    <ReasonList items={match.gaps} kind="gap" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild size="sm"><Link href={`/grant-studio/opportunities/${o.id}?org=${applicant.id}`}>Review and apply</Link></Button>
                    <Button asChild size="sm" variant="ghost" className="gap-1.5">
                      <a href={o.officialUrl} target="_blank" rel="noreferrer">Official listing <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
                    </Button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReadinessItem({ applicantId, item }: { applicantId: string; item: ReadinessRow }) {
  const invalidate = useInvalidateGrants();
  const [status, setStatus] = useState(item.status);
  const [expiresOn, setExpiresOn] = useState(item.expiresOn ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [message, setMessage] = useState('');
  const dirty = status !== item.status || expiresOn !== (item.expiresOn ?? '') || note !== (item.note ?? '');

  async function save() {
    setMessage('');
    try {
      await grantsApi.setReadiness(applicantId, item.kind, { status, expiresOn: expiresOn || null, note: note || null });
      await invalidate();
      setMessage('Saved.');
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1.4fr)_10rem_10rem_minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{item.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.blocking ? 'Required before applying' : 'Commonly requested'}
          {item.confirmedBy && item.status === 'ready' ? ` · confirmed by ${item.confirmedBy}` : ''}
        </p>
      </div>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value as ReadinessRow['status'])} className={selectClass} aria-label={`${item.label} status`}>
          <option value="missing">Missing</option>
          <option value="in_progress">In progress</option>
          <option value="ready">Ready</option>
        </select>
      </Field>
      <Field label="Expires on">
        <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} aria-label={`${item.label} expiry date`} />
      </Field>
      <Field label="Note">
        <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label={`${item.label} note`} />
      </Field>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!dirty}>Save</Button>
        <span role="status" className="text-xs text-muted-foreground">{message}</span>
      </div>
    </li>
  );
}

function ReadinessTab({ applicant }: { applicant: Applicant }) {
  return (
    <Panel>
      <PanelHeader
        title="Readiness"
        description="Federal awards need an active SAM.gov registration and UEI, and a Grants.gov Authorized Organization Representative to submit. Registration can take weeks: start early."
        icon={<ReadinessRing score={applicant.readiness.score} size={40} />}
      />
      <ul className="divide-y divide-border">
        {applicant.readiness.items.map((item) => <ReadinessItem key={item.kind} applicantId={applicant.id} item={item} />)}
      </ul>
    </Panel>
  );
}

function ProfileTab({ applicant }: { applicant: Applicant }) {
  const invalidate = useInvalidateGrants();
  const [, navigate] = useLocation();
  const [form, setForm] = useState(() => toForm(applicant));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setForm(toForm(applicant)), [applicant]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await grantsApi.updateApplicant(applicant.id, {
        name: form.name,
        ein: form.ein || null,
        uei: form.uei || null,
        state: form.state || null,
        serviceArea: form.serviceArea || null,
        mission: form.mission || null,
        focusAreas: form.focusAreas.split(',').map((v) => v.trim()).filter(Boolean),
        naicsCodes: form.naicsCodes.split(',').map((v) => v.trim()).filter(Boolean),
        annualBudget: form.annualBudget ? Number(form.annualBudget.replace(/[$,]/g, '')) : null,
        maxCostSharePercent: Number(form.maxCostSharePercent || 0),
      });
      await invalidate();
      setMessage('Profile saved.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${applicant.name} and all of its applications? This cannot be undone.`)) return;
    await grantsApi.deleteApplicant(applicant.id);
    await invalidate();
    navigate('/grant-studio');
  }

  const business = applicant.applicantType === 'small_business' || applicant.applicantType === 'for_profit';
  return (
    <Panel className="p-5">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Legal name" className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="EIN" hint="Format 12-3456789."><Input value={form.ein} onChange={(e) => setForm({ ...form, ein: e.target.value })} /></Field>
        <Field label="UEI" hint="12-character SAM.gov Unique Entity ID."><Input value={form.uei} onChange={(e) => setForm({ ...form, uei: e.target.value })} /></Field>
        <Field label="State"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
        <Field label="Service area" hint="Counties, cities or regions served."><Input value={form.serviceArea} onChange={(e) => setForm({ ...form, serviceArea: e.target.value })} /></Field>
        <Field label="Mission" className="sm:col-span-2"><Textarea rows={4} value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} /></Field>
        <Field label="Focus areas" hint="Comma separated. Each one is matched against opportunity titles and descriptions." className="sm:col-span-2"><Input value={form.focusAreas} onChange={(e) => setForm({ ...form, focusAreas: e.target.value })} /></Field>
        {business && <Field label="NAICS codes" hint="Comma separated, 2 to 6 digits."><Input value={form.naicsCodes} onChange={(e) => setForm({ ...form, naicsCodes: e.target.value })} /></Field>}
        <Field label="Annual budget or revenue (USD)"><Input inputMode="numeric" value={form.annualBudget} onChange={(e) => setForm({ ...form, annualBudget: e.target.value })} /></Field>
        <Field label="Largest cost share you can commit (%)" hint="0 hides opportunities that require cost sharing."><Input type="number" min={0} max={100} value={form.maxCostSharePercent} onChange={(e) => setForm({ ...form, maxCostSharePercent: e.target.value })} /></Field>
        {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={remove} className="gap-2 text-red-300"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete organization</Button>
          <div className="flex items-center gap-3">
            <span role="status" className="text-xs text-muted-foreground">{message}</span>
            <Button type="submit">Save profile</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}

function toForm(a: Applicant) {
  return {
    name: a.name,
    ein: a.ein ?? '',
    uei: a.uei ?? '',
    state: a.state ?? '',
    serviceArea: a.serviceArea ?? '',
    mission: a.mission ?? '',
    focusAreas: a.focusAreas.join(', '),
    naicsCodes: a.naicsCodes.join(', '),
    annualBudget: a.annualBudget ? String(a.annualBudget) : '',
    maxCostSharePercent: String(a.maxCostSharePercent ?? 0),
  };
}

function ApplicationsTab({ applicant }: { applicant: Applicant }) {
  const apps = applicant.applications ?? [];
  if (!apps.length) return <StateMessage title="No applications yet" description="Open a match and choose Review and apply to start one." />;
  return (
    <Panel>
      <ul className="divide-y divide-border">
        {apps.map((app) => (
          <li key={app.id}>
            <Link href={`/grant-studio/applications/${app.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{app.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{app.opportunity.agency ?? 'Funder not recorded'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DeadlineChip daysLeft={app.opportunity.daysLeft} label={deadlineLabel({ ...app.opportunity, status: 'posted' })} />
                <StatusPill status={app.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function GrantOrganization() {
  const { id } = useParams<{ id: string }>();
  const applicant = useApplicant(id);

  if (applicant.isLoading) return <LoadingState label="Loading organization…" />;
  if (applicant.isError || !applicant.data) {
    return (
      <PageShell>
        <StateMessage tone="error" title="Organization not found" description="It may have been deleted, or it belongs to another account." action={<Button asChild><Link href="/grant-studio">Back to Grant Studio</Link></Button>} />
      </PageShell>
    );
  }
  const a = applicant.data;

  return (
    <PageShell>
      <Link href="/grant-studio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Grant Studio
      </Link>
      <PageHeader
        eyebrow={a.applicantTypeLabel}
        title={a.name}
        description={a.mission ?? 'Add a mission on the Profile tab so drafts can describe the organization accurately.'}
        actions={<div className="flex items-center gap-3"><ReadinessRing score={a.readiness.score} /><span className="text-xs text-muted-foreground">{a.readiness.blockingOpen === 0 ? 'Ready to apply' : `${a.readiness.blockingOpen} required item${a.readiness.blockingOpen === 1 ? '' : 's'} not ready`}</span></div>}
      />
      {a.readiness.blockingOpen > 0 && (
        <div className="mb-6">
          <Notice tone="warn" title="Some required registrations are not ready">Matches still show, with the gap on each. Update them on the Readiness tab.</Notice>
        </div>
      )}
      <Tabs defaultValue="matches">
        <TabsList className="mb-5 flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="applications">Applications ({a.applications?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="library">Fact library</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>
        <TabsContent value="matches"><MatchesTab applicant={a} /></TabsContent>
        <TabsContent value="readiness"><ReadinessTab applicant={a} /></TabsContent>
        <TabsContent value="applications"><ApplicationsTab applicant={a} /></TabsContent>
        <TabsContent value="library"><FactLibrary applicantId={a.id} /></TabsContent>
        <TabsContent value="profile"><ProfileTab applicant={a} /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
