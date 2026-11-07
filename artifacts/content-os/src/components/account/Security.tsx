import { useEffect, useMemo, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { errorMessage } from '@/lib/grants';
import { accountApi, auditCsvUrl, useInvalidateAccount, useSecurity, useSessions, type AuditEntry, type AuditPage } from '@/lib/account';

/**
 * A member's own security (two-factor, recovery codes, signed-in browsers) and
 * the workspace audit log. The server enforces every rule shown here.
 */

const codeInputProps = { inputMode: 'numeric' as const, autoComplete: 'one-time-code', maxLength: 7, placeholder: '123456', className: 'font-mono tracking-widest' };

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Shows recovery codes once, with copy and download. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setSaved(true);
    } catch {
      setCopied(false);
    }
  }
  function download() {
    const blob = new Blob([`GrantCrest recovery codes\nEach code works once. Keep them somewhere safe.\n\n${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grantcrest-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }
  return (
    <div className="space-y-3">
      <Notice tone="warn" title="Save your recovery codes now">
        If you lose your phone, each code signs you in once. They are shown only this time.
      </Notice>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-background p-4 font-mono text-sm text-foreground sm:grid-cols-5">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}{copied ? 'Copied' : 'Copy codes'}</Button>
        <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={download}><Download className="h-3.5 w-3.5" aria-hidden="true" /> Download</Button>
        <Button type="button" size="sm" disabled={!saved} onClick={onDone}>I have saved them</Button>
      </div>
      {!saved && <p className="text-xs text-muted-foreground">Copy or download the codes to continue.</p>}
    </div>
  );
}

/** Scan, confirm with a code, then save recovery codes. Used in settings and when a workspace requires two-factor. */
export function TwoFactorSetup({ onEnabled, onCancel }: { onEnabled: () => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function start() {
    setError('');
    setBusy(true);
    try {
      const s = await accountApi.mfaSetup();
      setSetup(s);
      // Drawn in the browser, so the secret never goes to a third-party service.
      setQr(await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 192, errorCorrectionLevel: 'M' }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void start();
  }, []);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await accountApi.mfaEnable(code.replace(/\s/g, ''));
      setCodes(result.recoveryCodes);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setCode('');
      if (/expired/i.test(message)) void start();
    } finally {
      setBusy(false);
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={onEnabled} />;
  if (!setup) return error ? <Notice tone="error">{error}</Notice> : <LoadingState label="Preparing two-factor setup…" />;
  return (
    <form onSubmit={confirm} className="space-y-4">
      <ol className="space-y-4 text-sm text-muted-foreground">
        <li>
          <p className="font-medium text-foreground">Scan this with your authenticator app</p>
          <p className="mt-1">For example 1Password, Google Authenticator, Microsoft Authenticator or Authy.</p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
            {qr && <img src={qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded-xl bg-white p-2" />}
            <div className="min-w-0">
              <p className="text-xs">Can't scan? Enter this key:</p>
              <p className="mt-1 break-all font-mono text-sm text-foreground" aria-label="Setup key">{setup.secret}</p>
            </div>
          </div>
        </li>
        <li>
          <Field label="Enter the 6-digit code it shows">
            <Input value={code} onChange={(e) => setCode(e.target.value)} {...codeInputProps} required />
          </Field>
        </li>
      </ol>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>{busy ? 'Checking…' : 'Turn on two-factor'}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function DisableForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await accountApi.mfaDisable(password, code.trim());
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
      <Field label="Code or recovery code"><Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="font-mono" required /></Field>
      <Button type="submit" variant="secondary" disabled={busy || !password || !code.trim()}>Turn off</Button>
      {error && <div className="sm:col-span-3"><Notice tone="error">{error}</Notice></div>}
    </form>
  );
}

function NewCodesForm({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      onCodes((await accountApi.newRecoveryCodes(code.replace(/\s/g, ''))).recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field label="Current code"><Input value={code} onChange={(e) => setCode(e.target.value)} {...codeInputProps} required /></Field>
      <Button type="submit" variant="secondary" disabled={code.replace(/\s/g, '').length !== 6}>Replace recovery codes</Button>
      {error && <div className="w-full"><Notice tone="error">{error}</Notice></div>}
    </form>
  );
}

/** Settings → Team → Your account: two-factor status and changes. */
export function TwoFactorPanel() {
  const security = useSecurity();
  const invalidate = useInvalidateAccount();
  const [mode, setMode] = useState<'idle' | 'setup' | 'disable' | 'codes'>('idle');
  const [codes, setCodes] = useState<string[] | null>(null);
  const done = () => {
    setMode('idle');
    setCodes(null);
    void invalidate();
  };
  const s = security.data;
  return (
    <Panel>
      <PanelHeader
        title="Two-factor sign-in"
        icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        description={s ? (s.mfaEnabled ? `On since ${when(s.mfaEnabledAt)} · ${s.recoveryCodesRemaining} recovery code${s.recoveryCodesRemaining === 1 ? '' : 's'} left` : 'Off. Your password alone signs you in.') : undefined}
      />
      <div className="space-y-4 px-5 py-4">
        {security.isLoading && <LoadingState label="Loading…" />}
        {security.isError && <Notice tone="error">{errorMessage(security.error)}</Notice>}
        {s && !s.secretsEncrypted && <Notice tone="warn">The server has no MFA_ENCRYPTION_KEY, so two-factor secrets are stored unencrypted. The workspace owner should set it in Render.</Notice>}
        {s && !s.mfaEnabled && mode !== 'setup' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{s.requiredByWorkspace ? 'This workspace requires two-factor sign-in.' : 'Add a code from your phone to every sign-in, so a stolen password is not enough.'}</p>
            <Button onClick={() => setMode('setup')}>Turn on two-factor</Button>
          </div>
        )}
        {mode === 'setup' && <TwoFactorSetup onEnabled={done} onCancel={() => setMode('idle')} />}
        {s?.mfaEnabled && mode === 'idle' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMode('codes')}>New recovery codes</Button>
            {s.requiredByWorkspace ? <p className="self-center text-xs text-muted-foreground">Required by this workspace, so it stays on.</p> : <Button size="sm" variant="ghost" onClick={() => setMode('disable')}>Turn off</Button>}
          </div>
        )}
        {s?.recoveryCodesRemaining !== undefined && s.mfaEnabled && s.recoveryCodesRemaining <= 2 && mode === 'idle' && <Notice tone="warn">Only {s.recoveryCodesRemaining} recovery code{s.recoveryCodesRemaining === 1 ? '' : 's'} left. Make new ones.</Notice>}
        {mode === 'disable' && <DisableForm onDone={done} />}
        {mode === 'codes' && (codes ? <RecoveryCodes codes={codes} onDone={done} /> : <NewCodesForm onCodes={setCodes} />)}
      </div>
    </Panel>
  );
}

/** Settings → Team → Your account: where this person is signed in. */
export function SessionsPanel() {
  const sessions = useSessions();
  const invalidate = useInvalidateAccount();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function act(fn: () => Promise<unknown>, success: string) {
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(success);
      void invalidate();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const others = (sessions.data ?? []).filter((s) => !s.current);
  return (
    <Panel>
      <PanelHeader
        title="Where you're signed in"
        icon={<MonitorSmartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        actions={others.length > 0 ? <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => act(() => accountApi.endOtherSessions(), 'Signed out everywhere else.')}><LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out everywhere else</Button> : undefined}
      />
      {sessions.isLoading && <div className="px-5 py-4"><LoadingState label="Loading…" /></div>}
      {sessions.isError && <div className="px-5 py-4"><Notice tone="error">{errorMessage(sessions.error)}</Notice></div>}
      <ul className="divide-y divide-border">
        {(sessions.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {s.device}
                {s.current && <span className="ml-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-xs font-normal text-emerald-300">This browser</span>}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[s.workspace, s.ipAddress, `signed in ${when(s.signedInAt)}`, s.method === 'mfa' ? 'with two-factor' : s.method === 'recovery_code' ? 'with a recovery code' : null, `last active ${when(s.lastSeenAt)}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            {!s.current && <Button size="sm" variant="ghost" onClick={() => act(() => accountApi.endSession(s.id), `Signed out ${s.device}.`)} aria-label={`Sign out ${s.device}, signed in ${when(s.signedInAt)}`}>Sign out</Button>}
          </li>
        ))}
      </ul>
      {(message || error) && <div className="border-t border-border px-5 py-3">{error ? <Notice tone="error">{error}</Notice> : <Notice tone="ok">{message}</Notice>}</div>}
    </Panel>
  );
}

/** Settings → Team (owners and admins): require two-factor for everyone. */
export function RequireMfaSetting({ required, membersWithout, selfHasMfa }: { required: boolean; membersWithout: number; selfHasMfa: boolean }) {
  const invalidate = useInvalidateAccount();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (!required && membersWithout > 0 && !window.confirm(`${membersWithout} member${membersWithout === 1 ? ' has' : 's have'} not turned on two-factor. They will have to before they can continue. Require it now?`)) return;
    setError('');
    setBusy(true);
    try {
      await accountApi.setRequireMfa(!required);
      void invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border-t border-border px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Require two-factor sign-in</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{required ? 'On. Members without it must turn it on before they can use the workspace.' : 'Off. Each member chooses.'}{membersWithout > 0 ? ` ${membersWithout} member${membersWithout === 1 ? ' does' : 's do'} not have it on yet.` : ''}</p>
        </div>
        <Button size="sm" variant={required ? 'ghost' : 'secondary'} disabled={busy || (!required && !selfHasMfa)} onClick={toggle} aria-pressed={required}>{required ? 'Make optional' : 'Require for everyone'}</Button>
      </div>
      {!required && !selfHasMfa && <p className="text-xs text-muted-foreground">Turn on two-factor for your own account first.</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** Settings → Team (owners and admins): who did what, filterable, with CSV export. */
export function AuditLogPanel() {
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState({ category: '', q: '' });
  const [pages, setPages] = useState<AuditPage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  async function load(before: string | null, filters = query) {
    setState('loading');
    try {
      const page = await accountApi.audit({ ...filters, before });
      setPages((prev) => (before ? [...prev, page] : [page]));
      setState('ready');
    } catch (e) {
      setError(errorMessage(e));
      setState('error');
    }
  }

  useEffect(() => {
    void load(null, query);
  }, [query]);

  const entries: AuditEntry[] = useMemo(() => pages.flatMap((p) => p.entries), [pages]);
  const categories = pages[0]?.categories ?? [];
  const next = pages[pages.length - 1]?.nextBefore ?? null;

  return (
    <Panel>
      <PanelHeader
        title="Audit log"
        icon={<KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        description="Sign-ins, security changes, members, approvals and automation, newest first."
        actions={<Button asChild size="sm" variant="secondary" className="gap-1.5"><a href={auditCsvUrl(query)} download><Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV</a></Button>}
      />
      <form
        className="grid gap-3 border-b border-border px-5 py-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ category, q });
        }}
      >
        <Field label="Category">
          <select value={category} onChange={(e) => { setCategory(e.target.value); setQuery({ category: e.target.value, q }); }} className={selectClass}>
            <option value="">Everything</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="A name, email or action" /></Field>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {state === 'error' && <div className="px-5 py-4"><StateMessage tone="error" title="The audit log could not load" description={error} action={<Button onClick={() => load(null)}>Try again</Button>} /></div>}
      {state !== 'error' && entries.length === 0 && state === 'ready' && <p className="px-5 py-6 text-sm text-muted-foreground">Nothing matches these filters.</p>}
      <ol className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[11rem_1fr]">
            <time dateTime={e.at} className="text-xs text-muted-foreground">{when(e.at)}</time>
            <div className="min-w-0">
              <p className="text-foreground">{e.description}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{e.actor ?? 'Team password or system'} · {e.type.replace(/_/g, ' ')}</p>
            </div>
          </li>
        ))}
      </ol>
      {state === 'loading' && <div className="px-5 py-4"><LoadingState label="Loading…" /></div>}
      {next && state === 'ready' && <div className="border-t border-border px-5 py-3"><Button size="sm" variant="ghost" onClick={() => load(next)}>Show older</Button></div>}
    </Panel>
  );
}
