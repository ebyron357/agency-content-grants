/**
 * Grant Studio data layer: typed calls to /api/grants/* plus React Query hooks.
 * The server is the source of truth for every check (matching, limits, budget,
 * compliance); the UI only displays what it returns.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

export type ApplicantType = 'nonprofit_501c3' | 'nonprofit_other' | 'small_business' | 'for_profit';

export interface ReadinessRow {
  kind: string;
  label: string;
  blocking: boolean;
  federal: boolean;
  status: 'missing' | 'in_progress' | 'ready';
  expiresOn: string | null;
  note: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface Readiness {
  items: ReadinessRow[];
  score: number;
  blockingOpen: number;
}

export interface Applicant {
  id: string;
  name: string;
  applicantType: ApplicantType;
  applicantTypeLabel: string;
  ein: string | null;
  uei: string | null;
  state: string | null;
  serviceArea: string | null;
  mission: string | null;
  focusAreas: string[];
  naicsCodes: string[];
  annualBudget: number | null;
  maxCostSharePercent: number;
  readiness: Readiness;
  applicationCount?: number;
  /** New on-topic matches since last marked seen, and on-topic matches closing within 14 days. */
  alerts?: { newMatches: number; closingSoon: number };
  applications?: ApplicationSummary[];
}

export interface Opportunity {
  id: string;
  source: string;
  /** Display name of the source, for example "Grants.gov" or "California Grants Portal". */
  sourceLabel: string;
  /** Null for federal programs; a state code for state programs. */
  jurisdiction: string | null;
  federal: boolean;
  rollingDeadline: boolean;
  costSharePercent: number | null;
  number: string | null;
  title: string;
  agency: string | null;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  daysLeft: number | null;
  awardFloor: number | null;
  awardCeiling: number | null;
  estimatedFunding: number | null;
  costSharing: boolean | null;
  eligibilityCodes: string[];
  eligibilityLabels: string[];
  eligibilityText: string | null;
  categories: string[];
  assistanceListings: string[];
  description: string | null;
  officialUrl: string;
  fetchedAt: string;
  detailFetchedAt: string | null;
}

export interface Match {
  eligible: boolean;
  score: number;
  reasons: string[];
  exclusions: string[];
  gaps: string[];
  matchedTopics: string[];
  missionTerms: string[];
  relevant: boolean;
  daysLeft: number | null;
}

export interface ApplicationSummary {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  outcome: 'submitted' | 'awarded' | 'declined' | 'withdrawn' | null;
  awardedAmount: number | null;
  applicant?: { id: string; name: string };
  opportunity: { id: string; title: string; agency: string | null; closeDate: string | null; daysLeft: number | null };
}

export interface Requirement {
  id: string;
  kind: string;
  label: string;
  detail: string | null;
  sourceRef: string | null;
  sectionKey: string | null;
  points: number | null;
  status: 'open' | 'covered' | 'not_applicable';
  origin: 'template' | 'extracted' | 'manual';
  confirmed: boolean;
}

export interface LimitCheck {
  words: number;
  characters: number;
  pages: number;
  used: number;
  limit: number | null;
  unit: string | null;
  over: boolean;
}

export interface Section {
  id: string;
  key: string;
  title: string;
  guidance: string | null;
  limitType: 'words' | 'characters' | 'pages' | null;
  limitValue: number | null;
  content: string;
  status: 'empty' | 'drafting' | 'ready_for_review' | 'approved';
  demoContent: boolean;
  reviewScore: number | null;
  reviewNotes: string[];
  approvedBy: string | null;
  approvedAt: string | null;
  limitCheck: LimitCheck;
}

export interface BudgetLine {
  id: string;
  category: string;
  description: string;
  quantity: number;
  unitCost: number;
  matchPercent: number;
  justification: string | null;
  total: number;
}

export interface BudgetSummary {
  categories: { category: string; label: string; total: number; requested: number; match: number }[];
  directTotal: number;
  indirectRatePercent: number;
  indirect: number;
  total: number;
  requested: number;
  match: number;
  issues: string[];
}

export interface ComplianceCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface FactCategoryInfo {
  key: string;
  label: string;
  hint: string;
}

export interface Fact {
  id: string;
  applicantId: string;
  category: string;
  categoryLabel: string;
  label: string;
  body: string;
  source: string | null;
  asOf: string | null;
  confirmed: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface Snippet {
  id: string;
  applicantId: string;
  title: string;
  sectionKey: string;
  content: string;
  sourceApplicationId: string | null;
  sourceLabel: string | null;
  savedBy: string;
  words: number;
  preview: string;
  updatedAt: string;
}

export interface Workspace {
  application: {
    id: string;
    title: string;
    status: string;
    template: string;
    requestedAmount: number | null;
    indirectRatePercent: number;
    noticeText: string | null;
    eligibilityConfirmedAt: string | null;
    eligibilityConfirmedBy: string | null;
    eligibilityNote: string | null;
    exportedAt: string | null;
    outcome: 'submitted' | 'awarded' | 'declined' | 'withdrawn' | null;
    outcomeDate: string | null;
    submittedOn: string | null;
    trackingNumber: string | null;
    submittedAmount: number | null;
    awardedAmount: number | null;
    outcomeNote: string | null;
    outcomeRecordedBy: string | null;
  };
  applicant: Applicant;
  opportunity: Opportunity;
  templateLabel: string;
  requirements: Requirement[];
  sections: Section[];
  budgetLines: BudgetLine[];
  budget: BudgetSummary;
  approvals: { id: string; scope: string; role: string; approvedBy: string; note: string | null; createdAt: string }[];
  compliance: { checks: ComplianceCheck[]; readyForApproval: boolean; readyToExport: boolean };
  /** The organization's fact library: confirmed facts and which categories each section draws on. */
  library: { total: number; confirmed: Fact[]; sectionCategories: Record<string, string[]> };
  aiDemo: boolean;
}

export interface GrantMeta {
  applicantTypes: { key: ApplicantType; label: string; kind: 'nonprofit' | 'business' }[];
  budgetCategories: { key: string; label: string }[];
  aiProvider: string;
  sources?: { source: string; label: string; opportunities: number }[];
  aiDemo: boolean;
  opportunities: number;
  lastSync: { status: string; startedAt: string; finishedAt: string | null; fetched: number; error: string | null } | null;
  syncRunning: boolean;
  /** The queued or running refresh (background job), with its progress. */
  syncJob?: { id: string; status: 'queued' | 'running'; progress: { step?: string } | null; runAt: string; attempts: number; lastError: string | null } | null;
}

export const keys = {
  meta: ['grants', 'meta'] as const,
  applicants: ['grants', 'applicants'] as const,
  applicant: (id: string) => ['grants', 'applicant', id] as const,
  matches: (id: string, q: string) => ['grants', 'matches', id, q] as const,
  opportunity: (id: string, applicantId?: string) => ['grants', 'opportunity', id, applicantId ?? ''] as const,
  applications: ['grants', 'applications'] as const,
  workspace: (id: string) => ['grants', 'workspace', id] as const,
  facts: (id: string) => ['grants', 'facts', id] as const,
  snippets: (id: string) => ['grants', 'snippets', id] as const,
};

/** While a refresh is queued or running, re-reads every 5 seconds so progress and new results appear by themselves. */
export const useGrantMeta = () =>
  useQuery({ queryKey: keys.meta, queryFn: () => apiGet<GrantMeta>('/grants/meta'), refetchInterval: (query) => (query.state.data?.syncRunning ? 5000 : false) });

const SYNC_STEPS: Record<string, string> = { 'grants.gov': 'Reading Grants.gov', california: 'Reading the California Grants Portal', alerts: 'Sending match alerts and deadline reminders' };

/** A sentence for the refresh's state, from its background job. */
export function syncStatusText(job: GrantMeta['syncJob']): string | null {
  if (!job) return null;
  if (job.status === 'queued') return job.attempts > 0 ? `The last attempt failed (${job.lastError ?? 'unknown error'}). Trying again at ${new Date(job.runAt).toLocaleTimeString()}.` : 'Refresh queued. It starts within a minute.';
  return `${SYNC_STEPS[job.progress?.step ?? ''] ?? 'Refreshing'}…`;
}
export const useApplicants = () => useQuery({ queryKey: keys.applicants, queryFn: () => apiGet<Applicant[]>('/grants/applicants') });
export const useApplicant = (id: string) => useQuery({ queryKey: keys.applicant(id), queryFn: () => apiGet<Applicant>(`/grants/applicants/${id}`) });
export const useFacts = (id: string) =>
  useQuery({ queryKey: keys.facts(id), queryFn: () => apiGet<{ categories: FactCategoryInfo[]; facts: Fact[] }>(`/grants/applicants/${id}/facts`) });
export const useSnippets = (id: string) => useQuery({ queryKey: keys.snippets(id), queryFn: () => apiGet<Snippet[]>(`/grants/applicants/${id}/snippets`) });
export interface PipelineSummary {
  inProgress: number;
  dueWithin30Days: number;
  awaitingDecision: number;
  awarded: number;
  declined: number;
  withdrawn: number;
  requestedSubmitted: number;
  awardedTotal: number;
  winRate: number | null;
}
export const usePipeline = () => useQuery({ queryKey: ['grants', 'pipeline'], queryFn: () => apiGet<PipelineSummary>('/grants/pipeline') });
export const useApplications = () => useQuery({ queryKey: keys.applications, queryFn: () => apiGet<ApplicationSummary[]>('/grants/applications') });
export interface MatchesResponse {
  total: number;
  relevantTotal: number;
  relevantOnly: boolean;
  newOnly: boolean;
  newTotal: number;
  closingSoonTotal: number;
  hasTopics: boolean;
  /** Focus areas found in most eligible opportunities: too broad to narrow matches. */
  broadTopics: string[];
  newSince: string;
  excluded: number;
  considered: number;
  matches: { opportunity: Opportunity; match: Match; isNew: boolean }[];
}
export const useMatches = (id: string, q: string, relevantOnly = false, newOnly = false) =>
  useQuery({
    queryKey: [...keys.matches(id, q), relevantOnly, newOnly],
    queryFn: () =>
      apiGet<MatchesResponse>(
        `/grants/applicants/${id}/matches?limit=100${relevantOnly ? '&relevantOnly=1' : ''}${newOnly ? '&newOnly=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });
export const useOpportunity = (id: string, applicantId?: string) =>
  useQuery({
    queryKey: keys.opportunity(id, applicantId),
    queryFn: () => apiGet<{ opportunity: Opportunity; match: Match | null; existingApplicationId: string | null; detailError: string | null }>(`/grants/opportunities/${id}${applicantId ? `?applicantId=${encodeURIComponent(applicantId)}` : ''}`),
  });
export const useWorkspace = (id: string) => useQuery({ queryKey: keys.workspace(id), queryFn: () => apiGet<Workspace>(`/grants/applications/${id}`) });

export const grantsApi = {
  createApplicant: (body: Partial<Applicant>) => apiPost('/grants/applicants', body) as Promise<Applicant>,
  updateApplicant: (id: string, body: Partial<Applicant>) => apiPatch(`/grants/applicants/${id}`, body) as Promise<Applicant>,
  deleteApplicant: (id: string) => apiDelete(`/grants/applicants/${id}`),
  createFact: (applicantId: string, body: Record<string, unknown>) => apiPost(`/grants/applicants/${applicantId}/facts`, body) as Promise<Fact>,
  updateFact: (id: string, body: Record<string, unknown>) => apiPatch(`/grants/facts/${id}`, body) as Promise<Fact>,
  deleteFact: (id: string) => apiDelete(`/grants/facts/${id}`),
  saveSectionToLibrary: (sectionId: string, title?: string) => apiPost(`/grants/sections/${sectionId}/save-to-library`, title ? { title } : {}) as Promise<Snippet>,
  insertSnippet: (sectionId: string, snippetId: string, mode: 'replace' | 'append') => apiPost(`/grants/sections/${sectionId}/insert-snippet`, { snippetId, mode }),
  renameSnippet: (id: string, title: string) => apiPatch(`/grants/snippets/${id}`, { title }) as Promise<Snippet>,
  deleteSnippet: (id: string) => apiDelete(`/grants/snippets/${id}`),
  recordOutcome: (applicationId: string, body: { outcome: string; date?: string | null; trackingNumber?: string | null; awardedAmount?: number | null; note?: string | null }) => apiPost(`/grants/applications/${applicationId}/outcome`, body),
  undoOutcome: (applicationId: string) => apiDelete(`/grants/applications/${applicationId}/outcome`),
  markMatchesSeen: (id: string) => apiPost(`/grants/applicants/${id}/matches/seen`, {}) as Promise<{ matchesSeenAt: string }>,
  setReadiness: (id: string, kind: string, body: { status: string; expiresOn: string | null; note: string | null }) => apiPut(`/grants/applicants/${id}/readiness/${kind}`, body) as Promise<Readiness>,
  startApplication: (body: { applicantId: string; opportunityId: string; eligibilityConfirmed: boolean; eligibilityNote?: string }) => apiPost('/grants/applications', body) as Promise<{ id: string; existing: boolean }>,
  updateApplication: (id: string, body: Record<string, unknown>) => apiPatch(`/grants/applications/${id}`, body) as Promise<Workspace>,
  deleteApplication: (id: string) => apiDelete(`/grants/applications/${id}`),
  addRequirement: (id: string, body: Partial<Requirement>) => apiPost(`/grants/applications/${id}/requirements`, body),
  updateRequirement: (rid: string, body: Partial<Requirement>) => apiPatch(`/grants/requirements/${rid}`, body),
  deleteRequirement: (rid: string) => apiDelete(`/grants/requirements/${rid}`),
  confirmAll: (id: string) => apiPost(`/grants/applications/${id}/requirements/confirm-all`) as Promise<Workspace>,
  extract: (id: string, noticeText: string) => apiPost(`/grants/applications/${id}/requirements/extract`, { noticeText }) as Promise<{ added: number; demo: boolean; message: string | null }>,
  updateSection: (sid: string, body: Partial<Section>) => apiPatch(`/grants/sections/${sid}`, body) as Promise<Section>,
  draftSection: (sid: string) => apiPost(`/grants/sections/${sid}/draft`) as Promise<{ section: Section; demo: boolean; message: string | null }>,
  reviewSection: (sid: string) => apiPost(`/grants/sections/${sid}/review`) as Promise<{ section: Section; demo: boolean; message: string | null }>,
  approveSection: (sid: string) => apiPost(`/grants/sections/${sid}/approve`) as Promise<Section>,
  reopenSection: (sid: string) => apiPost(`/grants/sections/${sid}/reopen`) as Promise<Section>,
  addBudgetLine: (id: string, body: Partial<BudgetLine>) => apiPost(`/grants/applications/${id}/budget-lines`, body),
  updateBudgetLine: (lid: string, body: Partial<BudgetLine>) => apiPatch(`/grants/budget-lines/${lid}`, body),
  deleteBudgetLine: (lid: string) => apiDelete(`/grants/budget-lines/${lid}`),
  budgetJustification: (id: string) => apiPost(`/grants/applications/${id}/budget-justification`) as Promise<Section>,
  approvePackage: (id: string, note: string) => apiPost(`/grants/applications/${id}/approve-package`, { confirmAuthorized: true, note: note || undefined }) as Promise<Workspace>,
  sync: () => apiPost('/grants/sync') as Promise<{ status: string; jobId: string }>,
};

async function apiPut(path: string, body: unknown) {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Calendar (.ics) downloads: one application, one opportunity, or every open application. */
export function calendarUrl(kind: 'application' | 'opportunity' | 'all', id?: string): string {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (kind === 'all') return `${BASE}/api/grants/calendar.ics`;
  return `${BASE}/api/grants/${kind === 'application' ? 'applications' : 'opportunities'}/${id}/deadline.ics`;
}

export function packageUrl(id: string, draft: boolean): string {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${BASE}/api/grants/applications/${id}/package.docx${draft ? '?draft=1' : ''}`;
}

/** Pulls the server's { error } message out of an api helper failure. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const json = text.slice(text.indexOf('{'));
  try {
    const parsed = JSON.parse(json);
    if (parsed?.error) return String(parsed.error);
  } catch {
    // not JSON
  }
  return text.replace(/^(GET|POST|PATCH|PUT|DELETE) \S+ failed: \d+ ?/, '') || 'Something went wrong.';
}

export function useInvalidateGrants() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['grants'] });
}

export function useGrantMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const invalidate = useInvalidateGrants();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}

export const usd = (value: number | null | undefined) =>
  value == null ? '—' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function awardRange(o: Pick<Opportunity, 'awardFloor' | 'awardCeiling'>): string {
  if (o.awardFloor && o.awardCeiling) return `${usd(o.awardFloor)} – ${usd(o.awardCeiling)}`;
  if (o.awardCeiling) return `Up to ${usd(o.awardCeiling)}`;
  if (o.awardFloor) return `From ${usd(o.awardFloor)}`;
  return 'Award amount not stated';
}

export function deadlineLabel(o: Pick<Opportunity, 'closeDate' | 'daysLeft' | 'status'> & { rollingDeadline?: boolean }): string {
  if (!o.closeDate) {
    if (o.rollingDeadline) return 'Rolling: open until funds run out';
    return o.status === 'forecasted' ? 'Forecast: date to be announced' : 'Closing date not stated';
  }
  if (o.daysLeft === 0) return `Closes today (${o.closeDate})`;
  if (o.daysLeft != null && o.daysLeft > 0) return `Closes in ${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'} · ${o.closeDate}`;
  return `Closed ${o.closeDate}`;
}
