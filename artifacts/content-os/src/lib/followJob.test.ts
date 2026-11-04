import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMessage, followJob, isPendingJob } from './grants';

/** The page follows a background AI job by polling GET /api/jobs/:id. */
function respond(sequence: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const body = sequence[Math.min(calls.length - 1, sequence.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('following background jobs', () => {
  it('recognizes a pending response', () => {
    expect(isPendingJob({ pending: true, jobId: 'j1', status: 'queued' })).toBe(true);
    expect(isPendingJob({ section: {}, demo: false })).toBe(false);
    expect(isPendingJob(null)).toBe(false);
  });

  it('polls until the job succeeds and returns its result', async () => {
    const calls = respond([{ status: 'queued' }, { status: 'running' }, { status: 'succeeded', result: { demo: false, added: 4 } }]);
    await expect(followJob('j1', { intervalMs: 1 })).resolves.toEqual({ demo: false, added: 4 });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatch(/\/api\/jobs\/j1$/);
  });

  it("rejects with the job's error, in the shape the page shows", async () => {
    respond([{ status: 'running' }, { status: 'failed', lastError: 'Provider returned 529: overloaded' }]);
    const failure = await followJob('j2', { intervalMs: 1 }).catch((e) => e);
    expect(errorMessage(failure)).toBe('Provider returned 529: overloaded');
  });

  it('gives up after its time limit with a clear message', async () => {
    respond([{ status: 'running' }]);
    const failure = await followJob('j3', { intervalMs: 1, maxMs: 5 }).catch((e) => e);
    expect(errorMessage(failure)).toBe('Still working. Check back in a few minutes.');
  });
});
