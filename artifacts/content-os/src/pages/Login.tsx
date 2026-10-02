import { useState } from 'react';
import { PenLine } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess();
      } else if (res.status === 429) {
        setError('Too many sign-in attempts. Wait 15 minutes, then try again.');
      } else {
        setError('Incorrect password. Please try again.');
      }
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-primary/15 text-brand">
            <PenLine className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">Content OS</p>
            <p className="mt-1 text-xs leading-none text-muted-foreground">Editorial command center</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/40 sm:p-9">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Welcome back</p>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Sign in to Content OS</h1>
          <p className="mb-7 text-sm leading-relaxed text-muted-foreground">Enter your team password to continue building.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
                placeholder="Team password"
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>

            {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

            <button
              type="submit"
              disabled={loading || !password}
              className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
