import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

/** Foundation giving history (api-server routes/foundations.ts, docs/GRANT_STUDIO.md). */

export const HISTORY_LABEL = 'Funding history from tax filings, not an open call';

export interface Share {
  key: string;
  label: string;
  usd: number;
  share: number;
}

export interface FunderSummary {
  ein: string;
  einFormatted: string;
  name: string;
  state: string | null;
  formType: string;
  totalPaidUsd: number;
  grantCount: number;
  firstTaxYear: number | null;
  lastTaxYear: number | null;
  medianGrantUsd: number | null;
  topCauses: Share[];
  label: string;
}

export interface FunderSearch {
  label: string;
  total: number;
  page: number;
  pageSize: number;
  funders: FunderSummary[];
}

export interface FunderProfile extends FunderSummary {
  givingByYear: { year: number; usd: number }[];
  givingByState: Share[];
  givingByCause: Share[];
  causeBasis: { fromNtee: number; fromPurpose: number; unclassified: number; classifiedShare: number };
  grantSize: { count?: number; min?: number; max?: number; p25?: number; median?: number; p75?: number };
  recentGrants: { recipientName: string; recipientCity: string | null; recipientState: string | null; recipientEin: string | null; amountUsd: number; taxYear: number; purpose: string | null; cause: string | null; objectId: string }[];
  filings: { taxPeriodEnd: string; objectId: string }[];
  source: {
    name: string;
    repo: string;
    license: string;
    irsDownloads: string;
    derivedFrom: string;
    datasetVersion: string | null;
    latestTaxYear: number | null;
    latestTaxPeriodEnd: string | null;
    latestSubmittedOn: string | null;
    filing: { objectId: string | null; irsDownloads: string; propublica: string | null; note: string };
    updatedAt: string;
  };
}

export interface FoundationMeta {
  label: string;
  source: { name: string; repo: string; license: string };
  causes: { key: string; label: string }[];
  funders: number;
  lastImport: { status: string; startedAt: string; finishedAt: string | null; datasetVersion: string | null; yearsDone: number[]; minConfidence: number; note: string | null; error: string | null } | null;
  importJob: { id: string; status: string } | null;
}

export interface Suggestions {
  label: string;
  state: string | null;
  causes: { key: string; label: string; from: string }[];
  note: string;
  missing?: string;
  suggestions: (FunderSummary & { inStateUsd: number; reasons: string[] })[];
}

export interface SearchParams {
  q: string;
  givesIn: string;
  cause: string;
  page: number;
}

function query(p: SearchParams): string {
  const s = new URLSearchParams();
  if (p.q.trim()) s.set('q', p.q.trim());
  if (p.givesIn) s.set('givesIn', p.givesIn);
  if (p.cause) s.set('cause', p.cause);
  if (p.page > 1) s.set('page', String(p.page));
  const text = s.toString();
  return text ? `?${text}` : '';
}

export const useFoundationMeta = () => useQuery({ queryKey: ['foundations', 'meta'], queryFn: () => apiGet<FoundationMeta>('/grants/foundations/meta') });
export const useFunderSearch = (p: SearchParams) => useQuery({ queryKey: ['foundations', 'search', p], queryFn: () => apiGet<FunderSearch>(`/grants/foundations${query(p)}`) });
export const useFunder = (ein: string) => useQuery({ queryKey: ['foundations', 'funder', ein], queryFn: () => apiGet<FunderProfile>(`/grants/foundations/${encodeURIComponent(ein)}`), enabled: ein !== '' });
export const useFoundationSuggestions = (applicantId: string) =>
  useQuery({ queryKey: ['foundations', 'suggestions', applicantId], queryFn: () => apiGet<Suggestions>(`/grants/applicants/${encodeURIComponent(applicantId)}/foundation-suggestions`), enabled: applicantId !== '' });

export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);

export function years(first: number | null, last: number | null): string {
  if (!first || !last) return 'Years not recorded';
  return first === last ? `Tax year ${last}` : `Tax years ${first}–${last}`;
}

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];
