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

/** Form 990-PF Part XIV line 2, with the tax year it came from. "unknown" is never a guess either way. */
export interface ApplicationPolicy {
  status: 'invitation_only' | 'accepts_applications' | 'unknown';
  label: string;
  taxYear: number | null;
  objectId: string | null;
  detail: string;
}

export interface FilingLinks {
  objectId: string | null;
  irsDownloads: string;
  propublica: string | null;
  note: string;
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
  /** Absent from responses of servers older than this field. */
  applicationPolicy?: ApplicationPolicy;
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
  applicationInfo?: { formAndMaterials?: string; deadlines?: string; restrictions?: string };
  applicationPolicyFiling?: (FilingLinks & { taxYear: number | null; taxPeriodEnd: string | null }) | null;
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
    filing: FilingLinks;
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

export interface MatchComponent {
  key: 'state' | 'cause' | 'size' | 'recency' | 'consistency';
  label: string;
  points: number;
  max: number;
  reason: string;
}

export interface Suggestion extends FunderSummary {
  inStateUsd: number;
  reasons: string[];
  score?: number;
  components?: MatchComponent[];
  cautions?: string[];
  causeUsd?: number;
  filing?: FilingLinks;
  filings?: { taxPeriodEnd: string; objectId: string }[];
}

export interface Suggestions {
  label: string;
  state: string | null;
  causes: { key: string; label: string; from: string }[];
  causesFromProfile?: { key: string; label: string; from: string }[];
  annualBudget?: number | null;
  requestUsd?: number | null;
  latestDataYear?: number;
  note: string;
  missing?: string;
  suggestions: Suggestion[];
}

export interface SuggestionParams {
  /** NTEE major group letter; empty uses the organization's profile. */
  cause: string;
  /** Whole dollars, as typed; empty compares with the annual budget. */
  request: string;
  hideInvitationOnly: boolean;
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
/** A typed request amount in whole dollars, or null when it is empty or not a positive number. */
export function requestAmount(text: string): number | null {
  const amount = text.replace(/[$,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 ? Math.round(Number(amount)) : null;
}

function suggestionQuery(p: SuggestionParams): string {
  const s = new URLSearchParams();
  if (p.cause) s.set('cause', p.cause);
  const amount = requestAmount(p.request);
  if (amount) s.set('request', String(amount));
  if (p.hideInvitationOnly) s.set('hideInvitationOnly', 'true');
  const text = s.toString();
  return text ? `?${text}` : '';
}

export const NO_SUGGESTION_FILTERS: SuggestionParams = { cause: '', request: '', hideInvitationOnly: false };

export const useFoundationSuggestions = (applicantId: string, p: SuggestionParams = NO_SUGGESTION_FILTERS) =>
  useQuery({
    queryKey: ['foundations', 'suggestions', applicantId, p],
    queryFn: () => apiGet<Suggestions>(`/grants/applicants/${encodeURIComponent(applicantId)}/foundation-suggestions${suggestionQuery(p)}`),
    enabled: applicantId !== '',
  });

export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);

export function years(first: number | null, last: number | null): string {
  if (!first || !last) return 'Years not recorded';
  return first === last ? `Tax year ${last}` : `Tax years ${first}–${last}`;
}

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];
