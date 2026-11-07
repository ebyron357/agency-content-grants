import { ShieldCheck } from 'lucide-react';
import { TwoFactorSetup } from '@/components/account/Security';
import { BrandLockup } from '@/components/layout/Brand';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * Shown instead of the app when the workspace requires two-factor sign-in and
 * this member has not turned it on. The server refuses every other route
 * until they do, so this is the only way forward besides signing out.
 */
export default function MfaRequired({ onDone }: { onDone: () => void }) {
  async function signOut() {
    await fetch(`${BASE}/api/auth/logout`, { method: 'POST' }).catch(() => {});
    window.location.assign(`${BASE}/`);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xl">
      <BrandLockup />
      <div className="rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/40 sm:p-9">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-primary/15 text-brand">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Turn on two-factor sign-in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your workspace requires it. It takes about a minute.</p>
          </div>
        </div>
        <TwoFactorSetup onEnabled={onDone} />
        <button type="button" onClick={signOut} className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline">Sign out instead</button>
      </div>
      </div>
    </main>
  );
}
