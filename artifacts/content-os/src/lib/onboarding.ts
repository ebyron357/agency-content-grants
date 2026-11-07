import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import type { ApplicantType } from '@/lib/grants';

/** Self sign-up and onboarding (api-server routes/signup.ts and routes/onboarding.ts). */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface OnboardingStep {
  key: 'organization' | 'matches' | 'application' | 'team';
  title: string;
  description: string;
  done: boolean;
  href: string;
}

export interface OnboardingState {
  workspace: { name: string; createdVia: string } | null;
  dismissed: boolean;
  complete: boolean;
  steps: OnboardingStep[];
  organizations: { id: string; name: string }[];
  applicantTypes: { key: ApplicantType; label: string; kind: string }[];
  focusAreas: { general: string[]; byCause: { key: string; label: string; areas: string[] }[] };
  lookup: { available: boolean; source: LookupSource };
}

export interface LookupSource {
  name: string;
  api: string;
  terms: string;
  attribution: string;
}

export interface Prefill {
  name: string;
  principalAddress: string | null;
  state: string | null;
  ntee: string | null;
  revenue: number | null;
  revenueBand: string | null;
  revenueYear: number | null;
  applicantType: ApplicantType;
  subsection: string | null;
}

export type LookupResult =
  | { status: 'found'; ein: string; einFormatted: string; cached: boolean; fetchedAt: string; organization: { profileUrl: string; nteeGroup: string | null }; prefill: Prefill; suggestedFocusAreas: string[]; source: LookupSource }
  | { status: 'not_found' | 'unavailable'; ein: string; einFormatted: string; message: string; source: LookupSource };

export interface CreatedOrganization {
  applicant: { id: string; name: string; applicantType: ApplicantType; ein: string | null; state: string | null; focusAreas: string[] };
  facts: { confirmed: number; unconfirmed: number };
  lookedUp: boolean;
}

export const onboardingKey = ['onboarding'] as const;

export const useOnboarding = () => useQuery({ queryKey: onboardingKey, queryFn: () => apiGet<OnboardingState>('/onboarding') });

export function useInvalidateOnboarding() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: onboardingKey }), qc.invalidateQueries({ queryKey: ['grants'] })]);
}

export const onboardingApi = {
  lookup: (ein: string) => apiGet<LookupResult>(`/onboarding/lookup/${encodeURIComponent(ein)}`),
  createOrganization: (body: Record<string, unknown>) => apiPost('/onboarding/organization', body) as Promise<CreatedOrganization>,
  setDismissed: async (dismissed: boolean) => {
    const res = await fetch(`${BASE}/api/onboarding/dismissed`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissed }) });
    if (!res.ok) throw new Error(`PUT /onboarding/dismissed failed: ${res.status} ${await res.text().catch(() => '')}`);
    return res.json() as Promise<{ dismissed: boolean }>;
  },
};

/** Public sign-up calls run signed out, so they use fetch directly. Whether sign-up is open comes from /auth/me (hooks/use-auth.ts). */
export async function postJson(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

/** "123456789" or "12-3456789" → "12-3456789" as the person types. */
export function formatEinInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

export function durationLabel(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m} minute${m === 1 ? '' : 's'}${rest ? ` ${rest} second${rest === 1 ? '' : 's'}` : ''}`;
}
