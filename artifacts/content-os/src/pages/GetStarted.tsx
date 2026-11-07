import { useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, CheckCircle2, Circle, Wand2 } from 'lucide-react';
import { LoadingState, PageHeader, PageShell, Panel, PanelHeader, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/grants/GrantUi';
import { errorMessage } from '@/lib/grants';
import { onboardingApi, useInvalidateOnboarding, useOnboarding } from '@/lib/onboarding';
import { cn } from '@/lib/utils';

/**
 * /get-started: the first-run dashboard for a new workspace. Four next steps,
 * each ticked from the workspace's real state, and the setup wizard again.
 */
export default function GetStarted() {
  const state = useOnboarding();
  const invalidate = useInvalidateOnboarding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (state.isLoading) return <LoadingState label="Loading your checklist…" />;
  if (state.isError || !state.data) {
    return (
      <PageShell width="narrow">
        <StateMessage tone="error" title="Your checklist could not load" description={errorMessage(state.error)} action={<Button onClick={() => state.refetch()}>Try again</Button>} />
      </PageShell>
    );
  }
  const data = state.data;
  const done = data.steps.filter((s) => s.done).length;
  const next = data.steps.find((s) => !s.done);

  async function setDismissed(dismissed: boolean) {
    setBusy(true);
    setError('');
    try {
      await onboardingApi.setDismissed(dismissed);
      await invalidate();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="Get started"
        title={data.workspace ? `Welcome to GrantCrest, ${data.workspace.name}` : 'Welcome to GrantCrest'}
        description="Four steps from a new workspace to your first application. Each one ticks itself off when it is done."
        actions={
          <Button variant="outline" asChild className="gap-2">
            <Link href="/onboarding"><Wand2 className="h-4 w-4" aria-hidden="true" /> {data.organizations.length ? 'Run setup again' : 'Start setup'}</Link>
          </Button>
        }
      />
      {data.dismissed && (
        <div className="mb-6">
          <Notice tone="info" action={<Button size="sm" variant="outline" disabled={busy} onClick={() => setDismissed(false)}>Show on sign-in again</Button>}>
            This checklist is hidden from your start page. It stays here, and setup stays at Run setup again.
          </Notice>
        </div>
      )}
      <Panel>
        <PanelHeader
          title={data.complete ? 'All done' : `${done} of ${data.steps.length} done`}
          description={next ? `Next: ${next.title.toLowerCase()}.` : 'Your workspace is set up. New matches appear on your organization’s page.'}
        />
        <ol className="divide-y divide-border">
          {data.steps.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
              <span className={cn('flex shrink-0 items-center gap-2 text-xs font-semibold', s.done ? 'text-emerald-300' : 'text-brand')}>
                {s.done ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Circle className="h-5 w-5" aria-hidden="true" />}
                <span className="sr-only">{s.done ? 'Done:' : 'To do:'}</span>
                Step {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">{s.title}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
              </div>
              <Button asChild size="sm" variant={s === next ? 'default' : 'outline'} className="shrink-0 gap-1.5">
                <Link href={s.href}>
                  {s.done ? 'Open' : 'Start'}
                  <span className="sr-only"> {s.title.toLowerCase()}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </li>
          ))}
        </ol>
      </Panel>
      {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
      {!data.dismissed && (
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDismissed(true)}>Hide this checklist</Button>
        </div>
      )}
    </PageShell>
  );
}
