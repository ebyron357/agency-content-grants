import { useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, FileUp, Link2, Pencil, RefreshCw, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { Panel, PanelHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePermissions } from '@/lib/account';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { cn } from '@/lib/utils';
import { errorMessage, followJob, grantsApi, isPendingJob, noticeFileUrl, useInvalidateGrants, type AiJob, type GrantNotice, type PendingJob, type Requirement, type Workspace } from '@/lib/grants';
/**
 * Attach the funding notice PDF, follow it being read, and review the rows it
 * proposes: each cites its page and quotes the notice; a person confirms,
 * edits or rejects every one. Nothing here confirms on anyone's behalf.
 */

export const KIND_LABELS: Record<string, string> = {
  section: 'Section',
  criterion: 'Review criterion',
  attachment: 'Attachment',
  form: 'Form',
  eligibility: 'Eligibility',
  formatting: 'Formatting',
  deadline: 'Deadline',
};

const STATUS_TEXT: Record<GrantNotice['status'], string> = {
  queued: 'Waiting to start',
  reading: 'Reading the pages',
  extracting: 'Proposing the checklist',
  ready: 'Read',
  failed: 'Could not be read',
};

/** What the progress line says while the notice is being read. */
export function noticeProgressText(notice: GrantNotice | null | undefined, job: AiJob | undefined): string {
  const p = job?.progress;
  if (p?.stage === 'downloading') return 'Downloading the notice from the link…';
  if (p?.stage === 'reading' && p.page && p.pages) return `Reading page ${p.page} of ${p.pages}…`;
  if (p?.stage === 'checklist' && p.chunk && p.chunks) return `Proposing the checklist (part ${p.chunk} of ${p.chunks})…`;
  if (p?.stage === 'checklist') return `Proposing the checklist from ${p.pages ?? notice?.pagesRead ?? 'the'} pages…`;
  if (job?.status === 'queued' && job.attempts > 0) return `The first attempt failed (${job.lastError ?? 'error'}); trying again shortly.`;
  return notice ? `${STATUS_TEXT[notice.status]}…` : 'Starting…';
}

/** Where a row came from, in words. */
export function provenanceText(req: Requirement): string {
  if (req.origin === 'notice') return req.extractedBy === 'demo_rules' ? 'Proposed by pattern matching (demo, no AI)' : `Proposed by AI${req.extractedBy?.startsWith('ai:') ? ` (${req.extractedBy.slice(3)})` : ''}`;
  if (req.origin === 'extracted') return 'Extracted by AI from pasted text';
  if (req.origin === 'manual') return 'Added by a person';
  return 'From the template';
}

function useRun() {
  const invalidate = useInvalidateGrants();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  async function run<T>(key: string, fn: () => Promise<T | PendingJob>, ok?: (r: T) => { tone: 'ok' | 'warn'; text: string } | null): Promise<T | undefined> {
    setBusy(key);
    setMessage(null);
    try {
      let result = await fn();
      if (isPendingJob(result)) {
        await invalidate();
        setMessage({ tone: 'ok', text: 'Reading the notice in the background. You can keep working; the checklist appears here when it is done.' });
        await followJob(result.jobId);
        await invalidate();
        setMessage({ tone: 'ok', text: 'The notice has been read. Review each proposed row below.' });
        return undefined;
      }
      await invalidate();
      const next = ok?.(result as T);
      if (next) setMessage(next);
      return result as T;
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  return { busy, message, setMessage, run };
}

function Message({ message }: { message: { tone: 'ok' | 'warn' | 'error'; text: string } | null }) {
  if (!message) return <span role="status" className="sr-only" />;
  return <div role="status"><Notice tone={message.tone}>{message.text}</Notice></div>;
}

/** The notice's own text for one page, to check a citation against. */
function PageDialog({ ws, page, quote, onClose }: { ws: Workspace; page: number | null; quote: string | null; onClose: () => void }) {
  const [state, setState] = useState<{ page: number; text: string | null; error: string | null } | null>(null);
  if (page && state?.page !== page) {
    setState({ page, text: null, error: null });
    grantsApi.noticePage(ws.application.id, page).then((r) => setState({ page, text: r.text, error: null }), (err) => setState({ page, text: null, error: errorMessage(err) }));
  }
  const text = state?.text ?? '';
  const at = quote ? text.replace(/\s+/g, ' ').toLowerCase().indexOf(quote.replace(/\s+/g, ' ').toLowerCase()) : -1;
  const flat = text.replace(/\s+/g, ' ');
  return (
    <Dialog open={page != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Notice page {page}</DialogTitle>
          <DialogDescription>The text read from the PDF. Check the requirement against it, or open the PDF itself.</DialogDescription>
        </DialogHeader>
        {state?.error && <Notice tone="error">{state.error}</Notice>}
        {!state?.text && !state?.error && <p role="status" className="text-sm text-muted-foreground">Loading the page…</p>}
        {state?.text != null && (
          <p className="whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
            {at >= 0 && quote ? (
              <>
                {flat.slice(0, at)}
                <mark className="rounded bg-brand/20 px-0.5 text-foreground">{flat.slice(at, at + quote.replace(/\s+/g, ' ').length)}</mark>
                {flat.slice(at + quote.replace(/\s+/g, ' ').length)}
              </>
            ) : (
              text || '(No text on this page.)'
            )}
          </p>
        )}
        {ws.notice?.hasFile && (
          <Button asChild variant="ghost" className="gap-1.5 self-start">
            <a href={`${noticeFileUrl(ws.application.id)}#page=${page}`} target="_blank" rel="noreferrer">Open the PDF at page {page} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditRow({ req, onDone }: { req: Requirement; onDone: () => void }) {
  const { busy, message, run } = useRun();
  const [form, setForm] = useState({ kind: req.kind, label: req.label, detail: req.detail ?? '', points: req.points != null ? String(req.points) : '' });
  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await run('save', () => grantsApi.updateRequirement(req.id, { kind: form.kind, label: form.label, detail: form.detail || null, points: form.points ? Number(form.points) : null }));
    if (ok) onDone();
  }
  return (
    <form onSubmit={save} className="mt-3 grid gap-3 rounded-xl border border-border bg-background p-3 md:grid-cols-[10rem_minmax(0,1fr)_6rem]">
      <Field label="Type">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={selectClass}>
          {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Requirement"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
      <Field label="Points"><Input type="number" min={0} value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} /></Field>
      <Field label="Rule, in the notice's terms" className="md:col-span-3"><Textarea rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} /></Field>
      <div className="flex flex-wrap items-center gap-2 md:col-span-3">
        <Button type="submit" size="sm" disabled={!form.label.trim() || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <Message message={message} />
      </div>
    </form>
  );
}

function ProposalRow({ req, canWrite, onShowPage }: { req: Requirement; canWrite: boolean; onShowPage: (page: number, quote: string | null) => void }) {
  const { busy, message, run } = useRun();
  const [editing, setEditing] = useState(false);
  const rejected = Boolean(req.rejectedAt);
  return (
    <li className={cn('px-5 py-4', !req.confirmed && !rejected && 'bg-amber-400/[0.04]')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium text-foreground', rejected && 'line-through decoration-muted-foreground')}>{req.label}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {KIND_LABELS[req.kind] ?? req.kind}
            {req.points ? ` · ${req.points} points` : ''}
            {' · '}
            {provenanceText(req)}
          </p>
          {req.quote && (
            <blockquote className="mt-2 border-l-2 border-brand/50 pl-3 text-xs leading-relaxed text-muted-foreground">
              “{req.quote}”
            </blockquote>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {req.page != null && (
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-brand" onClick={() => onShowPage(req.page!, req.quote ?? null)} aria-label={`Show notice page ${req.page} for ${req.label}`}>
                Notice p. {req.page}
              </Button>
            )}
            {req.confirmed && <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed by {req.confirmedBy ?? 'a person'}</span>}
            {rejected && <span className="text-muted-foreground">Rejected by {req.rejectedBy ?? 'a person'}</span>}
            {!req.confirmed && !rejected && <span className="text-amber-300">Proposed: needs a person to confirm it</span>}
          </div>
        </div>
        {canWrite && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            {rejected ? (
              <Button size="sm" variant="ghost" className="gap-1" disabled={busy === 'restore'} onClick={() => run('restore', () => grantsApi.restoreRequirement(req.id))} aria-label={`Restore ${req.label}`}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore
              </Button>
            ) : (
              <>
                <Button size="sm" variant={req.confirmed ? 'ghost' : 'secondary'} className="gap-1" disabled={busy === 'confirm'} onClick={() => run('confirm', () => grantsApi.updateRequirement(req.id, { confirmed: !req.confirmed }))} aria-label={req.confirmed ? `Withdraw confirmation of ${req.label}` : `Confirm ${req.label}`}>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> {req.confirmed ? 'Unconfirm' : 'Confirm'}
                </Button>
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-label={`Edit ${req.label}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                </Button>
                <Button size="sm" variant="ghost" className="gap-1 text-red-300" disabled={busy === 'reject'} onClick={() => run('reject', () => grantsApi.rejectRequirement(req.id))} aria-label={`Reject ${req.label}`}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {editing && <EditRow req={req} onDone={() => setEditing(false)} />}
      <Message message={message} />
    </li>
  );
}

export function NoticePanel({ ws }: { ws: Workspace }) {
  const { can } = usePermissions();
  const canWrite = can('grants.write');
  const { busy, message, setMessage, run } = useRun();
  const fileInput = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  const [shown, setShown] = useState<{ page: number; quote: string | null } | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const notice = ws.notice ?? null;
  const job = (ws.aiJobs ?? []).find((j) => j.kind === 'grant_notice_checklist');
  const working = Boolean(job) || busy === 'upload' || busy === 'link' || busy === 'rerun';
  const proposals = ws.requirements.filter((r) => r.origin === 'notice' && r.noticeId === notice?.id);
  const rejected = (ws.rejectedRequirements ?? []).filter((r) => r.origin === 'notice');
  const maxMb = notice?.limits.maxMegabytes ?? 25;
  const maxPages = notice?.limits.maxPages ?? 200;
  const replaceConfirm = () => !notice || window.confirm('Attaching another notice replaces this one and removes its proposed rows that nobody has confirmed or rejected. Continue?');

  function onFile(file: File | undefined) {
    if (!file) return;
    if (fileInput.current) fileInput.current.value = '';
    if (file.type && file.type !== 'application/pdf') return setMessage({ tone: 'error', text: 'Choose a PDF file.' });
    if (file.size > maxMb * 1024 * 1024) return setMessage({ tone: 'error', text: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${maxMb} MB.` });
    if (!replaceConfirm()) return;
    void run('upload', () => grantsApi.attachNoticeFile(ws.application.id, file), () => ({ tone: 'ok', text: 'The notice has been read. Review each proposed row below.' }));
  }

  return (
    <Panel>
      <PanelHeader
        title="Notice PDF"
        description={`Attach the funding notice (NOFO, RFA or solicitation) as a PDF, up to ${maxMb} MB and ${maxPages} pages. Grant Studio reads it page by page and proposes requirement rows. Each row cites its page and quotes the notice; you confirm, edit or reject every one.`}
        icon={<FileUp className="h-4 w-4 text-brand" aria-hidden="true" />}
      />
      {working && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 border-b border-border bg-brand/5 px-5 py-2.5 text-xs text-foreground">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-brand" aria-hidden="true" />
          <span>{noticeProgressText(notice, job)} This updates by itself.</span>
        </div>
      )}
      <div className="space-y-4 px-5 py-4">
        {notice && (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{notice.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {STATUS_TEXT[notice.status]}
                {notice.pagesRead ? ` · ${notice.pagesRead}${notice.pageCount && notice.pageCount !== notice.pagesRead ? ` of ${notice.pageCount}` : ''} pages` : ''}
                {notice.extractor ? ` · text by ${notice.extractor === 'docling' ? 'Docling' : 'pdf.js'}` : ''}
                {notice.origin === 'link' ? ' · from a link' : ''}
                {` · attached by ${notice.uploadedBy}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {notice.hasFile && <Button asChild size="sm" variant="ghost" className="gap-1"><a href={noticeFileUrl(ws.application.id)} target="_blank" rel="noreferrer">Open PDF <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a></Button>}
              {canWrite && <Button size="sm" variant="ghost" className="gap-1" disabled={working} onClick={() => run('rerun', () => grantsApi.rerunNotice(ws.application.id), () => ({ tone: 'ok', text: 'Read again. Rows you confirmed or rejected were kept.' }))}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Read again</Button>}
              {canWrite && <Button size="sm" variant="ghost" className="gap-1 text-red-300" disabled={working} onClick={() => { if (window.confirm('Remove the notice? Its proposed rows that nobody has confirmed or rejected are removed too; confirmed rows stay.')) void run('remove', () => grantsApi.removeNotice(ws.application.id), () => ({ tone: 'ok', text: 'Notice removed.' })); }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove</Button>}
            </div>
          </div>
        )}
        {notice?.status === 'failed' && notice.error && <Notice tone="error" title="The notice could not be read">{notice.error}</Notice>}
        {notice?.status === 'ready' && notice.checklistDemo && <Notice tone="warn" title="Demo: no AI provider is configured">{notice.error ?? 'These rows were found by pattern matching, not by AI.'}</Notice>}
        {notice?.status === 'ready' && !notice.checklistDemo && notice.error && <Notice tone="warn">{notice.error}</Notice>}
        {notice?.status === 'ready' && notice.dropped > 0 && <p className="text-xs text-muted-foreground">{notice.dropped} proposed row{notice.dropped === 1 ? ' was' : 's were'} left out because {notice.dropped === 1 ? 'it' : 'they'} did not cite a page whose text holds the quoted words.</p>}
        {notice?.extractorNote && <p className="text-xs text-muted-foreground">{notice.extractorNote}</p>}

        {canWrite ? (
          <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInput} id={`notice-file-${ws.application.id}`} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-label="Notice PDF file" onChange={(e) => onFile(e.target.files?.[0])} disabled={working} />
              <Button type="button" className="gap-2" disabled={working} onClick={() => fileInput.current?.click()}>
                <FileUp className="h-4 w-4" aria-hidden="true" /> {notice ? 'Attach another PDF' : 'Attach notice PDF'}
              </Button>
              <Button type="button" variant="secondary" className="gap-2" disabled={working} onClick={() => replaceConfirm() && void run('link', () => grantsApi.attachNoticeLink(ws.application.id, { useOfficialLink: true }), () => ({ tone: 'ok', text: 'Fetched and read. Review each proposed row below.' }))}>
                <Link2 className="h-4 w-4" aria-hidden="true" /> Fetch from the official link
              </Button>
            </div>
            <form
              className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (!link.trim() || !replaceConfirm()) return;
                void run('link', () => grantsApi.attachNoticeLink(ws.application.id, { url: link.trim() }), () => ({ tone: 'ok', text: 'Fetched and read. Review each proposed row below.' }));
              }}
            >
              <Field label="Or a link to the notice PDF" className="flex-1"><Input type="url" inputMode="url" placeholder="https://…/notice.pdf" value={link} onChange={(e) => setLink(e.target.value)} disabled={working} /></Field>
              <Button type="submit" variant="ghost" disabled={working || !link.trim().startsWith('https://')}>Fetch</Button>
            </form>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A writer, an owner or an admin attaches the notice and confirms its rows.</p>
        )}
        <p className="text-xs text-muted-foreground">The official link is often a listing page rather than the PDF; if so, download the notice there and attach it. Scanned notices without a text layer cannot be read yet (no OCR).</p>
        <Message message={message} />
      </div>

      {notice && (proposals.length > 0 || rejected.length > 0) && (
        <div className="border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <h3 className="text-sm font-semibold text-foreground">Checklist from the notice</h3>
            <p className="text-xs text-muted-foreground tabular-nums">
              {notice.counts.proposed} to review · {notice.counts.confirmed} confirmed · {notice.counts.rejected} rejected
            </p>
          </div>
          <ul className="divide-y divide-border border-t border-border" aria-label="Requirements proposed from the notice">
            {proposals.map((r) => <ProposalRow key={r.id} req={r} canWrite={canWrite} onShowPage={(page, quote) => setShown({ page, quote })} />)}
          </ul>
          {rejected.length > 0 && (
            <div className="border-t border-border px-5 py-3">
              <Button size="sm" variant="ghost" aria-expanded={showRejected} onClick={() => setShowRejected((v) => !v)}>{showRejected ? 'Hide' : 'Show'} rejected rows ({rejected.length})</Button>
              {showRejected && (
                <ul className="mt-2 divide-y divide-border" aria-label="Rejected rows">
                  {rejected.map((r) => <ProposalRow key={r.id} req={r} canWrite={canWrite} onShowPage={(page, quote) => setShown({ page, quote })} />)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <PageDialog ws={ws} page={shown?.page ?? null} quote={shown?.quote ?? null} onClose={() => setShown(null)} />
    </Panel>
  );
}
