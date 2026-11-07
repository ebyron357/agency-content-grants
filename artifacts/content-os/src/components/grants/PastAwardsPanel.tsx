import { ExternalLink, History } from 'lucide-react';
import { Panel, PanelHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/grants/GrantUi';
import { errorMessage } from '@/lib/grants';
import { usd } from '@/lib/foundations';
import { usePastAwards, type PastAward, type PastAwardListing } from '@/lib/pastAwards';

/** Recent awards under a federal opportunity's Assistance Listings, from USAspending.gov. */
export function PastAwardsPanel({ opportunityId, applicantId }: { opportunityId: string; applicantId: string }) {
  const q = usePastAwards(opportunityId, applicantId);
  return (
    <Panel>
      <PanelHeader
        title="Past federal awards"
        icon={<History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        description="Who this program funded before, from USAspending.gov. What it funded before is not a promise of future awards."
      />
      <div className="space-y-5 px-5 py-4">
        {q.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading past awards…</p>
        ) : q.isError || !q.data ? (
          <Notice tone="error" action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>Try again</Button>}>Past awards could not load. {errorMessage(q.error)}</Notice>
        ) : !q.data.applicable ? (
          <p className="text-sm text-muted-foreground">{q.data.reason}</p>
        ) : (
          <>
            {q.data.listings.map((l) => <Listing key={l.programNumber} listing={l} state={q.data!.state} />)}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Source:{' '}
              <a className="underline underline-offset-4 hover:text-foreground" href={q.data.source.url} target="_blank" rel="noreferrer">
                {q.data.source.name}<span className="sr-only"> (opens in a new tab)</span>
              </a>
              . {q.data.source.note}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function AwardRows({ awards, caption }: { awards: PastAward[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">Recipient</th>
            <th scope="col" className="px-3 py-2 font-medium">State</th>
            <th scope="col" className="px-3 py-2 font-medium">Fiscal year</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {awards.map((a, i) => (
            <tr key={`${a.awardId ?? a.recipient}-${i}`}>
              <th scope="row" className="px-3 py-2 text-left font-normal text-foreground">
                {a.url ? (
                  <a className="underline-offset-4 hover:underline" href={a.url} target="_blank" rel="noreferrer">
                    {a.recipient}<span className="sr-only"> (award on USAspending, opens in a new tab)</span>
                  </a>
                ) : a.recipient}
              </th>
              <td className="px-3 py-2 text-muted-foreground">{a.state ?? 'Not given'}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{a.fiscalYear ? `FY${a.fiscalYear}` : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{usd(a.amountUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Listing({ listing: l, state }: { listing: PastAwardListing; state: string | null }) {
  const s = l.summary;
  return (
    <section aria-label={`Assistance Listing ${l.programNumber}`} className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Assistance Listing {l.programNumber}</h3>
      {l.status === 'loading' && <p role="status" className="text-sm text-muted-foreground">{l.message}</p>}
      {l.status === 'unavailable' && <Notice tone="warn">{l.message}</Notice>}
      {l.status === 'off' && <p className="text-sm text-muted-foreground">{l.message}</p>}
      {l.status === 'stale' && l.message && <p className="text-xs text-amber-300">{l.message}</p>}
      {s && (
        <>
          {s.sampleSize === 0 ? (
            <p className="text-sm text-muted-foreground">USAspending lists no grants under this listing from {s.period.start ?? 'the period searched'} to {s.period.end ?? 'today'}.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { label: 'Grants since ' + (s.period.start ?? '—'), value: s.totalAwards != null ? s.totalAwards.toLocaleString('en-US') : '—', sub: `${s.sampleSize} most recent read` },
                  { label: 'Median award', value: usd(s.amounts?.median), sub: `Middle half ${usd(s.amounts?.p25)} to ${usd(s.amounts?.p75)}` },
                  { label: 'Range', value: `${usd(s.amounts?.min)} – ${usd(s.amounts?.max)}`, sub: `Of the ${s.sampleSize} most recent` },
                  state && s.inState
                    ? { label: `In ${state}`, value: `${s.inState.count} of ${s.sampleSize}`, sub: `${usd(s.inState.usd)} of the most recent awards` }
                    : { label: 'Top state', value: s.topStates[0]?.state ?? '—', sub: s.topStates[0] ? `${s.topStates[0].count} of the ${s.sampleSize} most recent` : 'No state given' },
                ].map((stat) => (
                  <div key={stat.label} className="min-w-0 rounded-xl border border-border bg-background px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                    <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">{stat.value}</dd>
                    <dd className="text-xs text-muted-foreground">{stat.sub}</dd>
                  </div>
                ))}
              </dl>
              {state && s.inState && s.inState.awards.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Recent winners in {state}</p>
                  <AwardRows awards={s.inState.awards} caption={`Recent awards to recipients in ${state}`} />
                </div>
              )}
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Most recent awards</p>
                <AwardRows awards={s.recent} caption={`Most recent awards under Assistance Listing ${l.programNumber}`} />
              </div>
              {l.fetchedAt && (
                <p className="text-xs text-muted-foreground">
                  Read from USAspending on {new Date(l.fetchedAt).toLocaleDateString('en-US')}.{' '}
                  {s.byFiscalYear.length > 0 && `By fiscal year in the awards read: ${s.byFiscalYear.map((y) => `FY${y.fiscalYear} ${y.count}`).join(', ')}.`}
                </p>
              )}
            </>
          )}
        </>
      )}
      {l.status !== 'off' && (
        <a className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" href="https://www.usaspending.gov/search" target="_blank" rel="noreferrer">
          Search all awards on USAspending <ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </section>
  );
}
