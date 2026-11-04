import { useEffect, useState, type FormEvent } from 'react';
import { Check, Circle, Copy, ExternalLink, FileCheck2, Mail, Plus, Trash2, X } from 'lucide-react';
import { Panel, PanelHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { cn } from '@/lib/utils';
import { errorMessage, grantsApi, useInvalidateGrants, type FormatProfile, type LogicModel, type Section, type SupportLetter, type Workspace } from '@/lib/grants';

/** Grants.gov's applicant guidance on attachment names (default rules when the agency sets none). */
export const GRANTS_GOV_ATTACHMENT_FAQ = 'https://www.grants.gov/applicants/applicant-faqs';

function Mark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', ok ? 'text-emerald-300' : 'text-amber-300')}>
      {ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
      <span className="sr-only">{ok ? ': yes' : ': missing'}</span>
    </span>
  );
}

// ── Writing checks (Write step) ───────────────────────────────────────────

export function WritingChecksPanel({ section }: { section: Section }) {
  const checks = section.writingChecks;
  if (!checks || checks.readability.words === 0) return null;
  const { readability: r } = checks;
  return (
    <Panel>
      <PanelHeader
        title="Writing checks"
        description={r.grade !== null ? `Reading grade ${r.grade} · reading ease ${r.readingEase} of 100 · ${r.sentences} sentences` : undefined}
      />
      <div className="space-y-4 px-5 py-4">
        {checks.notes.length === 0 ? (
          <p className="text-sm text-emerald-300">No placeholders, long sentences or weak objectives found.</p>
        ) : (
          <ul className="space-y-1.5">
            {checks.notes.map((n) => <li key={n} className="flex items-start gap-2 text-sm text-muted-foreground"><Circle className="mt-1.5 h-2 w-2 shrink-0 fill-amber-400 text-amber-400" aria-hidden="true" />{n}</li>)}
          </ul>
        )}
        {checks.objectives && checks.objectives.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objectives (SMART check)</h3>
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
              {checks.objectives.map((o, i) => (
                <li key={`${i}-${o.text}`} className="space-y-1.5 px-4 py-3">
                  <p className="text-sm text-foreground">{o.text}</p>
                  <div className="flex flex-wrap gap-3">
                    <Mark ok={o.measurable} label="Measurable" />
                    <Mark ok={o.timeBound} label="Time-bound" />
                    <Mark ok={o.baseline} label="Baseline" />
                  </div>
                  {o.notes.length > 0 && <p className="text-xs text-muted-foreground">{o.notes.join(' ')}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.longSentences.length > 0 && (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer text-foreground">Long sentences ({r.longSentences.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{r.longSentences.map((s) => <li key={s}>{s}</li>)}</ul>
          </details>
        )}
        <p className="text-xs text-muted-foreground">Checks are automatic estimates (Flesch-Kincaid grade, sentence length, objective wording). They help a person review; they are not a score.</p>
      </div>
    </Panel>
  );
}

// ── Logic model (Write step) ──────────────────────────────────────────────

export function isLogicModelSection(section: Section): boolean {
  return section.key === 'logic_model' || /logic model/i.test(section.title);
}

export function LogicModelPanel({ ws, section, dirty }: { ws: Workspace; section: Section; dirty: boolean }) {
  const invalidate = useInvalidateGrants();
  const lm = ws.logicModel;
  const toText = (model: LogicModel) => Object.fromEntries((lm?.columns ?? []).map((c) => [c.key, (model[c.key] ?? []).join('\n')])) as Record<string, string>;
  const [text, setText] = useState<Record<string, string>>(() => toText(lm?.model ?? {}));
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => setText(toText(lm?.model ?? {})), [lm?.model]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lm) return null;

  const model = (): LogicModel => Object.fromEntries(lm.columns.map((c) => [c.key, (text[c.key] ?? '').split('\n').map((l) => l.trim()).filter(Boolean)]));

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setMessage(null);
    try {
      await grantsApi.updateApplication(ws.application.id, { logicModel: model() });
      await invalidate();
      setMessage({ tone: 'ok', text: 'Logic model saved.' });
      return true;
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
      return false;
    }
  }

  async function insert(mode: 'replace' | 'append') {
    if (dirty && !window.confirm('You have unsaved changes in this section. Insert the logic model and discard them?')) return;
    if (!(await save())) return;
    try {
      await grantsApi.insertLogicModel(section.id, mode);
      await invalidate();
      setMessage({ tone: 'ok', text: mode === 'replace' ? 'Logic model placed in the section. Review and approve it.' : 'Logic model added at the end of the section. Review and approve it.' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  const locked = section.status === 'approved';
  return (
    <Panel>
      <PanelHeader title="Logic model builder" description="One item per line. It goes into this section as a heading and a list for each column, which the exported file keeps." />
      <form onSubmit={save} className="space-y-4 px-5 py-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lm.columns.map((c) => (
            <Field key={c.key} label={c.label} hint={c.hint}>
              <Textarea rows={4} value={text[c.key] ?? ''} onChange={(e) => setText({ ...text, [c.key]: e.target.value })} />
            </Field>
          ))}
        </div>
        {lm.gaps.length > 0 && <Notice tone="warn" title="To complete the logic model">{lm.gaps.join(' ')}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary">Save logic model</Button>
          <Button type="button" size="sm" disabled={locked} onClick={() => insert('replace')}>Put it in this section</Button>
          <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => insert('append')}>Add at the end</Button>
          {locked && <span className="text-xs text-muted-foreground">Reopen the section to change it.</span>}
        </div>
        {message && <div role="status"><Notice tone={message.tone}>{message.text}</Notice></div>}
      </form>
    </Panel>
  );
}

// ── Format profile (Format and letters step) ─────────────────────────────

function FormatPanel({ ws }: { ws: Workspace }) {
  const invalidate = useInvalidateGrants();
  const f = ws.format!;
  const toForm = (p: FormatProfile) => ({ font: p.font, sizePt: String(p.sizePt), lineSpacing: String(p.lineSpacing), marginsIn: String(p.marginsIn), pageLimit: p.pageLimit ? String(p.pageLimit) : '', fileName: p.fileName ?? '' });
  const [form, setForm] = useState(() => toForm(f.profile));
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => setForm(toForm(f.profile)), [f.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await grantsApi.updateApplication(ws.application.id, {
        formatProfile: {
          font: form.font,
          sizePt: Number(form.sizePt),
          lineSpacing: Number(form.lineSpacing),
          marginsIn: Number(form.marginsIn),
          pageLimit: form.pageLimit ? Number(form.pageLimit) : null,
          fileName: form.fileName.trim() || null,
        },
      });
      await invalidate();
      setMessage({ tone: 'ok', text: 'Format saved. Page limits and the exported file now follow it.' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function reset() {
    setMessage(null);
    try {
      await grantsApi.updateApplication(ws.application.id, { formatProfile: null });
      await invalidate();
      setMessage({ tone: 'ok', text: 'Back to the default format.' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  const pct = f.pageLimit ? Math.min(100, Math.round((f.estimatedPages / f.pageLimit) * 100)) : 0;
  return (
    <Panel>
      <PanelHeader
        title="Format from the notice"
        icon={<FileCheck2 className="h-4 w-4 text-brand" aria-hidden="true" />}
        description="Copy the font, size, spacing, margins, page limit and file name the notice requires. The exported file uses them."
      />
      <form onSubmit={save} className="space-y-4 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Font">
            <select value={form.font} onChange={(e) => setForm({ ...form, font: e.target.value })} className={selectClass}>
              {f.fonts.map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
          </Field>
          <Field label="Size (pt)"><Input type="number" min={8} max={16} step={0.5} value={form.sizePt} onChange={(e) => setForm({ ...form, sizePt: e.target.value })} /></Field>
          <Field label="Line spacing">
            <select value={form.lineSpacing} onChange={(e) => setForm({ ...form, lineSpacing: e.target.value })} className={selectClass}>
              <option value="1">Single</option>
              <option value="1.15">1.15</option>
              <option value="1.5">1.5</option>
              <option value="2">Double</option>
            </select>
          </Field>
          <Field label="Margins (inches)"><Input type="number" min={0.5} max={2} step={0.25} value={form.marginsIn} onChange={(e) => setForm({ ...form, marginsIn: e.target.value })} /></Field>
          <Field label="Narrative page limit" hint="Leave empty if the notice sets none."><Input type="number" min={1} max={500} value={form.pageLimit} onChange={(e) => setForm({ ...form, pageLimit: e.target.value })} /></Field>
          <Field label="File name" hint="As the notice requires; Grants.gov allows 50 characters by default."><Input value={form.fileName} maxLength={80} onChange={(e) => setForm({ ...form, fileName: e.target.value })} placeholder="Project_Narrative" /></Field>
        </div>
        <div className="rounded-xl border border-border bg-background p-4 text-sm">
          <p className="text-foreground">About {f.wordsPerPage} words per page{f.set ? '' : ' (default: Times New Roman 12 pt, single spaced, 1-inch margins)'}. The narrative is about <span className="font-semibold tabular-nums">{f.estimatedPages}</span> page{f.estimatedPages === 1 ? '' : 's'}{f.pageLimit ? ` of ${f.pageLimit}` : ''}.</p>
          {f.pageLimit && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Pages used" aria-valuemin={0} aria-valuemax={f.pageLimit} aria-valuenow={f.estimatedPages}>
              <div className={cn('h-full rounded-full', f.over ? 'bg-red-400' : pct > 90 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">An estimate from the word count: open the exported file and check the page count before submitting.</p>
          {f.fileNameIssues.map((i) => <p key={i.message} className={cn('mt-2 text-xs', i.blocking ? 'text-red-300' : 'text-amber-300')}>{i.message}</p>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">Save format</Button>
          {f.set && <Button type="button" size="sm" variant="ghost" onClick={reset}>Use the default</Button>}
          <Button asChild size="sm" variant="ghost" className="gap-1.5">
            <a href={GRANTS_GOV_ATTACHMENT_FAQ} target="_blank" rel="noreferrer">Grants.gov file name rules <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens grants.gov in a new tab)</span></a>
          </Button>
        </div>
        {message && <div role="status"><Notice tone={message.tone}>{message.text}</Notice></div>}
      </form>
    </Panel>
  );
}

// ── Letters of support ────────────────────────────────────────────────────

/** A request a person edits and sends themselves. It states no facts beyond what the user entered. */
export function letterRequestText(ws: Workspace, letter: Pick<SupportLetter, 'name' | 'organization' | 'purpose' | 'dueOn'>): string {
  const funder = ws.opportunity.agency ?? 'the funder';
  return [
    `Dear ${letter.name},`,
    '',
    `${ws.applicant.name} is applying to ${funder} for "${ws.opportunity.title}"${ws.opportunity.number ? ` (${ws.opportunity.number})` : ''}. Would you provide a letter of support${letter.organization ? ` on behalf of ${letter.organization}` : ''}?`,
    '',
    letter.purpose ? `It would help most if the letter describes: ${letter.purpose}.` : 'It would help most if the letter describes [Add: what you would like the letter to cover].',
    'Please address it to the review committee, put it on letterhead, sign and date it, and send it as a PDF.',
    '',
    letter.dueOn ? `We need it by ${letter.dueOn}.` : 'We need it by [Add: date].',
    '',
    'Thank you,',
    '[Add: your name and title]',
  ].join('\n');
}

function LetterRow({ ws, letter }: { ws: Workspace; letter: SupportLetter }) {
  const invalidate = useInvalidateGrants();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await invalidate();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(letterRequestText(ws, letter));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  const req = ws.requirements.find((r) => r.id === letter.requirementId);
  const overdue = letter.dueOn && letter.status !== 'received' && letter.status !== 'declined' && letter.dueOn < new Date().toISOString().slice(0, 10);
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{letter.name}{letter.organization ? <span className="font-normal text-muted-foreground"> · {letter.organization}</span> : null}</p>
          {letter.purpose && <p className="mt-0.5 text-sm text-muted-foreground">{letter.purpose}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {[letter.requestedOn && `Requested ${letter.requestedOn}`, letter.dueOn && `due ${letter.dueOn}`, letter.receivedOn && `received ${letter.receivedOn}`, req && `answers “${req.label}”`].filter(Boolean).join(' · ') || 'Not requested yet'}
            {overdue && <span className="ml-1 text-red-300">· overdue</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={`letter-status-${letter.id}`}>Status for {letter.name}</label>
          <select id={`letter-status-${letter.id}`} value={letter.status} onChange={(e) => act(() => grantsApi.updateLetter(letter.id, { status: e.target.value as SupportLetter['status'] }))} className={cn(selectClass, 'h-8 w-36')}>
            {(ws.letterStatuses ?? []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={copy}><Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy request'}</Button>
          {letter.email && <Button asChild size="sm" variant="ghost" className="gap-1.5"><a href={`mailto:${encodeURIComponent(letter.email)}?subject=${encodeURIComponent(`Letter of support: ${ws.opportunity.title}`)}&body=${encodeURIComponent(letterRequestText(ws, letter))}`}><Mail className="h-3.5 w-3.5" aria-hidden="true" /> Email</a></Button>}
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${letter.name}`} onClick={() => { if (window.confirm(`Stop tracking the letter from ${letter.name}?`)) void act(() => grantsApi.deleteLetter(letter.id)); }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  );
}

function LettersPanel({ ws }: { ws: Workspace }) {
  const invalidate = useInvalidateGrants();
  const empty = { name: '', organization: '', purpose: '', email: '', dueOn: '', requirementId: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const letters = ws.letters ?? [];
  const attachmentReqs = ws.requirements.filter((r) => r.kind === 'attachment' || /letter|support|commitment|partner/i.test(r.label));

  async function add(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await grantsApi.addLetter(ws.application.id, {
        name: form.name,
        organization: form.organization || null,
        purpose: form.purpose || null,
        email: form.email || null,
        dueOn: form.dueOn || null,
        requirementId: form.requirementId || null,
      });
      await invalidate();
      setForm(empty);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const received = letters.filter((l) => l.status === 'received').length;
  return (
    <Panel>
      <PanelHeader title="Letters of support" description={letters.length ? `${received} of ${letters.length} received. The package check waits until each one is received or declined.` : 'Track who you asked, when it is due and whether it arrived.'} />
      {letters.length > 0 && <ul className="divide-y divide-border border-b border-border">{letters.map((l) => <LetterRow key={l.id} ws={ws} letter={l} />)}</ul>}
      <form onSubmit={add} className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Person"><Input value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Organization"><Input value={form.organization} maxLength={200} onChange={(e) => setForm({ ...form, organization: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email} maxLength={200} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="What the letter should cover" className="sm:col-span-2"><Input value={form.purpose} maxLength={500} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="For example: hosts the after-school sessions two days a week" /></Field>
        <Field label="Due"><Input type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></Field>
        {attachmentReqs.length > 0 && (
          <Field label="Answers requirement" className="sm:col-span-2">
            <select value={form.requirementId} onChange={(e) => setForm({ ...form, requirementId: e.target.value })} className={selectClass}>
              <option value="">None</option>
              {attachmentReqs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
        )}
        <div className="flex items-end"><Button type="submit" size="sm" className="gap-1.5" disabled={!form.name.trim()}><Plus className="h-4 w-4" aria-hidden="true" /> Add letter</Button></div>
        {error && <div className="sm:col-span-2 lg:col-span-3"><Notice tone="error">{error}</Notice></div>}
      </form>
      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Copy request gives a template to edit and send yourself. Grant Studio does not send email.</p>
    </Panel>
  );
}

export function ToolkitStep({ ws }: { ws: Workspace }) {
  if (!ws.format) return null;
  return (
    <div className="space-y-6">
      <FormatPanel ws={ws} />
      <LettersPanel ws={ws} />
    </div>
  );
}

export function toolkitDone(ws: Workspace): boolean {
  if (!ws.format) return false;
  const lettersOpen = (ws.letters ?? []).some((l) => l.status === 'to_request' || l.status === 'requested');
  return ws.format.set && !ws.format.over && !ws.format.fileNameIssues.some((i) => i.blocking) && !lettersOpen;
}
