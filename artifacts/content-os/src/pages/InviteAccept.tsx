import { useEffect, useState, type FormEvent } from 'react';
import { PenLine } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface InviteInfo {
  workspace: { name: string };
  email: string;
  roleLabel: string;
  expiresAt: string;
  hasAccount: boolean;
}

/** Public page for an invitation link (/invite/<token>). */
export default function InviteAccept({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/auth/invites/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) setInfo(data as InviteInfo);
        else setLoadError((data as { error?: string }).error ?? 'This invitation is not valid.');
      })
      .catch(() => setLoadError('Unable to connect. Please try again.'));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/auth/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info?.hasAccount ? { password } : { name, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.history.replaceState({}, '', `${BASE}/grant-studio`);
        onDone();
        return;
      }
      setError(res.status === 429 ? 'Too many attempts. Wait 15 minutes, then try again.' : (data as { error?: string }).error ?? 'Something went wrong.');
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25';

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand/30 bg-primary/15 text-brand"><PenLine className="h-5 w-5" aria-hidden="true" /></div>
          <p className="text-sm font-semibold text-foreground">Content OS</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-7 sm:p-9">
          {!info && !loadError && <p role="status" className="text-sm text-muted-foreground">Checking your invitation…</p>}
          {loadError && (
            <>
              <h1 className="mb-2 text-2xl font-semibold text-foreground">Invitation not valid</h1>
              <p role="alert" className="text-sm text-muted-foreground">{loadError} Ask the person who invited you for a new link.</p>
              <a href={`${BASE}/`} className="mt-5 inline-block text-sm font-medium text-brand hover:underline">Go to sign in</a>
            </>
          )}
          {info && (
            <>
              <h1 className="mb-2 text-2xl font-semibold text-foreground">Join {info.workspace.name}</h1>
              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                You were invited as <strong className="text-foreground">{info.roleLabel}</strong> with {info.email}.{' '}
                {info.hasAccount ? 'You already have an account: enter its password to join.' : 'Choose your name and a password to create your account.'}
              </p>
              <form onSubmit={submit} className="space-y-4">
                {!info.hasAccount && (
                  <div>
                    <label htmlFor="invite-name" className="mb-2 block text-sm font-medium text-foreground">Your name</label>
                    <input id="invite-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                  </div>
                )}
                <div>
                  <label htmlFor="invite-password" className="mb-2 block text-sm font-medium text-foreground">{info.hasAccount ? 'Password' : 'Choose a password'}</label>
                  <input id="invite-password" type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={info.hasAccount ? 'current-password' : 'new-password'} aria-describedby="invite-password-hint" />
                  {!info.hasAccount && <p id="invite-password-hint" className="mt-1.5 text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p>}
                </div>
                {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
                <button type="submit" disabled={busy || !password || (!info.hasAccount && !name.trim())} className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? 'Joining…' : `Join ${info.workspace.name}`}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
