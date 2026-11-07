import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Landmark, Search, Sparkles } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, LoadingState } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Notice, ReasonList, ScoreBadge, selectClass } from '@/components/grants/GrantUi';
import { errorMessage, useApplicants } from '@/lib/grants';
import { HISTORY_LABEL, NO_SUGGESTION_FILTERS, US_STATES, requestAmount, useFoundationMeta, useFoundationSuggestions, useFunderSearch, usd, years, type FunderSummary, type SearchParams, type Suggestion, type SuggestionParams } from '@/lib/foundations';
import { ComponentList, FilingLinkRow, PolicyBadge } from '@/components/grants/FoundationUi';

/** Grant Studio → Foundations: search funders by their giving history and suggest some for an organization. */
export default function GrantFoundations() {
  const meta = useFoundationMeta();
  const [draft, setDraft] = useState({ q: '', givesIn: '', cause: '' });
  const [params, setParams] = useState<SearchParams>({ q: '', givesIn: '', cause: '', page: 1 });
  const search = useFunderSearch(params);

  function submit(e: FormEvent) {
    e.preventDefault();
    setParams({ ...draft, page: 1 });
  }

  const last = meta.data?.lastImport;
  const pages = search.data ? Math.max(1, Math.ceil(search.data.total / search.data.pageSize)) : 1;

  return (
    <PageShell width="default">
      <Link href="/grant-studio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Grant Studio
      </Link>
      <PageHeader
        eyebrow="Grant Studio"
        title="Foundations"
        description="Who private foundations have funded, how much and where, from the grants they report on their IRS tax filings. Use it to research funders; it is not a list of open calls."
      />
      <div className="mb-6">
        <Notice tone="warn" title={HISTORY_LABEL}>
          Filings lag by one to two years, and many foundations do not accept unsolicited proposals. Check each funder’s own instructions before you approach it.
        </Notice>
      </div>

      <div className="space-y-6">
        <SuggestionsPanel causes={meta.data?.causes ?? []} />

        <Panel>
          <PanelHeader title="Search funders" icon={<Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} description={meta.data ? `${meta.data.funders.toLocaleString('en-US')} funders imported.` : undefined} />
          <form onSubmit={submit} className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_10rem_14rem_auto] sm:items-end">
            <Field label="Funder name">
              <Input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="Part of the name" />
            </Field>
            <Field label="Gave in state">
              <select className={selectClass} value={draft.givesIn} onChange={(e) => setDraft({ ...draft, givesIn: e.target.value })}>
                <option value="">Any state</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Cause">
              <select className={selectClass} value={draft.cause} onChange={(e) => setDraft({ ...draft, cause: e.target.value })}>
                <option value="">Any cause</option>
                {(meta.data?.causes ?? []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Button type="submit" className="gap-2"><Search className="h-4 w-4" aria-hidden="true" /> Search</Button>
          </form>
          {search.isLoading ? (
            <LoadingState label="Searching funders…" className="min-h-0" />
          ) : search.isError || !search.data ? (
            <div className="px-5 pb-5"><Notice tone="error">{errorMessage(search.error)}</Notice></div>
          ) : search.data.funders.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              {meta.data?.funders ? 'No funder matches this search. Try fewer words or another state.' : 'No foundation data has been imported on this server yet. An admin can run the import from the Jobs screen once the data source is approved.'}
            </p>
          ) : (
            <>
              <p className="px-5 text-xs text-muted-foreground" role="status">{search.data.total.toLocaleString('en-US')} funders{params.givesIn ? `, ranked by giving in ${params.givesIn}` : params.cause ? ', ranked by giving to this cause' : ', ranked by total giving'}.</p>
              <ul className="mt-2 divide-y divide-border border-t border-border">{search.data.funders.map((f) => <FunderRow key={f.ein} funder={f} />)}</ul>
              {pages > 1 && (
                <nav aria-label="Search pages" className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  <Button size="sm" variant="secondary" disabled={params.page <= 1} onClick={() => setParams({ ...params, page: params.page - 1 })}>Previous</Button>
                  <span>Page {params.page} of {pages}</span>
                  <Button size="sm" variant="secondary" disabled={params.page >= pages} onClick={() => setParams({ ...params, page: params.page + 1 })}>Next</Button>
                </nav>
              )}
            </>
          )}
        </Panel>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Source: <a className="underline underline-offset-4 hover:text-foreground" href="https://github.com/egeria-corporation/funder-graph" target="_blank" rel="noreferrer">funder-graph</a>, built from IRS Form 990-PF and 990 e-file data.
          {last ? ` Last import ${last.status}${last.finishedAt ? ` on ${new Date(last.finishedAt).toLocaleDateString('en-US')}` : ''}${last.datasetVersion ? `, dataset ${last.datasetVersion}` : ''}; recipient matches used at confidence ${last.minConfidence.toFixed(2)} or higher.` : ''}
        </p>
      </div>
    </PageShell>
  );
}

function FunderRow({ funder: f }: { funder: FunderSummary }) {
  return (
    <li className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/grant-studio/foundations/${f.ein}`} className="font-medium text-foreground underline-offset-4 hover:underline">{f.name}</Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          EIN {f.einFormatted}{f.state ? ` · ${f.state}` : ''} · {years(f.firstTaxYear, f.lastTaxYear)} · median grant {usd(f.medianGrantUsd)}
          {f.topCauses.length ? ` · ${f.topCauses.map((c) => c.label).join(', ')}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <PolicyBadge policy={f.applicationPolicy} />
        <p className="text-sm tabular-nums text-foreground">{usd(f.totalPaidUsd)} <span className="text-xs text-muted-foreground">in {f.grantCount.toLocaleString('en-US')} grants</span></p>
      </div>
    </li>
  );
}

/** Funders ranked for an organization from their giving history, each with its reasons and its filing. */
function SuggestionsPanel({ causes }: { causes: { key: string; label: string }[] }) {
  const orgs = useApplicants();
  const [orgId, setOrgId] = useState('');
  const [draft, setDraft] = useState<SuggestionParams>(NO_SUGGESTION_FILTERS);
  const [params, setParams] = useState<SuggestionParams>(NO_SUGGESTION_FILTERS);
  const chosen = orgId || orgs.data?.[0]?.id || '';
  const s = useFoundationSuggestions(chosen, params);
  if (orgs.isLoading) return <Panel><LoadingState label="Loading your organizations…" className="min-h-0" /></Panel>;
  if (orgs.isError) return <Panel><div className="px-5 py-4"><Notice tone="error">{errorMessage(orgs.error)}</Notice></div></Panel>;
  if (!orgs.data?.length) {
    return (
      <Panel>
        <PanelHeader title="Funders matched to your organization" icon={<Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />} />
        <div className="px-5 py-4">
          <Notice title="Add an organization first" action={<Button asChild size="sm" variant="secondary"><Link href="/grant-studio">Grant Studio</Link></Button>}>
            Suggestions compare funders’ giving with an organization’s state, causes and budget. Add one in Grant Studio to see them.
          </Notice>
        </div>
      </Panel>
    );
  }
  const badRequest = draft.request.trim() !== '' && requestAmount(draft.request) === null;

  function apply(e: FormEvent) {
    e.preventDefault();
    if (!badRequest) setParams(draft);
  }

  return (
    <Panel>
      <PanelHeader
        title="Funders matched to your organization"
        icon={<Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />}
        description="Ranked by giving in your state, to your cause, grant size, and how recently and steadily they gave. Guidance for research, not an eligibility decision."
      />
      <div className="space-y-4 px-5 py-4">
        <form onSubmit={apply} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_12rem_auto] lg:items-end">
          <Field label="Organization">
            <select className={selectClass} value={chosen} onChange={(e) => setOrgId(e.target.value)}>
              {orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Cause (NTEE)">
            <select className={selectClass} value={draft.cause} onChange={(e) => setDraft({ ...draft, cause: e.target.value })}>
              <option value="">From the organization’s profile</option>
              {causes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Request amount (optional)" hint={badRequest ? 'Enter a whole dollar amount, for example 25000.' : undefined}>
            <Input inputMode="numeric" value={draft.request} aria-invalid={badRequest || undefined} onChange={(e) => setDraft({ ...draft, request: e.target.value })} placeholder="For example 25000" />
          </Field>
          <Button type="submit" variant="secondary" disabled={badRequest}>Update</Button>
          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2 lg:col-span-4">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.hideInvitationOnly} onChange={(e) => { const next = { ...draft, hideInvitationOnly: e.target.checked }; setDraft(next); if (!badRequest) setParams(next); }} />
            Hide funders whose latest filing says they accept no unsolicited requests
          </label>
        </form>
        {s.isLoading ? (
          <LoadingState label="Ranking funders…" className="min-h-0" />
        ) : s.isError || !s.data ? (
          <Notice tone="error" action={<Button size="sm" variant="secondary" onClick={() => void s.refetch()}>Try again</Button>}>{errorMessage(s.error)}</Notice>
        ) : s.data.missing ? (
          <Notice title="More profile detail needed" action={<Button asChild size="sm" variant="secondary"><Link href={`/grant-studio/organizations/${chosen}`}>Edit profile</Link></Button>}>{s.data.missing}</Notice>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Funders that gave in {s.data.state} and to: {s.data.causes.map((c) => `${c.label} (from ${c.from === 'your choice' ? 'your choice' : `your ${c.from}`})`).join('; ')}.
              {s.data.requestUsd ? ` Grant size compared with your request of ${usd(s.data.requestUsd)}.` : s.data.annualBudget ? ` Grant size compared with your annual budget of ${usd(s.data.annualBudget)}.` : ' Add an annual budget or a request amount to compare grant sizes.'}
            </p>
            {s.data.suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No imported funder gave in {s.data.state} and to these causes{params.hideInvitationOnly ? ' (funders that accept no unsolicited requests are hidden)' : ''}.</p>
            ) : (
              <ol className="space-y-3" aria-label="Matched funders, best first">
                {s.data.suggestions.map((f, i) => <SuggestionCard key={f.ein} rank={i + 1} funder={f} state={s.data!.state ?? ''} />)}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">{s.data.note}</p>
          </>
        )}
      </div>
    </Panel>
  );
}

function SuggestionCard({ funder: f, rank, state }: { funder: Suggestion; rank: number; state: string }) {
  return (
    <li className="space-y-3 rounded-xl border border-border px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">#{rank}</p>
          <Link href={`/grant-studio/foundations/${f.ein}`} className="font-medium text-foreground underline-offset-4 hover:underline">{f.name}</Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            EIN {f.einFormatted}{f.state ? ` · ${f.state}` : ''} · {years(f.firstTaxYear, f.lastTaxYear)} · <Landmark className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /> {usd(f.inStateUsd)} in {state}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {typeof f.score === 'number' && <ScoreBadge score={f.score} />}
          <PolicyBadge policy={f.applicationPolicy} />
        </div>
      </div>
      {f.components?.length ? <ComponentList items={f.components} /> : <ReasonList items={f.reasons} kind="reason" />}
      {f.cautions?.length ? <ReasonList items={f.cautions} kind="gap" /> : null}
      <FilingLinkRow filing={f.filing} label="Latest filing counted" />
    </li>
  );
}
