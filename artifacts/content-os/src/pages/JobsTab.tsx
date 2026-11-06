import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Field, Notice, StatusPill, selectClass } from '@/components/grants/GrantUi';
import { apiGet, apiPost } from '@/lib/api';
import { errorMessage } from '@/lib/grants';
import { useMe } from '@/lib/account';

/**
 * Settings → Jobs: the background job queue (api-server lib/jobs,
 * docs/BACKGROUND_JOBS.md). Read and act on it with admin access unlocked.
 */

interface JobView {
  id: string;
  kind: string;
  label: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  runAt: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  progress: Record<string, unknown> | null;
  lastError: string | null;
  requestedBy: string | null;
}

interface JobsPage {
  counts: { queued: number; running: number; failed24h: number; succeeded24h: number };
  workerEnabled: boolean;
  worker: { id: string; startedAt: string; lastPollAt: string | null; concurrency: number; running: { id: string; kind: string }[] } | null;
  kinds: { kind: string; label: string; maxAttempts: number; timeoutMs: number; concurrency: number }[];
  schedules: { name: string; label: string; everyHours: number; enabled: boolean }[];
  jobs: JobView[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const duration = (ms: number | null) => (ms === null ? '' : ms < 1000 ? `${ms} ms` : ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

function describe(job: JobView): string {
  switch (job.status) {
    case 'queued':
      return job.attempts > 0 ? `Retry ${job.attempts + 1} of ${job.maxAttempts} at ${when(job.runAt)}` : new Date(job.runAt).getTime() > Date.now() ? `Starts ${when(job.runAt)}` : 'Waiting for the worker';
    case 'running':
      return `Attempt ${job.attempts} of ${job.maxAttempts}${typeof job.progress?.step === 'string' ? ` · ${job.progress.step}` : ''} · started ${when(job.startedAt)}`;
    case 'succeeded':
      return `Finished ${when(job.finishedAt)} in ${duration(job.durationMs)}${job.attempts > 1 ? ` after ${job.attempts} attempts` : ''}`;
    case 'failed':
      return `Failed ${when(job.finishedAt)} after ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}`;
    default:
      return `Cancelled ${when(job.finishedAt)}`;
  }
}

export default function JobsTab() {
  const me = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [error, setError] = useState('');
  const unlocked = me.data?.isAdmin === true;
  const params = new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) }).toString();
  const jobs = useQuery({
    queryKey: ['jobs', params],
    queryFn: () => apiGet<JobsPage>(`/jobs${params ? `?${params}` : ''}`),
    enabled: unlocked,
    refetchInterval: (q) => (q.state.data && (q.state.data.counts.queued > 0 || q.state.data.counts.running > 0) ? 5000 : 30_000),
  });

  async function act(path: string) {
    setError('');
    try {
      await apiPost(path);
      await qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!unlocked) return <Notice tone="info" title="Admin access needed">Unlock admin access under Security at the top of this page to see and manage background jobs.</Notice>;
  if (jobs.isLoading) return <LoadingState label="Loading jobs…" className="min-h-[20vh]" />;
  if (jobs.isError || !jobs.data) return <StateMessage tone="error" title="Jobs could not load" description={errorMessage(jobs.error)} action={<Button onClick={() => jobs.refetch()}>Try again</Button>} />;
  const d = jobs.data;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Queued', d.counts.queued],
          ['Running', d.counts.running],
          ['Succeeded, 24 h', d.counts.succeeded24h],
          ['Failed, 24 h', d.counts.failed24h],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      {!d.workerEnabled ? (
        <Notice tone="warn" title="The worker is off on this server">Jobs are queued but not run here (test mode or JOBS_WORKER_DISABLED). Production runs the worker.</Notice>
      ) : d.worker ? (
        <Notice tone="ok" title="Worker running">
          {`Up since ${when(d.worker.startedAt)} · last checked the queue ${when(d.worker.lastPollAt)} · runs up to ${d.worker.concurrency} at once · ${d.worker.running.length} running now.`}
        </Notice>
      ) : (
        <Notice tone="error" title="The worker is not running">Restart the service; queued jobs wait until it is back.</Notice>
      )}

      <Panel>
        <PanelHeader title="Schedules" description="Recurring jobs. A run by hand in the same period counts, and restarts never add a second run." />
        <ul className="divide-y divide-border">
          {d.schedules.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span className="text-foreground">{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.enabled ? `Every ${s.everyHours === 24 ? 'day' : s.everyHours > 24 && s.everyHours % 24 === 0 ? `${s.everyHours / 24} days` : `${s.everyHours} hours`}` : 'Off on this server'}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader
          title="Recent jobs"
          description="The 100 most recent. Failed jobs can be run again; queued jobs can be cancelled."
          actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => jobs.refetch()}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reload</Button>}
        />
        <div className="grid gap-3 border-b border-border px-5 py-4 sm:grid-cols-2">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
              <option value="">Any</option>
              {['queued', 'running', 'succeeded', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass}>
              <option value="">Any</option>
              {d.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </Field>
        </div>
        {error && <div className="px-5 py-3"><Notice tone="error">{error}</Notice></div>}
        {d.jobs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No jobs match.</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.jobs.map((j) => (
              <li key={j.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{j.label}</span>
                    <StatusPill status={j.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{describe(j)}{j.requestedBy ? ` · requested by ${j.requestedBy}` : ''}</p>
                  {j.lastError && j.status !== 'succeeded' && <p className="mt-1 break-words text-xs text-red-300">{j.lastError}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(j.status === 'failed' || j.status === 'cancelled') && <Button size="sm" variant="secondary" onClick={() => act(`/jobs/${j.id}/retry`)} aria-label={`Run ${j.label} again`}>Run again</Button>}
                  {j.status === 'queued' && <Button size="sm" variant="ghost" onClick={() => act(`/jobs/${j.id}/cancel`)} aria-label={`Cancel ${j.label}`}>Cancel</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
