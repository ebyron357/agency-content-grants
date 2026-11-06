import { Link, useParams } from 'wouter';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/grants/GrantUi';
import { errorMessage } from '@/lib/grants';
import { HISTORY_LABEL, useFunder, usd, years, type Share } from '@/lib/foundations';

/** One funder's giving history, with its source filing. */
export default function GrantFunder() {
  const { ein = '' } = useParams<{ ein: string }>();
  const q = useFunder(ein);
  if (q.isLoading) return <LoadingState label="Loading funder…" />;
  if (q.isError || !q.data) {
    return (
      <PageShell width="default">
        <StateMessage tone="error" title="This funder could not load" description={errorMessage(q.error)} action={<Button asChild><Link href="/grant-studio/foundations">All foundations</Link></Button>} />
      </PageShell>
    );
  }
  const f = q.data;
  const s = f.source;
  return (
    <PageShell width="default">
      <Link href="/grant-studio/foundations" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Foundations
      </Link>
      <PageHeader
        eyebrow="Foundation"
        title={f.name}
        description={`EIN ${f.einFormatted}${f.state ? ` · ${f.state}` : ''} · Form ${f.formType === '990PF' ? '990-PF' : f.formType} · ${years(f.firstTaxYear, f.lastTaxYear)}`}
      />
      <div className="mb-6">
        <Notice tone="warn" title={HISTORY_LABEL}>
          These are grants the funder reported paying. They show what it has funded, not that it is accepting applications. Check its own instructions before you approach it.
        </Notice>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Grants paid', value: usd(f.totalPaidUsd), sub: `${f.grantCount.toLocaleString('en-US')} grants to organizations` },
          { label: 'Median grant', value: usd(f.grantSize.median), sub: `Middle half ${usd(f.grantSize.p25)} to ${usd(f.grantSize.p75)}` },
          { label: 'Largest grant', value: usd(f.grantSize.max), sub: `Smallest ${usd(f.grantSize.min)}` },
          { label: 'Latest filing', value: s.latestTaxYear ? `Tax year ${s.latestTaxYear}` : '—', sub: s.latestSubmittedOn ? `Filed ${s.latestSubmittedOn}` : 'Filing date not recorded' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{stat.value}</dd>
            <dd className="text-xs text-muted-foreground">{stat.sub}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-3 mb-6 text-xs text-muted-foreground">Grant sizes are estimated from a size histogram (within about a quarter of the true value). Grants to individuals and grants approved for future payment are not counted.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Giving by year" description="By the tax year the grants were paid in." />
          <ShareTable caption="Giving by year" heading="Tax year" rows={f.givingByYear.map((y) => ({ key: String(y.year), label: String(y.year), usd: y.usd, share: f.totalPaidUsd ? Math.round((y.usd / f.totalPaidUsd) * 1000) / 10 : 0 }))} />
        </Panel>
        <Panel>
          <PanelHeader title="Giving by recipient state" />
          <ShareTable caption="Giving by recipient state" heading="State" rows={f.givingByState} />
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Giving by cause"
            description={`NTEE major groups. ${f.causeBasis.fromNtee.toLocaleString('en-US')} grants classified from the recipient’s NTEE code, ${f.causeBasis.fromPurpose.toLocaleString('en-US')} from the grant purpose text (approximate), ${f.causeBasis.unclassified.toLocaleString('en-US')} not classified.`}
          />
          <ShareTable caption="Giving by cause" heading="Cause" rows={f.givingByCause} />
        </Panel>
      </div>

      <Panel className="mt-6">
        <PanelHeader title="Largest recent grants" description="The largest grants to organizations in the funder’s latest three tax years with grants listed." />
        {f.recentGrants.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No grants to named organizations are stored for this funder.</p>
        ) : (
          <ul className="divide-y divide-border">
            {f.recentGrants.map((g) => (
              <li key={`${g.objectId}-${g.recipientName}-${g.amountUsd}`} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{g.recipientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {[g.recipientCity, g.recipientState === 'foreign' ? 'Outside the US' : g.recipientState].filter(Boolean).join(', ')}
                    {g.recipientEin ? ` · EIN ${g.recipientEin}` : ''} · tax year {g.taxYear}{g.cause ? ` · ${g.cause}` : ''}
                  </p>
                  {g.purpose && <p className="mt-0.5 text-xs text-muted-foreground">Purpose as filed: {g.purpose}</p>}
                </div>
                <p className="shrink-0 text-sm tabular-nums text-foreground">{usd(g.amountUsd)}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelHeader title="Source" icon={<FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} />
        <div className="space-y-3 px-5 py-4 text-sm text-muted-foreground">
          <p>
            From <a className="text-foreground underline underline-offset-4" href={s.repo} target="_blank" rel="noreferrer">{s.name}</a>
            {s.datasetVersion ? `, dataset ${s.datasetVersion}` : ''}, derived from {s.derivedFrom}. Latest filing counted: tax year {s.latestTaxYear ?? '—'}
            {s.latestTaxPeriodEnd ? ` (period ending ${s.latestTaxPeriodEnd})` : ''}, IRS object id <span className="font-mono text-xs text-foreground">{s.filing.objectId ?? '—'}</span>.
          </p>
          <p className="text-xs">{s.filing.note}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary" className="gap-1.5">
              <a href={s.filing.irsDownloads} target="_blank" rel="noreferrer">IRS Form 990 downloads <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
            </Button>
            {s.filing.propublica && (
              <Button asChild size="sm" variant="secondary" className="gap-1.5">
                <a href={s.filing.propublica} target="_blank" rel="noreferrer">Filings on ProPublica Nonprofit Explorer <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a>
              </Button>
            )}
          </div>
          {f.filings.length > 1 && (
            <details>
              <summary className="cursor-pointer text-xs text-foreground">All {f.filings.length} filings counted</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {f.filings.map((x) => <li key={x.objectId}>Period ending {x.taxPeriodEnd}: <span className="font-mono">{x.objectId}</span></li>)}
              </ul>
            </details>
          )}
        </div>
      </Panel>
    </PageShell>
  );
}

function ShareTable({ rows, caption, heading }: { rows: Share[]; caption: string; heading: string }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-muted-foreground">Nothing recorded.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="px-5 py-2 font-medium">{heading}</th>
          <th scope="col" className="px-5 py-2 text-right font-medium">Paid</th>
          <th scope="col" className="px-5 py-2 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className="px-5 py-2 text-left font-normal text-foreground">{r.label}</th>
            <td className="px-5 py-2 text-right tabular-nums text-foreground">{usd(r.usd)}</td>
            <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">{r.share}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
