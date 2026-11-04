import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, Check, CheckCircle2, Circle, Download, ExternalLink, FileText, Plus, Sparkles, Trash2, Wand2, XCircle } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, StateMessage, LoadingState } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RichEditor } from '@/components/RichEditor';
import { DeadlineChip, Field, Notice, StatusPill, selectClass } from '@/components/grants/GrantUi';
import { cn } from '@/lib/utils';
import { deadlineLabel, errorMessage, grantsApi, packageUrl, usd, useGrantMeta, useInvalidateGrants, useWorkspace, type Requirement, type Section, type Workspace } from '@/lib/grants';

const KIND_LABELS: Record<string, string> = {
  section: 'Section',
  criterion: 'Review criterion',
  attachment: 'Attachment',
  form: 'Form',
  eligibility: 'Eligibility',
  formatting: 'Formatting',
  deadline: 'Deadline',
};

function useAction() {
  const invalidate = useInvalidateGrants();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, success?: (result: T) => { tone: 'ok' | 'warn'; text: string } | null) {
    setBusy(key);
    setMessage(null);
    try {
      const result = await fn();
      await invalidate();
      const next = success?.(result);
      if (next) setMessage(next);
      return result;
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { busy, message, setMessage, run };
}

function ActionMessage({ message }: { message: { tone: 'ok' | 'warn' | 'error'; text: string } | null }) {
  if (!message) return <span role="status" className="sr-only" />;
  return <div role="status"><Notice tone={message.tone}>{message.text}</Notice></div>;
}

// ── Step 1: Requirements ─────────────────────────────────────────────────

function RequirementRow({ req, sections }: { req: Requirement; sections: Section[] }) {
  const { run } = useAction();
  return (
    <tr className={cn('align-top', !req.confirmed && 'bg-amber-400/[0.04]')}>
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-foreground">{req.label}</p>
        {req.detail && <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{req.detail}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {KIND_LABELS[req.kind] ?? req.kind}
          {req.points ? ` · ${req.points} points` : ''}
          {req.sourceRef ? ` · ${req.sourceRef === 'template' ? 'from the template' : req.sourceRef}` : ''}
          {req.origin === 'extracted' ? ' · extracted by AI' : ''}
        </p>
      </td>
      <td className="px-4 py-3">
        <select
          aria-label={`Section that answers ${req.label}`}
          value={req.sectionKey ?? ''}
          onChange={(e) => run('section', () => grantsApi.updateRequirement(req.id, { sectionKey: e.target.value || null }))}
          className={cn(selectClass, 'h-9 text-xs')}
        >
          <option value="">No section</option>
          {sections.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
        </select>
      </td>
      <td className="px-4 py-3">
        <select
          aria-label={`Status of ${req.label}`}
          value={req.status}
          onChange={(e) => run('status', () => grantsApi.updateRequirement(req.id, { status: e.target.value as Requirement['status'] }))}
          className={cn(selectClass, 'h-9 text-xs')}
        >
          <option value="open">Open</option>
          <option value="covered">Covered</option>
          <option value="not_applicable">Not applicable</option>
        </select>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={req.confirmed ? 'ghost' : 'secondary'}
            onClick={() => run('confirm', () => grantsApi.updateRequirement(req.id, { confirmed: !req.confirmed }))}
            aria-label={req.confirmed ? `Mark ${req.label} unconfirmed` : `Confirm ${req.label}`}
            className="gap-1"
          >
            {req.confirmed ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> Confirmed</> : 'Confirm'}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete ${req.label}`} onClick={() => run('delete', () => grantsApi.deleteRequirement(req.id))}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

function RequirementsStep({ ws }: { ws: Workspace }) {
  const { busy, message, run } = useAction();
  const [notice, setNotice] = useState(ws.application.noticeText ?? '');
  const [form, setForm] = useState({ kind: 'criterion', label: '', detail: '', points: '', sourceRef: '' });
  const unconfirmed = ws.requirements.filter((r) => !r.confirmed).length;

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!form.label.trim()) return;
    const ok = await run('add', () => grantsApi.addRequirement(ws.application.id, { kind: form.kind, label: form.label, detail: form.detail || null, sourceRef: form.sourceRef || null, points: form.points ? Number(form.points) : null }));
    if (ok) setForm({ kind: 'criterion', label: '', detail: '', points: '', sourceRef: '' });
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title="Funding notice" description="Paste the notice (NOFO, RFA or solicitation) to extract its requirements, limits and review criteria. Each extracted row needs your confirmation." icon={<FileText className="h-4 w-4 text-brand" aria-hidden="true" />} />
        <div className="space-y-3 px-5 py-4">
          <Field label="Notice text">
            <Textarea rows={6} value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="Paste the full text of the notice, or at least its application contents and review criteria sections." />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => run('extract', () => grantsApi.extract(ws.application.id, notice), (r) => ({ tone: r.demo ? 'warn' : 'ok', text: r.demo ? r.message ?? 'No AI provider configured.' : `${r.added} requirement${r.added === 1 ? '' : 's'} extracted. Review and confirm each one below.` }))}
              disabled={busy === 'extract' || notice.trim().length < 200}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" aria-hidden="true" /> {busy === 'extract' ? 'Extracting…' : 'Extract requirements'}
            </Button>
            <Button asChild variant="ghost" className="gap-1.5">
              <a href={ws.opportunity.officialUrl} target="_blank" rel="noreferrer">Open the official notice <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
            </Button>
          </div>
          <ActionMessage message={message} />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={`Compliance matrix (${ws.requirements.length})`}
          description={unconfirmed ? `${unconfirmed} row${unconfirmed === 1 ? '' : 's'} to confirm against the notice.` : 'Every row is confirmed.'}
          actions={unconfirmed > 0 ? <Button size="sm" variant="secondary" onClick={() => run('all', () => grantsApi.confirmAll(ws.application.id))}>Confirm all</Button> : undefined}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">Requirements from the notice and the template</caption>
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr><th scope="col" className="px-4 py-2 font-medium">Requirement</th><th scope="col" className="px-4 py-2 font-medium">Answered in</th><th scope="col" className="px-4 py-2 font-medium">Status</th><th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ws.requirements.map((req) => <RequirementRow key={req.id} req={req} sections={ws.sections} />)}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="grid gap-3 border-t border-border px-5 py-4 md:grid-cols-[10rem_minmax(0,1fr)_7rem_minmax(0,0.7fr)_auto] md:items-end">
          <Field label="Type">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={selectClass}>
              {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Requirement"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Evaluation plan (20 points)" /></Field>
          <Field label="Points"><Input type="number" min={0} value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} /></Field>
          <Field label="Where in the notice"><Input value={form.sourceRef} onChange={(e) => setForm({ ...form, sourceRef: e.target.value })} placeholder="Section V.1, p. 32" /></Field>
          <Button type="submit" variant="secondary" className="gap-1.5" disabled={!form.label.trim()}><Plus className="h-4 w-4" aria-hidden="true" /> Add</Button>
        </form>
      </Panel>
    </div>
  );
}

// ── Step 2: Write ─────────────────────────────────────────────────────────

function LimitMeter({ section, liveWords, liveChars }: { section: Section; liveWords: number; liveChars: number }) {
  const unit = section.limitType;
  const limit = section.limitValue;
  if (!unit || !limit) return <span className="text-xs text-muted-foreground">{liveWords} words · no limit set</span>;
  const used = unit === 'characters' ? liveChars : unit === 'pages' ? Math.round((liveWords / 500) * 10) / 10 : liveWords;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const over = used > limit;
  return (
    <div className="flex min-w-[12rem] items-center gap-2" aria-live="polite">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className={cn('h-full rounded-full', over ? 'bg-red-400' : pct > 90 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('whitespace-nowrap text-xs tabular-nums', over ? 'text-red-300' : 'text-muted-foreground')}>
        {used} / {limit} {unit}{over ? ' · over' : ''}
      </span>
    </div>
  );
}

function countHtml(html: string) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return { words: text ? text.split(' ').length : 0, chars: text.length };
}

function SectionEditor({ ws, section }: { ws: Workspace; section: Section }) {
  const { busy, message, setMessage, run } = useAction();
  const [draft, setDraft] = useState(section.content);
  const [limitType, setLimitType] = useState(section.limitType ?? '');
  const [limitValue, setLimitValue] = useState(section.limitValue ? String(section.limitValue) : '');
  useEffect(() => {
    setDraft(section.content);
    setLimitType(section.limitType ?? '');
    setLimitValue(section.limitValue ? String(section.limitValue) : '');
  }, [section.id, section.content, section.limitType, section.limitValue]);
  const counts = useMemo(() => countHtml(draft), [draft]);
  const dirty = draft !== section.content;
  const mapped = ws.requirements.filter((r) => r.sectionKey === section.key || (r.kind === 'criterion' && !r.sectionKey));
  const live: Section = { ...section, limitType: (limitType || null) as Section['limitType'], limitValue: limitValue ? Number(limitValue) : null };

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusPill status={section.status} />
              {section.demoContent && <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-xs text-amber-300">Demo scaffold</span>}
              {section.reviewScore != null && <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">Reviewer score {section.reviewScore}</span>}
            </div>
          </div>
          <LimitMeter section={live} liveWords={counts.words} liveChars={counts.chars} />
        </div>
        {section.guidance && <p className="border-b border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">Guidance: </span>{section.guidance}</p>}
        <div className="min-h-[22rem]">
          <RichEditor key={section.id} sectionId={section.id} initialContent={section.content} contentFormat="html" allowMedia={false} label={`${section.title} editor`} readOnly={section.status === 'approved'} onChange={setDraft} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {section.status === 'approved' ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approved by {section.approvedBy}</span>
              <Button size="sm" variant="ghost" onClick={() => run('reopen', () => grantsApi.reopenSection(section.id))}>Reopen to edit</Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => run('save', () => grantsApi.updateSection(section.id, { content: draft }), () => ({ tone: 'ok', text: 'Saved.' }))} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                disabled={busy === 'draft'}
                onClick={() => {
                  if (dirty && !window.confirm('Drafting replaces the unsaved text in this section. Continue?')) return;
                  void run('draft', () => grantsApi.draftSection(section.id), (r) => ({ tone: r.demo ? 'warn' : 'ok', text: r.demo ? r.message ?? 'Demo scaffold added.' : 'Draft added. Fill every [Add: …] placeholder with a sourced fact.' }));
                }}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {busy === 'draft' ? 'Drafting…' : section.content ? 'Improve with AI' : 'Draft with AI'}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy === 'review' || dirty} onClick={() => run('review', () => grantsApi.reviewSection(section.id), (r) => (r.demo ? { tone: 'warn', text: r.message ?? 'Rule checks only.' } : null))}>
                {busy === 'review' ? 'Reviewing…' : 'Review'}
              </Button>
              <Button size="sm" variant="outline" disabled={dirty || busy === 'approve'} onClick={() => run('approve', () => grantsApi.approveSection(section.id), () => ({ tone: 'ok', text: 'Section approved.' }))} className="gap-1.5">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Approve
              </Button>
              {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
            </>
          )}
        </div>
      </Panel>
      <ActionMessage message={message} />
      {message === null && section.reviewNotes.length > 0 && (
        <Panel>
          <PanelHeader title="Review notes" description={section.reviewScore != null ? `Reviewer score: ${section.reviewScore} of 100` : 'Rule-based checks'} />
          <ul className="space-y-2 px-5 py-4">
            {section.reviewNotes.map((n) => <li key={n} className="flex items-start gap-2 text-sm text-muted-foreground"><Circle className="mt-1.5 h-2 w-2 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />{n}</li>)}
          </ul>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="This section must answer" description="Mapped on the Requirements step." />
          {mapped.length ? (
            <ul className="space-y-2 px-5 py-4">
              {mapped.map((r) => <li key={r.id} className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{r.label}</span>{r.points ? ` · ${r.points} points` : ''}{r.detail ? <span className="mt-0.5 block text-xs">{r.detail}</span> : null}</li>)}
            </ul>
          ) : <p className="px-5 py-4 text-sm text-muted-foreground">No requirements mapped yet.</p>}
        </Panel>
        <Panel>
          <PanelHeader title="Limit" description="Use the limit in the notice." />
          <form
            className="flex flex-wrap items-end gap-3 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage(null);
              void run('limit', () => grantsApi.updateSection(section.id, { limitType: (limitType || null) as Section['limitType'], limitValue: limitValue ? Number(limitValue) : null }), () => ({ tone: 'ok', text: 'Limit saved.' }));
            }}
          >
            <Field label="Unit">
              <select value={limitType} onChange={(e) => setLimitType(e.target.value)} className={selectClass}>
                <option value="">No limit</option>
                <option value="words">Words</option>
                <option value="characters">Characters</option>
                <option value="pages">Pages (500 words each)</option>
              </select>
            </Field>
            <Field label="Maximum"><Input type="number" min={1} value={limitValue} onChange={(e) => setLimitValue(e.target.value)} className="w-32" disabled={!limitType} /></Field>
            <Button type="submit" size="sm" variant="secondary">Save limit</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function WriteStep({ ws }: { ws: Workspace }) {
  const [selected, setSelected] = useState(ws.sections[0]?.id ?? '');
  const section = ws.sections.find((s) => s.id === selected) ?? ws.sections[0];
  const approved = ws.sections.filter((s) => s.status === 'approved').length;
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Panel className="h-fit">
        <PanelHeader title="Sections" description={`${approved} of ${ws.sections.length} approved`} />
        <nav aria-label="Application sections">
          <ul className="divide-y divide-border">
            {ws.sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  aria-current={s.id === section?.id ? 'true' : undefined}
                  className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60', s.id === section?.id && 'bg-secondary')}
                >
                  {s.status === 'approved' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" /> : s.limitCheck.over ? <XCircle className="h-4 w-4 shrink-0 text-red-300" aria-hidden="true" /> : <Circle className={cn('h-4 w-4 shrink-0', s.limitCheck.words ? 'text-brand' : 'text-muted-foreground')} aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{s.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{s.limitCheck.words} words{s.limitCheck.limit ? ` · limit ${s.limitCheck.limit} ${s.limitCheck.unit}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </Panel>
      {section ? <SectionEditor ws={ws} section={section} /> : <StateMessage title="No sections" />}
    </div>
  );
}

// ── Step 3: Budget ────────────────────────────────────────────────────────

function BudgetStep({ ws }: { ws: Workspace }) {
  const meta = useGrantMeta();
  const { busy, message, run } = useAction();
  const categories = meta.data?.budgetCategories ?? [];
  const [form, setForm] = useState({ category: 'personnel', description: '', quantity: '1', unitCost: '', matchPercent: '0', justification: '' });
  const [rate, setRate] = useState(String(ws.application.indirectRatePercent));
  useEffect(() => setRate(String(ws.application.indirectRatePercent)), [ws.application.indirectRatePercent]);
  const ceiling = ws.opportunity.awardCeiling;
  const pct = ceiling ? Math.min(100, Math.round((ws.budget.requested / ceiling) * 100)) : null;

  async function add(event: FormEvent) {
    event.preventDefault();
    const ok = await run('add', () => grantsApi.addBudgetLine(ws.application.id, { category: form.category, description: form.description, quantity: Number(form.quantity), unitCost: Number(form.unitCost.replace(/[$,]/g, '')), matchPercent: Number(form.matchPercent), justification: form.justification || null }));
    if (ok) setForm({ ...form, description: '', unitCost: '', justification: '' });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Requested', usd(ws.budget.requested)],
          ['Match', usd(ws.budget.match)],
          ['Indirect', usd(ws.budget.indirect)],
          ['Award ceiling', ceiling ? usd(ceiling) : 'Not stated'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
          </div>
        ))}
      </div>
      {pct != null && (
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true"><div className={cn('h-full rounded-full', ws.budget.requested > (ceiling ?? 0) ? 'bg-red-400' : 'bg-emerald-400')} style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{pct}% of the award ceiling requested</p>
        </div>
      )}
      {ws.budget.issues.length > 0 && <Notice tone="warn" title="Budget issues">{ws.budget.issues.join(' ')}</Notice>}

      <Panel>
        <PanelHeader
          title="Budget lines"
          description="SF-424A categories. Match is the share your organization pays."
          actions={<Button size="sm" variant="secondary" className="gap-1.5" disabled={!ws.budgetLines.length || busy === 'just'} onClick={() => run('just', () => grantsApi.budgetJustification(ws.application.id), () => ({ tone: 'ok', text: 'Budget justification written into its section. Review it on the Write step.' }))}><Wand2 className="h-3.5 w-3.5" aria-hidden="true" /> Write justification</Button>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Budget lines</caption>
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr><th scope="col" className="px-4 py-2 font-medium">Item</th><th scope="col" className="px-4 py-2 font-medium">Qty</th><th scope="col" className="px-4 py-2 font-medium">Unit cost</th><th scope="col" className="px-4 py-2 font-medium">Match %</th><th scope="col" className="px-4 py-2 text-right font-medium">Total</th><th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ws.budgetLines.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No lines yet. Add the first one below.</td></tr>}
              {ws.budgetLines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{line.description}</p>
                    <p className="text-xs text-muted-foreground">{categories.find((c) => c.key === line.category)?.label ?? line.category}</p>
                    <p className={cn('mt-1 text-xs', line.justification ? 'text-muted-foreground' : 'text-amber-300')}>{line.justification || 'Needs a justification'}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{line.quantity}</td>
                  <td className="px-4 py-3 tabular-nums">{usd(line.unitCost)}</td>
                  <td className="px-4 py-3 tabular-nums">{line.matchPercent}%</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">{usd(line.total)}</td>
                  <td className="px-4 py-3 text-right"><Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete ${line.description}`} onClick={() => run('del', () => grantsApi.deleteBudgetLine(line.id))}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="grid gap-3 border-t border-border px-5 py-4 md:grid-cols-6 md:items-end">
          <Field label="Category" className="md:col-span-2">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={selectClass}>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Item" className="md:col-span-4"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Program coordinator, 0.5 FTE" required /></Field>
          <Field label="Quantity"><Input type="number" min={0} step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          <Field label="Unit cost (USD)"><Input inputMode="decimal" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} required /></Field>
          <Field label="Match %"><Input type="number" min={0} max={100} value={form.matchPercent} onChange={(e) => setForm({ ...form, matchPercent: e.target.value })} /></Field>
          <Field label="Justification" className="md:col-span-2"><Input value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} placeholder="Why the project needs it" /></Field>
          <Button type="submit" variant="secondary" className="gap-1.5" disabled={!form.description.trim() || !form.unitCost}><Plus className="h-4 w-4" aria-hidden="true" /> Add line</Button>
        </form>
      </Panel>

      <Panel>
        <PanelHeader title="Indirect costs" description="Applied to requested direct costs. Many agreements use a modified base that excludes items such as equipment: check yours and the notice." />
        <form className="flex flex-wrap items-end gap-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); void run('rate', () => grantsApi.updateApplication(ws.application.id, { indirectRatePercent: Number(rate) }), () => ({ tone: 'ok', text: 'Indirect rate saved.' })); }}>
          <Field label="Indirect rate (%)"><Input type="number" min={0} max={100} step="any" value={rate} onChange={(e) => setRate(e.target.value)} className="w-32" /></Field>
          <Button type="submit" size="sm" variant="secondary">Save rate</Button>
        </form>
      </Panel>
      <ActionMessage message={message} />
    </div>
  );
}

// ── Step 4: Review and package ───────────────────────────────────────────

function PackageStep({ ws, goTo }: { ws: Workspace; goTo: (step: string) => void }) {
  const { busy, message, run } = useAction();
  const [approving, setApproving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const stepFor: Record<string, string> = { eligibility: 'requirements', matrix_confirmed: 'requirements', matrix_covered: 'requirements', sections_written: 'write', limits: 'write', no_demo: 'write', sections_approved: 'write', budget: 'budget' };
  const passed = ws.compliance.checks.filter((c) => c.ok).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel>
        <PanelHeader title="Compliance checks" description={`${passed} of ${ws.compliance.checks.length} pass`} />
        <ul className="divide-y divide-border">
          {ws.compliance.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-3 px-5 py-4">
              {check.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{check.label}<span className="sr-only">{check.ok ? ': passes' : ': needs attention'}</span></p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
              </div>
              {!check.ok && stepFor[check.id] && <Button size="sm" variant="ghost" onClick={() => goTo(stepFor[check.id])}>Fix</Button>}
              {!check.ok && check.id === 'readiness' && <Button size="sm" variant="ghost" asChild><Link href={`/grant-studio/organizations/${ws.applicant.id}`}>Fix</Link></Button>}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="space-y-4">
        <Panel>
          <PanelHeader title="Package" description="A DOCX with every section, the budget, the compliance checklist and the approval record." />
          <div className="space-y-3 px-5 py-4">
            {ws.compliance.readyToExport ? (
              <Notice tone="ok" title="Approved for submission">Export the final package, then submit it through Grants.gov Workspace before the deadline.</Notice>
            ) : ws.compliance.readyForApproval ? (
              <Notice tone="ok" title="Every check passes">The authorized representative can now approve the package.</Notice>
            ) : (
              <Notice tone="info">Download a draft at any time to share with your team. The final package unlocks when every check passes and the authorized representative approves.</Notice>
            )}
            {!ws.compliance.readyToExport && (
              <Button className="w-full" disabled={!ws.compliance.readyForApproval} onClick={() => { setConfirmed(false); setApproving(true); }}>Approve package</Button>
            )}
            {ws.compliance.readyToExport ? (
              <Button asChild className="w-full gap-2">
                <a href={packageUrl(ws.application.id, false)}><Download className="h-4 w-4" aria-hidden="true" /> Download final package</a>
              </Button>
            ) : (
              <Button variant="outline" className="w-full gap-2" disabled>
                <Download className="h-4 w-4" aria-hidden="true" /> Download final package
              </Button>
            )}
            <Button asChild variant="ghost" className="w-full gap-2">
              <a href={packageUrl(ws.application.id, true)}><Download className="h-4 w-4" aria-hidden="true" /> Download draft</a>
            </Button>
            {ws.application.exportedAt && <p className="text-xs text-muted-foreground">Final package last exported {new Date(ws.application.exportedAt).toLocaleString('en-US')}.</p>}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Approval record" />
          <ul className="space-y-2 px-5 py-4 text-xs text-muted-foreground">
            {ws.approvals.length === 0 && <li>None yet.</li>}
            {ws.approvals.map((a) => <li key={a.id}><span className="font-medium text-foreground">{a.scope === 'package' ? 'Package' : a.scope === 'eligibility' ? 'Eligibility' : 'Section'}</span> · {a.role.replace(/_/g, ' ')} · {a.approvedBy} · {new Date(a.createdAt).toLocaleDateString('en-US')}</li>)}
          </ul>
        </Panel>
        <ActionMessage message={message} />
      </div>

      <Dialog open={approving} onOpenChange={setApproving}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve the final package</DialogTitle>
            <DialogDescription>The authorized representative approves what is submitted in the organization’s name. Any later edit reopens approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm text-foreground">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
              <span>I am {ws.applicant.name}’s authorized representative, or I act with their written approval, and I approve this package.</span>
            </label>
            <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setApproving(false)}>Cancel</Button>
              <Button disabled={!confirmed || busy === 'approve'} onClick={async () => { const ok = await run('approve', () => grantsApi.approvePackage(ws.application.id, note), () => ({ tone: 'ok', text: 'Package approved. Download the final package.' })); if (ok) setApproving(false); }}>
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'requirements', label: 'Requirements' },
  { key: 'write', label: 'Write' },
  { key: 'budget', label: 'Budget' },
  { key: 'package', label: 'Review & package' },
];

export default function GrantApplication() {
  const { id } = useParams<{ id: string }>();
  const ws = useWorkspace(id);
  const [step, setStep] = useState('requirements');
  const [, navigate] = useLocation();
  const invalidateAll = useInvalidateGrants();

  if (ws.isLoading) return <LoadingState label="Loading the application…" />;
  if (ws.isError || !ws.data) {
    return (
      <PageShell>
        <StateMessage tone="error" title="Application not found" description="It may have been deleted, or it belongs to another account." action={<Button asChild><Link href="/grant-studio">Back to Grant Studio</Link></Button>} />
      </PageShell>
    );
  }
  const w = ws.data;
  const done: Record<string, boolean> = {
    requirements: w.requirements.length > 0 && w.requirements.every((r) => r.confirmed && r.status !== 'open'),
    write: w.sections.every((s) => s.status === 'approved'),
    budget: w.budgetLines.length > 0 && w.budget.issues.length === 0,
    package: w.compliance.readyToExport,
  };
  const passed = w.compliance.checks.filter((c) => c.ok).length;

  return (
    <PageShell>
      <Link href={`/grant-studio/organizations/${w.applicant.id}`} className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {w.applicant.name}
      </Link>
      <PageHeader
        eyebrow={`${w.templateLabel} · ${w.opportunity.agency ?? 'Funder not recorded'}`}
        title={w.application.title}
        description={`${w.applicant.name} · requesting ${usd(w.budget.requested)}${w.opportunity.number ? ` · ${w.opportunity.number}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DeadlineChip daysLeft={w.opportunity.daysLeft} label={deadlineLabel(w.opportunity)} />
            <StatusPill status={w.application.status} />
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-red-300"
              onClick={async () => {
                if (!window.confirm(`Delete the application "${w.application.title}" with its sections, budget and approvals? This cannot be undone.`)) return;
                await grantsApi.deleteApplication(w.application.id);
                await invalidateAll();
                navigate(`/grant-studio/organizations/${w.applicant.id}`);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
            </Button>
          </div>
        }
      />
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Compliance</span><span className="tabular-nums">{passed} of {w.compliance.checks.length} checks pass</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Compliance checks passing" aria-valuemin={0} aria-valuemax={w.compliance.checks.length} aria-valuenow={passed}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((passed / w.compliance.checks.length) * 100)}%` }} />
        </div>
      </div>
      {w.aiDemo && <div className="mb-6"><Notice tone="warn" title="Demo mode">No AI provider is configured: drafting adds a labelled scaffold, extraction is unavailable and review runs rule checks only. Everything else works.</Notice></div>}
      <Tabs value={step} onValueChange={setStep}>
        <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <TabsTrigger key={s.key} value={s.key} className="gap-2 py-2">
              {done[s.key] ? <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px]" aria-hidden="true">{i + 1}</span>}
              {s.label}
              {done[s.key] && <span className="sr-only">(complete)</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="requirements"><RequirementsStep ws={w} /></TabsContent>
        <TabsContent value="write"><WriteStep ws={w} /></TabsContent>
        <TabsContent value="budget"><BudgetStep ws={w} /></TabsContent>
        <TabsContent value="package"><PackageStep ws={w} goTo={setStep} /></TabsContent>
      </Tabs>
    </PageShell>
  );
}
