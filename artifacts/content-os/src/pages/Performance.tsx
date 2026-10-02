import { Link } from 'wouter';
import { useMemo, useState } from 'react';
import { PageHeader, PageShell } from '@/components/layout/Page';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListBrands,
  useListPerformanceRows,
  useGetPerformanceBestWorst,
  useListPerformanceRecommendations,
  useUpdatePerformanceRecommendation,
  useTriggerPerformanceIngest,
  getListPerformanceRowsQueryKey,
  getGetPerformanceBestWorstQueryKey,
  getListPerformanceRecommendationsQueryKey,
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import {
  RefreshCw, Loader2, TrendingUp, TrendingDown, Lightbulb, Check, X, RotateCcw, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const DIMENSIONS = [
  { value: 'channel', label: 'Channel' },
  { value: 'format', label: 'Format' },
  { value: 'topic', label: 'Topic' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'brand', label: 'Brand' },
] as const;

const METRICS = [
  { value: 'engagementTotal', label: 'Engagement' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'engagementRate', label: 'Engagement rate' },
  { value: 'likes', label: 'Likes' },
] as const;

function formatMetricValue(value: number, metric: string): string {
  if (metric === 'engagementRate') return `${(value * 100).toFixed(1)}%`;
  return Math.round(value).toLocaleString();
}

// ─── Best / worst performers ──────────────────────────────────────────────────

function BestWorstPanel({ brandId }: { brandId: string }) {
  const [dimension, setDimension] = useState<string>('channel');
  const [metric, setMetric] = useState<string>('engagementTotal');
  const { data, isLoading } = useGetPerformanceBestWorst({ brandId, dimension, metric }, {
    query: { queryKey: getGetPerformanceBestWorstQueryKey({ brandId, dimension, metric }), enabled: !!brandId },
  });

  return (
    <div className="bg-card border border-border rounded-2xl">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-foreground">Best &amp; worst performers</h2>
        <div className="flex items-center gap-2">
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-9 w-40 text-xs" aria-label="Metric"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="px-5 pt-3">
        <div role="group" aria-label="Rank by" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-background/40 p-1">
          {DIMENSIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={dimension === d.value}
              onClick={() => setDimension(d.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${dimension === d.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {!isLoading && (data?.excludedSimulatedPublications ?? 0) > 0 && (
        <p className="mx-5 mt-3 text-[11px] text-amber-300 bg-amber-400/10 border border-amber-400/25 rounded px-3 py-1.5">
          {data!.excludedSimulatedPublications} demo/simulated post{data!.excludedSimulatedPublications === 1 ? '' : 's'} excluded from these rankings — only real, provider-reported performance counts as evidence.
        </p>
      )}
      <div className="grid grid-cols-1 gap-6 p-5 sm:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-300" /> Best
          </p>
          {isLoading && <div className="h-24 bg-muted animate-pulse rounded" />}
          {!isLoading && !data?.best.length && <p className="text-xs text-muted-foreground py-4">No real data ingested for this dimension yet.</p>}
          <div className="space-y-1.5">
            {data?.best.map((agg) => (
              <div key={agg.label} className="flex items-center justify-between text-sm border border-border rounded px-3 py-1.5">
                <span className="text-foreground/85 truncate">{agg.label}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-semibold text-foreground">{formatMetricValue(agg.value, metric)}</span>
                  <Badge className="bg-muted text-muted-foreground text-[10px]">{agg.publicationCount} post{agg.publicationCount === 1 ? '' : 's'}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-red-300" /> Worst
          </p>
          {isLoading && <div className="h-24 bg-muted animate-pulse rounded" />}
          {!isLoading && !data?.worst.length && <p className="text-xs text-muted-foreground py-4">No real data ingested for this dimension yet.</p>}
          <div className="space-y-1.5">
            {data?.worst.map((agg) => (
              <div key={agg.label} className="flex items-center justify-between text-sm border border-border rounded px-3 py-1.5">
                <span className="text-foreground/85 truncate">{agg.label}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-semibold text-foreground">{formatMetricValue(agg.value, metric)}</span>
                  <Badge className="bg-muted text-muted-foreground text-[10px]">{agg.publicationCount} post{agg.publicationCount === 1 ? '' : 's'}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Published content table (trend / latest metrics) ─────────────────────────

function PublicationsTable({ brandId }: { brandId: string }) {
  const { data: rows, isLoading } = useListPerformanceRows({ brandId }, {
    query: { queryKey: getListPerformanceRowsQueryKey({ brandId }), enabled: !!brandId },
  });
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => b.latest.engagementTotal - a.latest.engagementTotal), [rows]);

  return (
    <div className="bg-card border border-border rounded-2xl">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Published content</h2>
      </div>
      {isLoading && <div className="p-5"><div className="h-24 bg-muted animate-pulse rounded" /></div>}
      {!isLoading && !sorted.length && (
        <p className="text-xs text-muted-foreground py-8 text-center">
          No performance data yet. Publish content and connect a destination whose provider supports analytics, then use "Refresh metrics".
        </p>
      )}
      {!isLoading && sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-5 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium text-right">Impressions</th>
                <th className="px-3 py-2 font-medium text-right">Engagement</th>
                <th className="px-3 py-2 font-medium text-right">Growth</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-5 py-2 font-medium">Last checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row) => (
                <tr key={row.scheduledPublicationId}>
                  <td className="px-5 py-2.5 max-w-[220px] truncate">
                    {row.externalUrl ? (
                      <a href={row.externalUrl} target="_blank" rel="noreferrer" className="text-foreground hover:text-brand hover:underline">{row.title ?? 'Untitled'}</a>
                    ) : (
                      <span className="text-foreground">{row.title ?? 'Untitled'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Badge className="bg-muted text-muted-foreground text-[10px]">{row.channel}</Badge></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.format}</td>
                  <td className="px-3 py-2.5 text-right text-foreground/85">{row.latest.impressions.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-foreground/85">{row.latest.engagementTotal.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">
                    {row.snapshotCount > 1 ? (
                      <span className={row.growth.engagementTotal >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                        {row.growth.engagementTotal >= 0 ? '+' : ''}{row.growth.engagementTotal.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">first snapshot</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Badge className={row.source === 'demo' ? 'bg-amber-400/10 text-amber-300 text-[10px]' : 'bg-sky-400/10 text-sky-300 text-[10px]'}>{row.source}</Badge></td>
                  <td className="px-5 py-2.5 text-muted-foreground text-xs">{format(new Date(row.latestCapturedAt), 'MMM d, HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Recommendations ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-sky-400/10 text-sky-300',
  accepted: 'bg-emerald-400/10 text-emerald-300',
  dismissed: 'bg-muted text-muted-foreground',
};

function RecommendationsPanel({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const { data: recommendations, isLoading } = useListPerformanceRecommendations({ brandId }, {
    query: { queryKey: getListPerformanceRecommendationsQueryKey({ brandId }), enabled: !!brandId },
  });
  const update = useUpdatePerformanceRecommendation();

  const act = async (id: string, status: 'accepted' | 'dismissed' | 'pending') => {
    await update.mutateAsync({ id, data: { status } });
    qc.invalidateQueries({ queryKey: getListPerformanceRecommendationsQueryKey({ brandId }) });
  };

  return (
    <div className="bg-card border border-border rounded-2xl">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-300" />
        <h2 className="text-sm font-semibold text-foreground">Recommendations</h2>
      </div>
      <div className="p-4 space-y-2.5">
        {isLoading && <div className="h-16 bg-muted animate-pulse rounded" />}
        {!isLoading && !recommendations?.length && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            Not enough real ingested data yet to draw an evidence-backed pattern. Recommendations appear once at least two published pieces have metrics from a real connected provider — demo/simulated metrics never count as evidence.
          </p>
        )}
        {recommendations?.map((rec) => (
          <div key={rec.id} className="border border-border rounded-md px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{rec.title}</span>
                  <Badge className={STATUS_STYLES[rec.status] ?? 'bg-muted'}>{rec.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.rationale}</p>
                {rec.actedNote && <p className="text-[11px] text-muted-foreground mt-1 italic">Note: {rec.actedNote}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {rec.status !== 'accepted' && (
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-emerald-300" title="Accept" onClick={() => act(rec.id, 'accepted')} disabled={update.isPending}>
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                )}
                {rec.status !== 'dismissed' && (
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-muted-foreground" title="Dismiss" onClick={() => act(rec.id, 'dismissed')} disabled={update.isPending}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
                {rec.status !== 'pending' && (
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-muted-foreground" title="Reset" onClick={() => act(rec.id, 'pending')} disabled={update.isPending}>
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function Performance() {
  const qc = useQueryClient();
  const { data: brands, isLoading: brandsLoading } = useListBrands();
  const [brandId, setBrandId] = useState<string>('');
  const activeBrandId = brandId || brands?.[0]?.id || '';
  const ingest = useTriggerPerformanceIngest();
  const [ingestNote, setIngestNote] = useState<string | null>(null);

  const handleRefresh = async () => {
    setIngestNote(null);
    try {
      const result = await ingest.mutateAsync({ data: { brandId: activeBrandId || undefined } });
      setIngestNote(
        result.snapshotsInserted > 0
          ? `Ingested ${result.snapshotsInserted} new snapshot${result.snapshotsInserted === 1 ? '' : 's'} across ${result.destinationsChecked} destination${result.destinationsChecked === 1 ? '' : 's'}.`
          : `Checked ${result.destinationsChecked} destination${result.destinationsChecked === 1 ? '' : 's'} — no new data available from the provider right now.`,
      );
      qc.invalidateQueries({ queryKey: getListPerformanceRowsQueryKey({ brandId: activeBrandId }) });
      qc.invalidateQueries({ queryKey: getGetPerformanceBestWorstQueryKey() });
      qc.invalidateQueries({ queryKey: getListPerformanceRecommendationsQueryKey({ brandId: activeBrandId }) });
    } catch (err: any) {
      setIngestNote(err?.data?.error ?? err?.message ?? 'Could not refresh metrics.');
    }
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Performance"
        title="Performance"
        description="What worked, based only on metrics actually ingested from connected destinations. Nothing here is estimated or simulated."
        actions={
          <>
            {!brandsLoading && (brands?.length ?? 0) > 1 && (
              <Select value={activeBrandId} onValueChange={setBrandId}>
                <SelectTrigger className="w-52" aria-label="Brand"><SelectValue placeholder="Choose a brand" /></SelectTrigger>
                <SelectContent>
                  {brands!.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button onClick={handleRefresh} disabled={ingest.isPending || !activeBrandId} className="gap-1.5">
              {ingest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh metrics
            </Button>
          </>
        }
      />

      {ingestNote && <p role="status" className="mb-6 rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{ingestNote}</p>}

      {!brandsLoading && !brands?.length && (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-semibold text-foreground">No brands yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Performance appears after a brand publishes to a connected destination and metrics are ingested.</p>
          <Link href="/brands" className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Add a brand</Link>
        </div>
      )}

      {activeBrandId && (
        <div className="space-y-6">
          <BestWorstPanel brandId={activeBrandId} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <PublicationsTable brandId={activeBrandId} />
            </div>
            <div>
              <RecommendationsPanel brandId={activeBrandId} />
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
