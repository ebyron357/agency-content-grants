import { useState } from 'react';
import { Newspaper } from 'lucide-react';

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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
            <Newspaper className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-foreground">
              Content OS
            </p>
            <p className="mt-1 text-xs leading-none text-muted-foreground">Editorial Suite</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/70 bg-card p-7 shadow-xl shadow-foreground/5 sm:p-9">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Welcome back</p>
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

            {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading || !password}
              className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
