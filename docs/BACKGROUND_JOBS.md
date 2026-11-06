# Background Jobs

How Content Machine runs slow or failure-prone work outside web requests. Owner: `ebyron357`. Introduced 4 November 2026 (R1, step 4 of `GRANT_PLATFORM_PLAN.md`).

## 1. What it is

A durable job queue in PostgreSQL (`jobs` table, migration `0025_job_queue`), with a worker that runs inside the API process. It needs no extra service or cost: on Render the single web service runs both.

| Piece | Where | What it does |
|---|---|---|
| Queue | `artifacts/api-server/src/lib/jobs/queue.ts` | Enqueue, claim, heartbeat, complete, fail with retry, reclaim, cancel, retry, prune |
| Kinds | `lib/jobs/definitions.ts` (registered through `lib/jobs/registry.ts`) | Each kind's label, attempts, timeout, backoff and concurrency, as data |
| Worker | `lib/jobs/worker.ts` | Polls, runs jobs, reports heartbeats, enforces timeouts, stops gracefully |
| Schedules | `lib/jobs/schedules.ts` | Recurring jobs, one per period |
| Screen | Settings → Jobs (admin unlock) | Counts, worker status, schedules, recent jobs, run again, cancel |
| API | `routes/jobs.ts` | `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/retry`, `POST /api/jobs/:id/cancel` |

## 2. Guarantees

- **One worker per job.** A job is claimed with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, so concurrent workers or instances never take the same job (`lib/jobs/jobs.integration.test.ts` claims 8 jobs with 12 concurrent claimers).
- **One active run per key.** A partial unique index on `dedupe_key` for queued and running jobs means, for example, only one grant refresh is ever queued or running. Asking again returns that job.
- **Retries with backoff.** A failed attempt goes back in the queue after an exponential, jittered delay until the kind's attempts are used. Errors marked permanent are not retried.
- **Timeouts.** A run longer than the kind's timeout is aborted and counts as a failed attempt.
- **Restarts and deploys.** A running job reports a heartbeat every 15 seconds. If its worker stops (crash or deploy), the next worker puts it back after 2 minutes, or fails it if it has used its attempts. On SIGTERM the worker waits up to 25 seconds for running jobs first.
- **Schedules never double up.** Time is split into periods (UTC). A period is covered once any job of that kind was created in it, by the schedule or by hand, so restarts never add a second run and a manual refresh counts for the day.
- **History.** Finished jobs are kept 30 days, then pruned. Each records attempts, timings, progress, result and the last error.

## 3. Job kinds

| Kind | Label | Attempts | Timeout | Backoff | Runs at once | Schedule |
|---|---|---|---|---|---|---|
| `grant_sync` | Refresh grant opportunities | 3 | 20 min | 5 min, doubling, up to 1 h | 1 | Daily (first run 60 s after start if the day has none) |
| `grant_section_draft` | Draft a section with AI | 2 | 3 min | 15 s, doubling, up to 1 min | 2 | On request |
| `grant_section_review` | Review a section | 2 | 3 min | 15 s, doubling, up to 1 min | 2 | On request |
| `grant_requirements_extract` | Extract requirements from a notice | 2 | 3 min | 15 s, doubling, up to 1 min | 2 | On request |
| `foundation_import` | Import foundation giving history | 2 | 3 h | 10 min, doubling, up to 1 h | 1 | Every 30 days and on request (admin unlock), both **off** unless `FOUNDATIONS_IMPORT_ENABLED=true` |
| `source_sweep` | Check watched pages that are due | 2 | 5 min | 1 min, doubling, up to 10 min | 1 | Hourly (first run 2 min after start) |
| `source_check` | Check a watched page | 2 | 2 min | 1 min, doubling, up to 10 min | 1 | From the sweep, a changedetection.io notification, or **Check now** |
| `source_extract` | Extract opportunities from a changed page | 2 | 3 min | 15 s, doubling, up to 1 min | 1 | After a check finds a change |

The three `source_*` kinds belong to the grant source registry ([`SOURCE_REGISTRY.md`](SOURCE_REGISTRY.md)). A page problem is recorded on the source and does not fail the job; extraction only ever makes drafts for review.

`foundation_import` streams funder-graph's Parquet partitions into per-funder aggregates (`GRANT_STUDIO.md`, Foundations). A retry or a second run is safe: a filing already counted is skipped. It stops with status `partial` at its storage budget (`FOUNDATIONS_MAX_DB_MB`).

**AI work.** **Draft with AI**, **Review** and **Extract requirements** each queue a job for the workspace (one per section, or per notice, at a time) and wait up to 3 seconds:
- If the job finishes in that time (demo mode, or a quick provider), the request answers as before.
- Otherwise it answers `202` with the job id. The page says the work is running in the background, follows the job, and shows the outcome when it is done. The application view lists running AI jobs (`aiJobs`), so the section shows its progress even after a reload, and the editor stays read only while a draft is being written.
- A provider error is retried once. If it still fails, the error is shown.
- Each run re-checks that the section belongs to the job's workspace, and a draft never overwrites a section approved in the meantime.
- Where no worker runs in the process (tests, or `JOBS_WORKER_DISABLED`), the request runs the job itself through the same code, so every AI request is recorded as a job either way.

`grant_sync` reads Grants.gov and the California Grants Portal, then sends match alerts and deadline reminders. It fails, and is retried, only when every source failed; one source failing is recorded on its sync run and the job succeeds. **Refresh now** in Grant Studio queues the same job, and the page shows its progress until it finishes.

## 4. Configuration

| Variable | Default | Effect |
|---|---|---|
| `JOBS_CONCURRENCY` | `2` (1–8) | Jobs the worker runs at once; each kind also has its own limit |
| `JOBS_POLL_MS` | `5000` | How often the worker checks the queue; enqueuing from the app wakes it at once |
| `JOBS_WORKER_DISABLED` | unset | `true` stops the worker on this instance (jobs stay queued) |
| `JOBS_WORKER_ENABLED` | unset | Under `NODE_ENV=test` the worker is off unless this is `true` |
| `GRANTS_SYNC_DISABLED`, `GRANTS_SYNC_ENABLED`, `GRANTS_CA_DISABLED` | | As before (`GRANT_STUDIO.md`): they control the daily grant schedule and sources |
| `FOUNDATIONS_IMPORT_ENABLED` and the other `FOUNDATIONS_*` settings | unset | The foundation import's schedule and limits (`GRANT_STUDIO.md`, Foundations) |
| `SOURCE_WATCH_DISABLED`, `SOURCE_WATCH_ENABLED` | | `true` stops the hourly page sweep; under `NODE_ENV=test` the sweep is off unless `SOURCE_WATCH_ENABLED=true` (`SOURCE_REGISTRY.md`) |

## 5. Adding a kind

1. Define it in `lib/jobs/definitions.ts` with `defineJob({ kind, label, maxAttempts, timeoutMs, backoffMs, concurrency, run })`. `run` receives the payload, the attempt number, an `AbortSignal` and `progress()`; throw `PermanentJobError` for errors a retry cannot fix.
2. Enqueue it with `enqueue(definition, payload, { userId, dedupeKey, runAt, requestedBy })`. Pass the workspace principal as `userId` for workspace work, so `GET /api/jobs/:id` is visible only to that workspace.
3. For a recurring job, add an entry to `SCHEDULES`.
4. Test it with the pattern in `lib/jobs/jobs.integration.test.ts`, using a worker limited to the kinds under test.

## 6. Operating it

- **Is it working?** Settings → Jobs shows "Worker running", when it last checked the queue, and the 24-hour success and failure counts.
- **A job failed.** Read its error on the screen, fix the cause (for example a source outage), then **Run again**.
- **Stuck in Queued.** Check the worker notice. In test mode or with `JOBS_WORKER_DISABLED` it is off by design.
- **Deploys.** Nothing to do: running jobs are finished or put back automatically.

## 7. Not yet moved to the queue

| Work | Today | Next |
|---|---|---|
| Publishing, performance and webhook schedulers | Their own guarded loops with claim and retry, unchanged | Move onto the queue when they next change |
