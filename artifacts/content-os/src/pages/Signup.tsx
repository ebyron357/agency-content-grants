import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Landmark, MailCheck } from 'lucide-react';
import Login from '@/pages/Login';
import { postJson, signupStatus } from '@/lib/onboarding';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const inputClass =
  'h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25';

/** The public frame shared by sign-up and email confirmation. */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand/30 bg-primary/15 text-brand">
            <Landmark className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold text-foreground">GrantCrest</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-7 sm:p-9">{children}</div>
      </div>
    </main>
  );
}

/**
 * Public sign-up (/signup). Shown only while the server says self sign-up is on;
 * otherwise this address shows the ordinary sign-in page, exactly as before.
 */
export default function Signup({ onSignedIn }: { onSignedIn: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [form, setForm] = useState({ name: '', organizationName: '', email: '', password: '', website: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    signupStatus().then(setEnabled);
  }, []);

  if (enabled === null) {
    return (
      <PublicFrame>
        <p role="status" className="text-sm text-muted-foreground">Loading…</p>
      </PublicFrame>
    );
  }
  if (!enabled) return <Login onSuccess={onSignedIn} />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { status, data } = await postJson('/auth/signup', form);
      if (status === 202) setSent(String(data.message ?? 'Check your email for a link to finish.'));
      else if (status === 429) setError('Too many sign-up attempts. Wait an hour, then try again.');
      else if (status === 404) setError('Sign-up is not available right now.');
      else setError(String(data.error ?? 'Something went wrong. Please try again.'));
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <PublicFrame>
        <MailCheck className="mb-3 h-7 w-7 text-brand" aria-hidden="true" />
        <h1 className="mb-2 text-2xl font-semibold text-foreground">Check your email</h1>
        <p role="status" className="text-sm leading-relaxed text-muted-foreground">
          {sent} We sent it to <strong className="text-foreground">{form.email.trim()}</strong>.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Nothing is created until you open the link. If it does not arrive in a few minutes, check your spam folder.</p>
        <button type="button" className="mt-6 text-sm font-medium text-brand underline-offset-4 hover:underline" onClick={() => setSent(null)}>
          Use a different email
        </button>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Free to start</p>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Create your GrantCrest workspace</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">One workspace for your organization. After you confirm your email, enter your EIN and see your first grant matches in a few minutes.</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="signup-name" className="mb-2 block text-sm font-medium text-foreground">Your name</label>
          <input id="signup-name" className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />
        </div>
        <div>
          <label htmlFor="signup-org" className="mb-2 block text-sm font-medium text-foreground">Organization name</label>
          <input id="signup-org" className={inputClass} value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} required autoComplete="organization" />
        </div>
        <div>
          <label htmlFor="signup-email" className="mb-2 block text-sm font-medium text-foreground">Work email</label>
          <input id="signup-email" type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" placeholder="you@organization.org" />
        </div>
        <div>
          <label htmlFor="signup-password" className="mb-2 block text-sm font-medium text-foreground">Choose a password</label>
          <input id="signup-password" type="password" className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" aria-describedby="signup-password-hint" />
          <p id="signup-password-hint" className="mt-1.5 text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p>
        </div>
        {/* Hidden from people; bots that fill it are ignored. */}
        <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor="signup-website">Website</label>
          <input id="signup-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </div>
        {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        <button
          type="submit"
          disabled={busy || !form.name.trim() || !form.organizationName.trim() || !form.email.trim() || !form.password}
          className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Sending link…' : 'Create workspace'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <a href={`${BASE}/`} className="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </PublicFrame>
  );
}
