import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { errorMessage } from '@/lib/grants';
import { useMe } from '@/lib/account';

/**
 * Settings → Sources: the grant source registry and the review queue for
 * drafts extracted from watched pages (api-server routes/grant-sources.ts,
 * docs/SOURCE_REGISTRY.md). Owners and admins of the agency workspace, with
 * admin access unlocked.
 */

interface Freshness { state: 'fresh' | 'stale' | 'never' | 'not_running'; label: string; ageDays: number | null; staleAfterDays: number }

interface SourceView {
  id: string;
  key: string;
  name: string;
  jurisdictionKind: string;
  jurisdictionCode: string | null;
  connectorType: string;
  connector: string | null;
  urls: string[];
  scheduleHours: number;
  owner: string | null;
  status: string;
  termsNote: string | null;
  termsChecked: boolean;
  termsPermitAutomation: boolean;
  termsCheckedAt: string | null;
  termsCheckedBy: string | null;
  staleAfterDays: number | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
  running: boolean;
  freshness: Freshness;
  pendingDrafts: number;
}

interface SourcesPage {
  sources: SourceView[];
  counts: { total: number; running: number; stale: number; pendingDrafts: number };
  watcher: { backend: 'builtin' | 'changedetection'; mode: string; problem: string | null; staleAfterDays: number };
  options: { jurisdictionKinds: string[]; connectorTypes: string[]; stateCodes: string[] };
}

interface DraftView {
  id: string;
  sourceName: string | null;
  status: string;
  title: string;
  funder: string | null;
  deadline: string | null;
  rollingDeadline: boolean;
  opportunityStatus: string;
  amountMin: number | null;
  amountMax: number | null;
  eligibilitySummary: string | null;
  applicantKinds: string[];
  officialUrl: string | null;
  sourceUrl: string;
  checkedAt: string;
  evidence: string | null;
  notes: string[];
  demo: boolean;
  provider: string | null;
  reviewedBy: string | null;
  gate: { ok: boolean; problems: string[] } | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const money = (n: number | null) => (n === null ? null : `$${n.toLocaleString('en-US')}`);
const TYPE_LABELS: Record<string, string> = { feed: 'Feed (connector in code)', portal_page: 'State portal page', watched_page: 'Open-call page' };
const KIND_LABELS: Record<string, string> = { federal: 'Federal', state: 'State', foundation: 'Foundation', corporate: 'Corporate' };
const FRESH_STYLES: Record<Freshness['state'], string> = {
  fresh: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  stale: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  never: 'border-border bg-secondary text-muted-foreground',
  not_running: 'border-border bg-secondary text-muted-foreground',
};

function Pill({ className, children }: { className: string; children: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

const EMPTY_FORM = { name: '', jurisdictionKind: 'foundation', jurisdictionCode: '', connectorType: 'watched_page', url: '', scheduleHours: '24', owner: '', termsNote: '', termsChecked: false, termsPermitAutomation: false, status: 'disabled', staleAfterDays: '' };
type FormState = typeof EMPTY_FORM;

function formFrom(s: SourceView): FormState {
  return {
    name: s.name, jurisdictionKind: s.jurisdictionKind, jurisdictionCode: s.jurisdictionCode ?? '', connectorType: s.connectorType, url: s.urls.join('\n'),
    scheduleHours: String(s.scheduleHours), owner: s.owner ?? '', termsNote: s.termsNote ?? '', termsChecked: s.termsChecked, termsPermitAutomation: s.termsPermitAutomation,
    status: s.status, staleAfterDays: s.staleAfterDays === null ? '' : String(s.staleAfterDays),
  };
}

function SourceForm({ initial, options, feed, onSave, onCancel }: { initial: FormState; options: SourcesPage['options']; feed: boolean; onSave: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await onSave({
        name: f.name,
        ...(feed ? {} : { jurisdictionKind: f.jurisdictionKind, jurisdictionCode: f.jurisdictionKind === 'state' ? f.jurisdictionCode : null, connectorType: f.connectorType, urls: f.url.split(/\s+/).filter(Boolean) }),
        scheduleHours: Number(f.scheduleHours),
        owner: f.owner || null,
        termsNote: f.termsNote || null,
        termsChecked: f.termsChecked,
        termsPermitAutomation: f.termsChecked && f.termsPermitAutomation,
        status: f.status,
        staleAfterDays: f.staleAfterDays === '' ? null : Number(f.staleAfterDays),
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      try {
        const parsed = JSON.parse(text.slice(text.indexOf('{')));
        setErrors(parsed.errors ?? [parsed.error ?? text]);
      } catch {
        setErrors([errorMessage(err)]);
      }
    } finally {
      setBusy(false);
    }
  }

  const canActivate = f.termsChecked && f.termsPermitAutomation;
  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4" noValidate>
      {errors.length > 0 && (
        <Notice tone="error" title="Not saved">
          <ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} /></Field>
        <Field label="Owner" hint="Who keeps this row correct."><Input value={f.owner} onChange={(e) => set('owner', e.target.value)} maxLength={200} /></Field>
        {!feed && (
          <>
            <Field label="Jurisdiction">
              <select className={selectClass} value={f.jurisdictionKind} onChange={(e) => set('jurisdictionKind', e.target.value)}>
                {options.jurisdictionKinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
              </select>
            </Field>
            {f.jurisdictionKind === 'state' ? (
              <Field label="State">
                <select className={selectClass} value={f.jurisdictionCode} onChange={(e) => set('jurisdictionCode', e.target.value)}>
                  <option value="">Choose a state</option>
                  {options.stateCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            ) : <div className="hidden sm:block" />}
            <Field label="Connector type">
              <select className={selectClass} value={f.connectorType} onChange={(e) => set('connectorType', e.target.value)}>
                {options.connectorTypes.filter((t) => t !== 'feed').map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
              </select>
            </Field>
            <Field label="Page URL" hint="https only. The first URL is the one watched."><Input type="url" inputMode="url" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" required /></Field>
          </>
        )}
        <Field label="Check every (hours)" hint={feed ? undefined : 'At least 6 hours for pages.'}><Input type="number" min={1} max={720} value={f.scheduleHours} onChange={(e) => set('scheduleHours', e.target.value)} /></Field>
        <Field label="Stale after (days)" hint="Empty uses the server default."><Input type="number" min={1} max={90} value={f.staleAfterDays} onChange={(e) => set('staleAfterDays', e.target.value)} /></Field>
      </div>
      <fieldset className="space-y-3 rounded-2xl border border-border p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Terms of use</legend>
        <Field label="What the terms say, and where" hint="Quote or summarize the site's terms, with their URL and the date you read them.">
          <Textarea value={f.termsNote} onChange={(e) => set('termsNote', e.target.value)} rows={3} maxLength={2000} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={f.termsChecked} onChange={(e) => setF((x) => ({ ...x, termsChecked: e.target.checked, termsPermitAutomation: e.target.checked && x.termsPermitAutomation, status: e.target.checked ? x.status : x.status === 'active' ? 'disabled' : x.status }))} />
          I read this source's terms of use
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={f.termsPermitAutomation} disabled={!f.termsChecked} onChange={(e) => setF((x) => ({ ...x, termsPermitAutomation: e.target.checked, status: e.target.checked ? x.status : x.status === 'active' ? 'disabled' : x.status }))} />
          They permit automated reading of this page
        </label>
      </fieldset>
      <Field label="Status" hint={canActivate ? undefined : 'A source stays disabled until its terms are checked and permit automated reading.'}>
        <select className={selectClass} value={f.status} onChange={(e) => set('status', e.target.value)}>
          <option value="active" disabled={!canActivate}>Active</option>
          <option value="paused">Paused</option>
          <option value="disabled">Disabled</option>
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save source'}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function DraftCard({ d, onDone }: { d: DraftView; onDone: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const range = [money(d.amountMin), money(d.amountMax)].filter(Boolean).join(' to ');

  async function act(kind: 'approve' | 'reject') {
    setBusy(true);
    setError([]);
    try {
      await apiPost(`/grant-source-drafts/${d.id}/${kind}`, kind === 'approve' ? { confirmChecked: confirm, note: note || null } : { note: note || null });
      await onDone();
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      try {
        const parsed = JSON.parse(text.slice(text.indexOf('{')));
        setError(parsed.errors ?? [parsed.error]);
      } catch {
        setError([errorMessage(err)]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium text-foreground">{d.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {d.sourceName ?? 'Source'} · read {when(d.checkedAt)} · <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">source page<ExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
          </p>
        </div>
        {d.demo ? <Pill className="border-amber-400/25 bg-amber-400/10 text-amber-200">Demo output</Pill> : <Pill className="border-border bg-secondary text-muted-foreground">{`Draft · ${d.provider ?? 'AI'}`}</Pill>}
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        {([
          ['Funder', d.funder],
          ['Deadline', d.deadline ?? (d.rollingDeadline ? 'Rolling (stated on the page)' : null)],
          ['Status', d.opportunityStatus === 'forecasted' ? 'Announced for later' : 'Open'],
          ['Amount', range || null],
          ['Who may apply', d.applicantKinds.length ? d.applicantKinds.join(', ') : null],
          ['Official URL', d.officialUrl],
        ] as [string, string | null][]).map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-muted-foreground">{label}:</dt>
            <dd className={`min-w-0 break-words ${value ? 'text-foreground' : 'italic text-muted-foreground'}`}>{value ?? 'not stated on the page'}</dd>
          </div>
        ))}
      </dl>
      {d.eligibilitySummary && <p className="text-xs text-muted-foreground"><span className="text-foreground">Eligibility: </span>{d.eligibilitySummary}</p>}
      {d.evidence && <blockquote className="border-l-2 border-border pl-3 text-xs italic text-muted-foreground">“{d.evidence}”</blockquote>}
      {d.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-200">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {d.gate && !d.gate.ok && (
        <Notice tone="warn" title="Cannot be approved yet">
          <ul className="list-disc pl-4">{d.gate.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Notice>
      )}
      {error.length > 0 && <Notice tone="error"><ul className="list-disc pl-4">{error.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
      {d.status === 'pending' && (
        <div className="space-y-2">
          <Field label="Review note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          {!d.demo && (
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              I checked every field against the source page. Approving makes it an opportunity, shown only if it passes the publication gate.
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {!d.demo && <Button size="sm" disabled={busy || !confirm || !d.gate?.ok} onClick={() => act('approve')}>Approve</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('reject')}>Reject</Button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function SourcesTab() {
  const me = useMe();
  const qc = useQueryClient();
  const unlocked = me.data?.isAdmin === true;
  const agency = me.data?.workspace?.kind === 'agency' || !me.data?.workspace;
  const [editing, setEditing] = useState<SourceView | 'new' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [draftStatus, setDraftStatus] = useState('pending');

  const sources = useQuery({ queryKey: ['grant-sources'], queryFn: () => apiGet<SourcesPage>('/grant-sources'), enabled: unlocked && agency });
  const drafts = useQuery({ queryKey: ['grant-source-drafts', draftStatus], queryFn: () => apiGet<{ drafts: DraftView[] }>(`/grant-source-drafts?status=${draftStatus}`), enabled: unlocked && agency });
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['grant-sources'] });
    await qc.invalidateQueries({ queryKey: ['grant-source-drafts'] });
  };

  if (!unlocked) return <Notice tone="info" title="Admin access needed">Unlock admin access under Security at the top of this page to manage grant sources.</Notice>;
  if (!agency) return <Notice tone="info" title="Managed by the agency">Grant sources are shared by every workspace, so they are managed from the agency workspace.</Notice>;
  if (sources.isLoading) return <LoadingState label="Loading sources…" className="min-h-[20vh]" />;
  if (sources.isError || !sources.data) return <StateMessage tone="error" title="Sources could not load" description={errorMessage(sources.error)} action={<Button onClick={() => sources.refetch()}>Try again</Button>} />;
  const d = sources.data;

  async function save(body: Record<string, unknown>) {
    if (editing === 'new') await apiPost('/grant-sources', body);
    else if (editing) await apiPatch(`/grant-sources/${editing.id}`, body);
    setEditing(null);
    setMessage({ tone: 'ok', text: 'Source saved.' });
    await reload();
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: 'ok', text: ok });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
    await reload();
  }

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([['Sources', d.counts.total], ['Running', d.counts.running], ['Stale', d.counts.stale], ['Drafts to review', d.counts.pendingDrafts]] as [string, number][]).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`mt-1 text-2xl font-semibold ${label === 'Stale' && value > 0 ? 'text-amber-200' : 'text-foreground'}`}>{value}</dd>
          </div>
        ))}
      </dl>

      <Notice tone={d.watcher.problem ? 'warn' : 'info'} title={d.watcher.backend === 'changedetection' ? `Pages are watched by changedetection.io (${d.watcher.mode})` : 'Pages are read by the built-in fetcher'}>
        {d.watcher.problem ?? `A source is stale after ${d.watcher.staleAfterDays} days without a successful check, unless its row sets its own window. Drafts from pages never publish on their own.`}
      </Notice>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Panel>
        <PanelHeader
          title="Sources"
          description="Every place opportunities come from. A source is a row: a new state portal or funder page needs no release."
          actions={<div className="flex gap-2"><Button size="sm" variant="ghost" className="gap-1.5" onClick={() => reload()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reload</Button><Button size="sm" onClick={() => setEditing('new')}>Add a page source</Button></div>}
        />
        {editing === 'new' && <SourceForm initial={EMPTY_FORM} options={d.options} feed={false} onSave={save} onCancel={() => setEditing(null)} />}
        {d.sources.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No sources yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.sources.map((s) => (
              <li key={s.id} className="space-y-2 px-5 py-4 text-sm">
                {editing !== 'new' && editing?.id === s.id ? (
                  <SourceForm initial={formFrom(s)} options={d.options} feed={s.connectorType === 'feed'} onSave={save} onCancel={() => setEditing(null)} />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{s.name}</span>
                      <Pill className="border-border bg-secondary text-muted-foreground">{`${KIND_LABELS[s.jurisdictionKind] ?? s.jurisdictionKind}${s.jurisdictionCode ? ` · ${s.jurisdictionCode}` : ''}`}</Pill>
                      <Pill className="border-border bg-secondary text-muted-foreground">{TYPE_LABELS[s.connectorType] ?? s.connectorType}</Pill>
                      <Pill className={FRESH_STYLES[s.freshness.state]}>{s.freshness.label}</Pill>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">{s.urls[0]}</p>
                    <p className="text-xs text-muted-foreground">
                      {`Status ${s.status} · every ${s.scheduleHours} h · last checked ${when(s.lastCheckedAt)} · last success ${when(s.lastSuccessAt)}${s.owner ? ` · owner ${s.owner}` : ''}${s.pendingDrafts ? ` · ${s.pendingDrafts} draft${s.pendingDrafts === 1 ? '' : 's'} to review` : ''}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.termsChecked ? `Terms checked${s.termsCheckedBy ? ` by ${s.termsCheckedBy}` : ''}${s.termsCheckedAt ? ` on ${new Date(s.termsCheckedAt).toLocaleDateString()}` : ''}; ${s.termsPermitAutomation ? 'they permit automated reading' : 'they do not permit automated reading'}.` : 'Terms not checked: the source stays disabled.'}
                      {s.termsNote ? ` ${s.termsNote}` : ''}
                    </p>
                    {s.lastError && <p className="break-words text-xs text-red-300">{`Last error: ${s.lastError}`}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>Edit</Button>
                      {s.connectorType !== 'feed' && <Button size="sm" variant="ghost" disabled={!s.running} onClick={() => act(() => apiPost(`/grant-sources/${s.id}/check`), `${s.name} checked.`)} aria-label={`Check ${s.name} now`}>Check now</Button>}
                      {s.connectorType !== 'feed' && (
                        <ConfirmDialog
                          trigger={<Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`}>Delete</Button>}
                          title={`Delete ${s.name}?`}
                          description="Its checks and drafts are deleted too. A source with approved opportunities cannot be deleted; disable it instead."
                          onConfirm={() => act(() => apiDelete(`/grant-sources/${s.id}`), `${s.name} deleted.`)}
                        />
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Review queue" description="Draft listings extracted from changed pages. Check each against its page; only what a person approves becomes an opportunity, and only if it passes the publication gate." />
        <div className="border-b border-border px-5 py-3">
          <Field label="Show" className="max-w-xs">
            <select className={selectClass} value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
              <option value="pending">To review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
        </div>
        {drafts.isLoading ? <LoadingState label="Loading drafts…" className="min-h-[10vh]" /> : drafts.isError ? (
          <div className="px-5 py-4"><Notice tone="error">{errorMessage(drafts.error)}</Notice></div>
        ) : (drafts.data?.drafts.length ?? 0) === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-border">{drafts.data!.drafts.map((x) => <DraftCard key={x.id} d={x} onDone={reload} />)}</ul>
        )}
      </Panel>
    </div>
  );
}
