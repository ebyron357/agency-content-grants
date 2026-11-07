import { useState } from 'react';
import { Mountain } from 'lucide-react';
import { SIGNUP_EMAIL_KEY } from '@/pages/Landing';

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

interface SignupProps {
  onSuccess: () => void;
}

/** Self-serve sign-up: creates the person's account and their organization's workspace, then signs them in. */
export default function Signup({ onSuccess }: SignupProps) {
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, organization, email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        try {
          sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
        } catch {
          // nothing to clear
        }
        window.history.replaceState(null, '', `${BASE}/`);
        onSuccess();
      } else {
        setError(data.error ?? 'We could not create your account. Try again.');
      }
    } catch {
      setError('We could not reach GrantCrest. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <a href={`${BASE}/`} className="mb-8 flex items-center justify-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Mountain className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">GrantCrest</span>
        </a>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/40 sm:p-9">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Create your account</h1>
          <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
            Free to search. You will see your first grant matches in about two minutes.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="mb-2 block text-sm font-medium text-foreground">Your name</label>
              <input id="signup-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" required />
            </div>
            <div>
              <label htmlFor="signup-org" className="mb-2 block text-sm font-medium text-foreground">Organization name</label>
              <input id="signup-org" value={organization} onChange={(e) => setOrganization(e.target.value)} className={inputClass} autoComplete="organization" required />
            </div>
            <div>
              <label htmlFor="signup-email" className="mb-2 block text-sm font-medium text-foreground">Work email</label>
              <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" placeholder="you@yourorganization.org" required />
            </div>
            <div>
              <label htmlFor="signup-password" className="mb-2 block text-sm font-medium text-foreground">Password</label>
              <input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="new-password" aria-describedby="signup-password-hint" required />
              <p id="signup-password-hint" className="mt-2 text-xs text-muted-foreground">At least 12 characters.</p>
            </div>
            {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Creating your account…' : 'Create account'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account? <a href={`${BASE}/login`} className="text-brand underline-offset-4 hover:underline">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
