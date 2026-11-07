import { useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Panel, PanelHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Notice, selectClass } from '@/components/grants/GrantUi';
import { errorMessage, grantsApi, useInvalidateGrants, type ClaimFlag, type ClaimKind, type Fact, type Section } from '@/lib/grants';

/**
 * The unsupported-claim check on one section (docs/GRANT_STUDIO.md). Each open
 * flag shows the sentence with the claim marked and the reason it was flagged.
 * A person links a confirmed fact, edits the text, or dismisses the flag with a
 * reason; the server refuses approval while any flag is open.
 */

const KIND_LABELS: Record<ClaimKind, string> = { number: 'Number', date: 'Date', outcome: 'Result', partner: 'Named partner', credential: 'Credential' };

const RESOLUTION_TEXT: Record<NonNullable<ClaimFlag['resolution']>, string> = {
  linked: 'Linked to a confirmed fact',
  dismissed: 'Dismissed with a reason',
  edited: 'Taken out of the text',
  now_supported: 'Now backed by a confirmed record',
};

/** The sentence with the claim marked, so it can be found in the editor. */
function Marked({ sentence, claim }: { sentence: string; claim: string }) {
  const at = sentence.toLowerCase().indexOf(claim.toLowerCase());
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <mark className="rounded bg-amber-400/20 px-0.5 text-amber-100">{sentence.slice(at, at + claim.length)}</mark>
      {sentence.slice(at + claim.length)}
    </>
  );
}

function FlagRow({ flag, facts, canResolve, locked, applicantId }: { flag: ClaimFlag; facts: Fact[]; canResolve: boolean; locked: boolean; applicantId: string }) {
  const invalidate = useInvalidateGrants();
  const [mode, setMode] = useState<'none' | 'link' | 'dismiss'>('none');
  const [factId, setFactId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = flag.factId ? facts.find((f) => f.id === flag.factId) : undefined;
  const idBase = `claim-${flag.id}`;

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await invalidate();
      setMode('none');
      setReason('');
      setFactId('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {flag.status === 'open' ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />}
        <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-foreground">{KIND_LABELS[flag.kind] ?? flag.kind}</span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{flag.method}</span>
        {flag.status === 'resolved' && flag.resolution && <span className="text-xs text-emerald-300">{RESOLUTION_TEXT[flag.resolution]}{flag.resolvedBy ? ` · ${flag.resolvedBy}` : ''}</span>}
      </div>
      <blockquote className="border-l-2 border-amber-400/40 pl-3 text-sm leading-relaxed text-foreground">
        <Marked sentence={flag.sentence} claim={flag.claim} />
      </blockquote>
      <p className="text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Why it is flagged: </span>{flag.reason}</p>
      {flag.resolution === 'linked' && <p className="text-xs text-muted-foreground">Fact: {linked ? `${linked.label}: ${linked.body}` : 'a fact from the library'}</p>}
      {flag.resolution === 'dismissed' && flag.dismissReason && <p className="text-xs text-muted-foreground">Reason recorded: {flag.dismissReason}</p>}

      {flag.status === 'open' && canResolve && !locked && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={mode === 'link' ? 'secondary' : 'outline'} aria-expanded={mode === 'link'} aria-controls={`${idBase}-link`} onClick={() => setMode(mode === 'link' ? 'none' : 'link')}>Link a fact</Button>
            <Button size="sm" variant={mode === 'dismiss' ? 'secondary' : 'ghost'} aria-expanded={mode === 'dismiss'} aria-controls={`${idBase}-dismiss`} onClick={() => setMode(mode === 'dismiss' ? 'none' : 'dismiss')}>Dismiss with a reason</Button>
            <span className="self-center text-xs text-muted-foreground">Or edit the text above: the flag closes when the claim is gone.</span>
          </div>
          {mode === 'link' && (
            <form
              id={`${idBase}-link`}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (factId) void act(() => grantsApi.resolveClaim(flag.id, { action: 'link', factId }));
              }}
            >
              {facts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No confirmed facts yet.{' '}
                  <Link href={`/grant-studio/organizations/${applicantId}`} className="font-medium text-brand hover:underline">Add and confirm one in the fact library</Link>, then link it here.
                </p>
              ) : (
                <>
                  <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-medium text-foreground">
                    Confirmed fact that backs this claim
                    <select className={selectClass} value={factId} onChange={(e) => setFactId(e.target.value)} required>
                      <option value="">Choose a fact</option>
                      {facts.map((f) => <option key={f.id} value={f.id}>{`${f.label}: ${f.body}`.slice(0, 140)}</option>)}
                    </select>
                  </label>
                  <Button type="submit" size="sm" disabled={!factId || busy}>{busy ? 'Linking…' : 'Link'}</Button>
                </>
              )}
            </form>
          )}
          {mode === 'dismiss' && (
            <form
              id={`${idBase}-dismiss`}
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => grantsApi.resolveClaim(flag.id, { action: 'dismiss', reason }));
              }}
            >
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Why this claim needs no fact or source (kept with the application)
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} required />
              </label>
              <Button type="submit" size="sm" variant="secondary" disabled={reason.trim().length < 10 || busy}>{busy ? 'Saving…' : 'Dismiss'}</Button>
            </form>
          )}
        </div>
      )}
      {flag.status === 'resolved' && (flag.resolution === 'linked' || flag.resolution === 'dismissed') && canResolve && !locked && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => grantsApi.reopenClaim(flag.id))}>Reopen</Button>
      )}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </li>
  );
}

export function ClaimFlagsPanel({ section, facts, canResolve, dirty, aiDemo, applicantId }: { section: Section; facts: Fact[]; canResolve: boolean; dirty: boolean; aiDemo: boolean; applicantId: string }) {
  const invalidate = useInvalidateGrants();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claims = section.claims;
  if (!claims) return null;
  const open = claims.flags.filter((f) => f.status === 'open');
  const resolved = claims.flags.filter((f) => f.status !== 'open');
  const locked = section.status === 'approved';
  const empty = !section.content.replace(/<[^>]*>/g, '').trim();

  async function recheck() {
    setBusy(true);
    setError(null);
    try {
      await grantsApi.checkClaims(section.id);
      await invalidate();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const methodLine = aiDemo || !claims.aiCheckedAt
    ? 'Rule check (no AI): numbers, dates, results, named partners and credentials are matched literally against confirmed facts, this application’s records and sources cited in the sentence. A match is a prompt to check, not a verdict.'
    : `Rule check (no AI), plus an AI check by ${claims.aiProvider ?? 'the AI provider'}${claims.aiCurrent ? '' : ' on an earlier version of the text (run Review again)'}. The AI can add flags, never remove them.`;

  return (
    <Panel>
      <PanelHeader
        title={open.length ? `${open.length} claim${open.length === 1 ? '' : 's'} to back up` : 'Claims check'}
        description={methodLine}
        actions={canResolve && !locked ? (
          <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy || dirty} onClick={recheck}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? 'Checking…' : 'Check again'}
          </Button>
        ) : undefined}
      />
      {dirty && <p className="border-b border-border px-5 py-2 text-xs text-amber-300">Save to check the latest text.</p>}
      {error && <div className="px-5 py-3"><Notice tone="error">{error}</Notice></div>}
      {empty ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">Nothing to check yet. Write or draft the section and save it.</p>
      ) : open.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          {claims.flags.length ? 'Every flagged claim is resolved.' : 'No unsupported claims found.'}
          {claims.checkedAt ? ` Checked ${new Date(claims.checkedAt).toLocaleString('en-US')}.` : ''}
        </p>
      ) : (
        <>
          <p className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
            {locked ? 'Reopen the section to resolve these.' : 'The section cannot be approved until each one is linked to a confirmed fact, edited out, or dismissed with a reason.'}
          </p>
          <ul className="divide-y divide-border" aria-label="Open claim flags">
            {open.map((f) => <FlagRow key={f.id} flag={f} facts={facts} canResolve={canResolve} locked={locked} applicantId={applicantId} />)}
          </ul>
        </>
      )}
      {resolved.length > 0 && (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">Resolved ({resolved.length})</summary>
          <ul className="divide-y divide-border" aria-label="Resolved claim flags">
            {resolved.map((f) => <FlagRow key={f.id} flag={f} facts={facts} canResolve={canResolve} locked={locked} applicantId={applicantId} />)}
          </ul>
        </details>
      )}
    </Panel>
  );
}
