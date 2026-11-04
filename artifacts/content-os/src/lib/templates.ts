import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

/** Application templates (api-server routes/grant-templates.ts, docs/GRANT_STUDIO.md). */

export interface AppliesTo {
  applicantKind: 'any' | 'nonprofit' | 'business';
  jurisdiction: 'any' | 'federal' | 'state';
  titleIncludes: string | null;
}

export interface TemplateSection {
  key: string;
  title: string;
  guidance: string;
  limitType: 'words' | 'characters' | 'pages' | null;
  limitValue: number | null;
}

export interface TemplateRequirement {
  kind: string;
  label: string;
  detail: string;
  sectionKey?: string;
}

export interface TemplateSummary {
  key: string;
  label: string;
  description: string | null;
  builtIn: boolean;
  basedOn: string | null;
  appliesTo: AppliesTo;
  status: 'active' | 'archived';
  version: number;
  updatedAt: string | null;
  sectionCount: number;
  requirementCount: number;
}

export interface TemplateDetail extends TemplateSummary {
  sections: TemplateSection[];
  requirements: TemplateRequirement[];
}

export interface TemplateOptions {
  applicantKinds: string[];
  jurisdictions: string[];
  limitTypes: string[];
  requirementKinds: string[];
  limits: Record<string, number>;
}

export const templateKeys = {
  list: ['grants', 'templates'] as const,
  one: (key: string) => ['grants', 'templates', key] as const,
};

export const useTemplates = () => useQuery({ queryKey: templateKeys.list, queryFn: () => apiGet<{ templates: TemplateSummary[]; options: TemplateOptions }>('/grants/templates') });
export const useTemplate = (key: string) => useQuery({ queryKey: templateKeys.one(key), queryFn: () => apiGet<TemplateDetail>(`/grants/templates/${encodeURIComponent(key)}`), enabled: key !== '' });

export function useInvalidateTemplates() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['grants'] });
}

/** The server's list of problems for a template it refused, or the single message. */
export function templateErrors(error: unknown): string[] {
  const text = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{')));
    if (Array.isArray(parsed?.errors) && parsed.errors.length) return parsed.errors.map(String);
    if (parsed?.error) return [String(parsed.error)];
  } catch {
    // not JSON
  }
  return [text.replace(/^(GET|POST|PATCH|PUT|DELETE) \S+ failed: \d+ ?/, '') || 'Something went wrong.'];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

async function put(path: string, body: unknown): Promise<TemplateDetail> {
  const res = await fetch(`${BASE}/api${path}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

export type TemplateDraft = Pick<TemplateDetail, 'label' | 'description' | 'appliesTo' | 'sections' | 'requirements'>;

export const templatesApi = {
  duplicate: (key: string, label?: string) => apiPost(`/grants/templates/${encodeURIComponent(key)}/duplicate`, label ? { label } : {}) as Promise<TemplateDetail>,
  create: (draft: TemplateDraft) => apiPost('/grants/templates', draft) as Promise<TemplateDetail>,
  save: (key: string, draft: TemplateDraft & { version: number }) => put(`/grants/templates/${encodeURIComponent(key)}`, draft),
  archive: (key: string) => apiPost(`/grants/templates/${encodeURIComponent(key)}/archive`) as Promise<TemplateSummary>,
  restore: (key: string) => apiPost(`/grants/templates/${encodeURIComponent(key)}/restore`) as Promise<TemplateSummary>,
};

export const APPLICANT_KIND_LABELS: Record<string, string> = { any: 'Any organization', nonprofit: 'Nonprofits and public bodies', business: 'Businesses' };
export const JURISDICTION_LABELS: Record<string, string> = { any: 'Any program', federal: 'Federal programs', state: 'State programs' };
export const LIMIT_LABELS: Record<string, string> = { words: 'Words', characters: 'Characters', pages: 'Pages' };
export const REQUIREMENT_KIND_LABELS: Record<string, string> = { section: 'Section', criterion: 'Review criterion', attachment: 'Attachment', form: 'Form', eligibility: 'Eligibility', formatting: 'Formatting', deadline: 'Deadline' };

/** One sentence for when a template is chosen automatically. */
export function appliesToText(a: AppliesTo): string {
  const who = APPLICANT_KIND_LABELS[a.applicantKind] ?? a.applicantKind;
  const where = a.jurisdiction === 'any' ? 'any program' : a.jurisdiction === 'federal' ? 'federal programs' : 'state programs';
  return `${who}, ${where}${a.titleIncludes ? `, when the title contains “${a.titleIncludes}”` : ''}`;
}
