import { useState } from 'react';
import { PenLine } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** After a correct password, accounts with two-factor on enter a code. */
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(useRecovery ? { recoveryCode: code.trim() } : { code: code.replace(/\s/g, '') }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.ok) {
        onSuccess();
      } else if (res.status === 429) {
        setError('Too many incorrect codes. Wait 15 minutes, then sign in again.');
      } else if (data.code === 'mfa_expired') {
        setStep('password');
        setCode('');
        setPassword('');
        setError(data.error ?? 'Your sign-in expired. Enter your email and password again.');
      } else {
        setError(data.error ?? 'That code is not correct.');
        setCode('');
      }
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email.trim() ? { email: email.trim(), password } : { password }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { mfaRequired?: boolean };
        if (data.mfaRequired) {
          setStep('code');
          setCode('');
          setUseRecovery(false);
        } else onSuccess();
      } else if (res.status === 429) {
        setError('Too many sign-in attempts. Wait 15 minutes, then try again.');
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'This account cannot sign in.');
      } else {
        setError(email.trim() ? 'Incorrect email or password. Please try again.' : 'Incorrect password. Please try again.');
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
            <p className="text-sm font-semibold tracking-tight text-foreground">GrantCrest</p>
            <p className="mt-1 text-xs leading-none text-muted-foreground">Editorial command center</p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/40 sm:p-9">
          {step === 'code' ? (
            <>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Two-factor sign-in</p>
              <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">{useRecovery ? 'Enter a recovery code' : 'Enter your code'}</h1>
              <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
                {useRecovery ? 'Use one of the recovery codes you saved when you turned on two-factor. Each code works once.' : `Open your authenticator app and enter the 6-digit code for ${email.trim() || 'your account'}.`}
              </p>
              <form onSubmit={submitCode} className="space-y-4">
                <div>
                  <label htmlFor="mfa-code" className="mb-2 block text-sm font-medium text-foreground">{useRecovery ? 'Recovery code' : 'Authentication code'}</label>
                  <input
                    id="mfa-code"
                    key={useRecovery ? 'recovery' : 'totp'}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="h-11 w-full rounded-xl border border-input bg-background px-3.5 font-mono text-base tracking-widest text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
                    placeholder={useRecovery ? 'XXXX-XXXX-XX' : '123456'}
                    inputMode={useRecovery ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    maxLength={useRecovery ? 14 : 7}
                    autoFocus
                    required
                  />
                </div>
                {error && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || (useRecovery ? code.trim().length < 10 : code.replace(/\s/g, '').length !== 6)}
                  className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Checking…' : 'Verify and sign in'}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }}>
                    {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
                  </button>
                  <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => { setStep('password'); setCode(''); setPassword(''); setError(''); }}>
                    Start over
                  </button>
                </div>
              </form>
            </>
          ) : (
          <>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Welcome back</p>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Sign in to GrantCrest</h1>
          <p className="mb-7 text-sm leading-relaxed text-muted-foreground">Sign in with your email and password. Operators can leave email empty and use the team password.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
                placeholder="you@organization.org"
                autoComplete="username"
              />
            </div>
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
                placeholder={email.trim() ? 'Your password' : 'Team password'}
                required
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
          </>
          )}
        </div>
      </div>
    </div>
  );
}
