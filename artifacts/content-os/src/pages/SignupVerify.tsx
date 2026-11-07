import { useEffect, useRef, useState } from 'react';
import { PublicFrame } from '@/pages/Signup';
import { postJson } from '@/lib/onboarding';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

type State = { kind: 'working' } | { kind: 'invalid'; message: string } | { kind: 'exists'; message: string } | { kind: 'error'; message: string };

/** Reads the token from the link's #fragment once, so it never reaches a server log. */
function takeToken(): string {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '';
  if (window.location.hash) window.history.replaceState({}, '', window.location.pathname);
  return token;
}

/**
 * /signup/verify#token=…: the link in the confirmation email. Opening it creates the
 * workspace and signs in, then the setup wizard opens.
 */
export default function SignupVerify({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeToken();
    if (!token) {
      setState({ kind: 'invalid', message: 'This link is missing its code. Open the link from your email again, or sign up again.' });
      return;
    }
    postJson('/auth/signup/verify', { token })
      .then(({ status, data }) => {
        if (status === 201) {
          window.history.replaceState({}, '', `${BASE}/onboarding`);
          onDone();
        } else if (status === 409) setState({ kind: 'exists', message: String(data.error ?? 'An account with this email already exists.') });
        else if (status === 429) setState({ kind: 'error', message: 'Too many attempts. Wait 15 minutes, then open the link again.' });
        else setState({ kind: 'invalid', message: String(data.error ?? 'This link is not valid.') });
      })
      .catch(() => setState({ kind: 'error', message: 'Unable to connect. Check your connection and open the link again.' }));
  }, [onDone]);

  return (
    <PublicFrame>
      {state.kind === 'working' && (
        <>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Confirming your email</h1>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Creating your workspace…</p>
        </>
      )}
      {state.kind === 'invalid' && (
        <>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Link not valid</h1>
          <p role="alert" className="text-sm leading-relaxed text-muted-foreground">{state.message}</p>
          <a href={`${BASE}/signup`} className="mt-5 inline-block text-sm font-medium text-brand hover:underline">Sign up again</a>
        </>
      )}
      {state.kind === 'exists' && (
        <>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">You already have an account</h1>
          <p role="alert" className="text-sm leading-relaxed text-muted-foreground">{state.message}</p>
          <a href={`${BASE}/login`} className="mt-5 inline-block text-sm font-medium text-brand hover:underline">Go to sign in</a>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Something went wrong</h1>
          <p role="alert" className="text-sm leading-relaxed text-muted-foreground">{state.message}</p>
        </>
      )}
    </PublicFrame>
  );
}
