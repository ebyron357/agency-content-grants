import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

/** Past federal awards per Assistance Listing (api-server routes/past-awards.ts, docs/GRANT_STUDIO.md). */

export interface PastAward {
  awardId: string | null;
  generatedId: string | null;
  recipient: string;
  amountUsd: number;
  startDate: string | null;
  fiscalYear: number | null;
  state: string | null;
  url: string | null;
}

export interface ListingSummary {
  totalAwards: number | null;
  period: { start: string | null; end: string | null };
  sampleSize: number;
  amounts: { min: number; p25: number; median: number; p75: number; max: number; total: number } | null;
  byFiscalYear: { fiscalYear: number; count: number; usd: number }[];
  topStates: { state: string; count: number; usd: number }[];
  inState: { state: string; count: number; usd: number; awards: PastAward[] } | null;
  recent: PastAward[];
}

export interface PastAwardListing {
  programNumber: string;
  label: string;
  /** ready; stale (an older copy, refreshing or after a failed read); loading (first read under way); unavailable (never read: USAspending unreachable); off */
  status: 'ready' | 'stale' | 'loading' | 'unavailable' | 'off';
  message: string | null;
  fetchedAt: string | null;
  summary: ListingSummary | null;
}

export interface PastAwards {
  label: string;
  source: { name: string; url: string; api: string; terms: string; note: string };
  applicable: boolean;
  reason: string | null;
  state: string | null;
  listings: PastAwardListing[];
}

export const usePastAwards = (opportunityId: string, applicantId: string) =>
  useQuery({
    queryKey: ['grants', 'past-awards', opportunityId, applicantId],
    queryFn: () => apiGet<PastAwards>(`/grants/opportunities/${encodeURIComponent(opportunityId)}/past-awards${applicantId ? `?applicantId=${encodeURIComponent(applicantId)}` : ''}`),
    enabled: opportunityId !== '',
    // A first read still under way is checked again shortly; nothing else polls.
    refetchInterval: (q) => (q.state.data?.listings.some((l) => l.status === 'loading') ? 5_000 : false),
    staleTime: 5 * 60_000,
  });
