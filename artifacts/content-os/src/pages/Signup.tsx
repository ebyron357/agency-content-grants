import { useState, type FormEvent, type ReactNode } from 'react';
import { MailCheck, Mountain } from 'lucide-react';
import { SIGNUP_EMAIL_KEY } from '@/pages/Landing';
import { postJson } from '@/lib/onboarding';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const inputClass =
  'h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25';

function initialEmail(): string {
  try {
    return sessionStorage.getItem(SIGNUP_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function forgetLandingEmail() {
  try {
    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
  } catch {
    // nothing to clear
  }
}

/** The public frame shared by sign-up and email confirmation: the logo links back to the landing page. */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <a href={`${BASE}/`} className="mb-8 flex items-center justify-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Mountain className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">GrantCrest</span>
        </a>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/40 sm:p-9">{children}</div>
      </div>
    </main>
  );
}

/**
 * Public sign-up (/signup), shown only while the server says sign-up is open
 * (App.tsx; docs/SELF_SIGNUP.md). It creates nothing: the server emails a
 * one-time link, and the account and workspace exist only once that link is
 * opened (/signup/verify). The answer is the same whether or not the email
 * already has an account.
 */
export default function Signup() {
  const [form, setForm] = useState({ name: '', organizationName: '', email: initialEmail(), password: '', website: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { status, data } = await postJson('/auth/signup', form);
      if (status === 202) {
        forgetLandingEmail();
        setSent(String(data.message ?? 'Check your email for a link to finish.'));
      } else if (status === 429) setError('Too many sign-up attempts. Wait an hour, then try again.');
      else if (status === 404) setError('Sign-up is not open yet. Ask the person who runs your workspace for an invitation.');
      else setError(String(data.error ?? 'We could not create your account. Try again.'));
    } catch {
      setError('We could not reach GrantCrest. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <PublicFrame>
        <MailCheck className="mb-3 h-7 w-7 text-brand" aria-hidden="true" />
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
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
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
      <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
        Free to search. Confirm your email, and you will see your first grant matches in about two minutes.
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="signup-name" className="mb-2 block text-sm font-medium text-foreground">Your name</label>
          <input id="signup-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} autoComplete="name" required />
        </div>
        <div>
          <label htmlFor="signup-org" className="mb-2 block text-sm font-medium text-foreground">Organization name</label>
          <input id="signup-org" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} className={inputClass} autoComplete="organization" required />
        </div>
        <div>
          <label htmlFor="signup-email" className="mb-2 block text-sm font-medium text-foreground">Work email</label>
          <input id="signup-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} autoComplete="email" placeholder="you@yourorganization.org" required />
        </div>
        <div>
          <label htmlFor="signup-password" className="mb-2 block text-sm font-medium text-foreground">Password</label>
          <input id="signup-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} autoComplete="new-password" aria-describedby="signup-password-hint" required />
          <p id="signup-password-hint" className="mt-2 text-xs text-muted-foreground">At least 12 characters. A short sentence works well.</p>
        </div>
        {/* Hidden from people; bots that fill it are ignored by the server. */}
        <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor="signup-website">Website</label>
          <input id="signup-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        </div>
        {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        <button
          type="submit"
          disabled={busy || !form.name.trim() || !form.organizationName.trim() || !form.email.trim() || !form.password}
          className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Sending link…' : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <a href={`${BASE}/login`} className="text-brand underline-offset-4 hover:underline">Sign in</a>
      </p>
    </PublicFrame>
  );
}
