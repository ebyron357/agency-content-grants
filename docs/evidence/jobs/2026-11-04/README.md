# Background jobs evidence, 4 November 2026

Captured from a local server on the demo database (`grant_studio_demo`, public Grants.gov and California Grants Portal data, synthetic organizations) with the worker on. 1280 px wide at 2x.

| File | Shows |
|---|---|
| `31-refresh-progress.png` | Grant Studio while the refresh job runs: the button is disabled and the status line names the current step |
| `32-jobs-running.png` | Settings → Jobs during the run: counts, worker status, the daily schedule and the running job |
| `33-jobs-finished.png` | The same screen after the job succeeded |

On startup the daily schedule found no refresh for the day and queued one to run 60 seconds later. The job read both sources and sent alerts, then finished in 10.4 s with status `succeeded`.

The behaviour is asserted in `artifacts/api-server/src/lib/jobs/jobs.integration.test.ts` and `artifacts/content-os/e2e/jobs.spec.ts`.
