import { useMemo, useState } from 'react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-stone-800">Best &amp; worst performers</h3>
        <div className="flex items-center gap-2">
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="px-5 pt-3">
        <Tabs value={dimension} onValueChange={setDimension}>
          <TabsList>
            {DIMENSIONS.map((d) => <TabsTrigger key={d.value} value={d.value}>{d.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      {!isLoading && (data?.excludedSimulatedPublications ?? 0) > 0 && (
        <p className="mx-5 mt-3 text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-3 py-1.5">
          {data!.excludedSimulatedPublications} demo/simulated post{data!.excludedSimulatedPublications === 1 ? '' : 's'} excluded from these rankings — only real, provider-reported performance counts as evidence.
        </p>
      )}
      <div className="p-5 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-stone-400 font-medium mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-green-600" /> Best
          </p>
          {isLoading && <div className="h-24 bg-stone-100 animate-pulse rounded" />}
          {!isLoading && !data?.best.length && <p className="text-xs text-stone-400 py-4">No real data ingested for this dimension yet.</p>}
          <div className="space-y-1.5">
            {data?.best.map((agg) => (
              <div key={agg.label} className="flex items-center justify-between text-sm border border-stone-100 rounded px-3 py-1.5">
                <span className="text-stone-700 truncate">{agg.label}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-semibold text-stone-900">{formatMetricValue(agg.value, metric)}</span>
                  <Badge className="bg-stone-100 text-stone-400 text-[10px]">{agg.publicationCount} post{agg.publicationCount === 1 ? '' : 's'}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-stone-400 font-medium mb-2 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-red-500" /> Worst
          </p>
          {isLoading && <div className="h-24 bg-stone-100 animate-pulse rounded" />}
          {!isLoading && !data?.worst.length && <p className="text-xs text-stone-400 py-4">No real data ingested for this dimension yet.</p>}
          <div className="space-y-1.5">
            {data?.worst.map((agg) => (
              <div key={agg.label} className="flex items-center justify-between text-sm border border-stone-100 rounded px-3 py-1.5">
                <span className="text-stone-700 truncate">{agg.label}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-semibold text-stone-900">{formatMetricValue(agg.value, metric)}</span>
                  <Badge className="bg-stone-100 text-stone-400 text-[10px]">{agg.publicationCount} post{agg.publicationCount === 1 ? '' : 's'}</Badge>
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
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-stone-400" />
        <h3 className="text-sm font-semibold text-stone-800">Published content</h3>
      </div>
      {isLoading && <div className="p-5"><div className="h-24 bg-stone-100 animate-pulse rounded" /></div>}
      {!isLoading && !sorted.length && (
        <p className="text-xs text-stone-400 py-8 text-center">
          No performance data yet. Publish content and connect a destination whose provider supports analytics, then use "Refresh metrics".
        </p>
      )}
      {!isLoading && sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-stone-400 border-b border-stone-100">
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
            <tbody className="divide-y divide-stone-50">
              {sorted.map((row) => (
                <tr key={row.scheduledPublicationId}>
                  <td className="px-5 py-2.5 max-w-[220px] truncate">
                    {row.externalUrl ? (
                      <a href={row.externalUrl} target="_blank" rel="noreferrer" className="text-stone-800 hover:text-[#C8102E] hover:underline">{row.title ?? 'Untitled'}</a>
                    ) : (
                      <span className="text-stone-800">{row.title ?? 'Untitled'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Badge className="bg-stone-100 text-stone-500 text-[10px]">{row.channel}</Badge></td>
                  <td className="px-3 py-2.5 text-stone-500">{row.format}</td>
                  <td className="px-3 py-2.5 text-right text-stone-700">{row.latest.impressions.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right text-stone-700">{row.latest.engagementTotal.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right">
                    {row.snapshotCount > 1 ? (
                      <span className={row.growth.engagementTotal >= 0 ? 'text-green-600' : 'text-red-500'}>
                        {row.growth.engagementTotal >= 0 ? '+' : ''}{row.growth.engagementTotal.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-stone-300">first snapshot</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><Badge className={row.source === 'demo' ? 'bg-amber-50 text-amber-600 text-[10px]' : 'bg-blue-50 text-blue-600 text-[10px]'}>{row.source}</Badge></td>
                  <td className="px-5 py-2.5 text-stone-400 text-xs">{format(new Date(row.latestCapturedAt), 'MMM d, HH:mm')}</td>
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
  pending: 'bg-blue-50 text-blue-600',
  accepted: 'bg-green-50 text-green-700',
  dismissed: 'bg-stone-100 text-stone-400',
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
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-semibold text-stone-800">Recommendations</h3>
      </div>
      <div className="p-4 space-y-2.5">
        {isLoading && <div className="h-16 bg-stone-100 animate-pulse rounded" />}
        {!isLoading && !recommendations?.length && (
          <p className="text-xs text-stone-400 py-4 text-center">
            Not enough real ingested data yet to draw an evidence-backed pattern. Recommendations appear once at least two published pieces have metrics from a real connected provider — demo/simulated metrics never count as evidence.
          </p>
        )}
        {recommendations?.map((rec) => (
          <div key={rec.id} className="border border-stone-100 rounded-md px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-stone-800">{rec.title}</span>
                  <Badge className={STATUS_STYLES[rec.status] ?? 'bg-stone-100'}>{rec.status}</Badge>
                </div>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">{rec.rationale}</p>
                {rec.actedNote && <p className="text-[11px] text-stone-400 mt-1 italic">Note: {rec.actedNote}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {rec.status !== 'accepted' && (
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-green-600" title="Accept" onClick={() => act(rec.id, 'accepted')} disabled={update.isPending}>
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                )}
                {rec.status !== 'dismissed' && (
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-stone-400" title="Dismiss" onClick={() => act(rec.id, 'dismissed')} disabled={update.isPending}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
                {rec.status !== 'pending' && (
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-stone-400" title="Reset" onClick={() => act(rec.id, 'pending')} disabled={update.isPending}>
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
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#111] font-serif">Performance</h1>
          <p className="text-stone-500 mt-1 text-sm">What worked, based only on metrics actually ingested from your connected destinations</p>
        </div>
        <div className="flex items-center gap-2">
          {!brandsLoading && (brands?.length ?? 0) > 1 && (
            <Select value={activeBrandId} onValueChange={setBrandId}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Choose a brand" /></SelectTrigger>
              <SelectContent>
                {brands!.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button onClick={handleRefresh} disabled={ingest.isPending || !activeBrandId} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-1.5">
            {ingest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh metrics
          </Button>
        </div>
      </div>

      {ingestNote && <p className="text-xs text-stone-500 bg-stone-100 border border-stone-200 rounded px-3 py-2 mb-6">{ingestNote}</p>}

      {!brandsLoading && !brands?.length && (
        <div className="text-center py-16 text-stone-400 bg-white border border-dashed border-stone-200 rounded-lg">
          <p className="font-medium text-stone-600">No brands yet</p>
          <p className="text-sm mt-1">Create a brand, publish content, and connect a destination to see performance data here.</p>
        </div>
      )}

      {activeBrandId && (
        <div className="space-y-6">
          <BestWorstPanel brandId={activeBrandId} />
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              <PublicationsTable brandId={activeBrandId} />
            </div>
            <div>
              <RecommendationsPanel brandId={activeBrandId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
