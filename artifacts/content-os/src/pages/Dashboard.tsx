import { useGetDashboardStats, useGetRecentActivity, useListProjects, useListProviders } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { AlertTriangle, Activity, ArrowRight, Building2, FolderKanban, Plus, RefreshCw, Send, Sparkles } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, StateMessage } from '@/components/layout/Page';

// Workflow stages in order; used for progress and pipeline grouping.
const STAGES = ['assignment', 'research_plan', 'sources', 'claims', 'outline', 'drafting', 'editing', 'quality', 'export'] as const;

const STAGE_LABELS: Record<string, string> = {
  assignment: 'Brief',
  research_plan: 'Research',
  sources: 'Sources',
  claims: 'Claims',
  outline: 'Outline',
  drafting: 'Drafting',
  editing: 'Editing',
  quality: 'Quality review',
  export: 'Ready to export',
};

const PIPELINE = [
  { label: 'Planning', hint: 'Brief, research, sources, claims, outline', stages: ['assignment', 'research_plan', 'sources', 'claims', 'outline'] },
  { label: 'Drafting', hint: 'Writing and editing sections', stages: ['drafting', 'editing'] },
  { label: 'In review', hint: 'Quality checks before export', stages: ['quality'] },
  { label: 'Ready', hint: 'Cleared for export', stages: ['export'] },
];

const ACTIVITY_LABELS: Record<string, string> = {
  project_created: 'Project created',
  brand_created: 'Brand added',
  research_plan_generated: 'Research plan ready',
  outline_generated: 'Outline ready',
  section_drafted: 'Section drafted',
  quality_evaluated: 'Quality reviewed',
  source_approved: 'Source approved',
};

function relativeTime(iso?: string) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function stageProgress(stage?: string) {
  const index = STAGES.indexOf((stage ?? 'assignment') as (typeof STAGES)[number]);
  return Math.round(((index < 0 ? 0 : index + 1) / STAGES.length) * 100);
}

export default function Dashboard() {
  const stats = useGetDashboardStats();
  const projects = useListProjects();
  const { data: activity } = useGetRecentActivity();
  const { data: providers } = useListProviders();

  const totalBrands = stats.data?.totalBrands ?? 0;
  const totalProjects = stats.data?.totalProjects ?? 0;
  const providerMissing = providers !== undefined && !providers.some(p => p.isConfigured);

  const activeProjects = (projects.data ?? [])
    .filter(p => p.status !== 'archived' && p.status !== 'completed')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const continueWorking = activeProjects.slice(0, 4);

  const pipeline = PIPELINE.map(group => ({
    ...group,
    count: activeProjects.filter(p => group.stages.includes(p.workflowStage)).length,
  }));

  const workspaceState = stats.data
    ? `${stats.data.activeProjects} active project${stats.data.activeProjects === 1 ? '' : 's'} · ${totalBrands} brand${totalBrands === 1 ? '' : 's'} · ${stats.data.totalExports} export${stats.data.totalExports === 1 ? '' : 's'}`
    : 'Loading workspace…';

  return (
    <PageShell>
      <PageHeader
        eyebrow="Command center"
        title="Editorial command center"
        description={workspaceState}
        actions={
          <>
            <Link
              href="/projects"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <FolderKanban className="h-4 w-4" aria-hidden="true" /> Documents
            </Link>
            <Link
              href="/create"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Create content
            </Link>
          </>
        }
      />

      {stats.isError && (
        <StateMessage
          tone="error"
          title="The dashboard could not load workspace data."
          description="Your content is unaffected. Check the connection and try again."
          action={
            <button
              type="button"
              onClick={() => { stats.refetch(); projects.refetch(); }}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs font-medium text-foreground hover:bg-secondary"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
            </button>
          }
        />
      )}

      {providerMissing && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">AI generation is running in demo mode</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Generated text is clearly labelled placeholder output until an AI provider key is configured on the server.
              </p>
            </div>
          </div>
          <Link href="/settings" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-amber-400/30 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-400/10">
            Review provider status <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      {stats.data && totalBrands === 0 && (
        <StateMessage
          title="Start with a brand"
          description="A brand gives every piece a consistent voice, audience and point of view. It is the one thing Content OS needs before you create content."
          action={
            <Link href="/brands" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add your first brand
            </Link>
          }
        />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Panel>
            <PanelHeader title="Continue working" description="Most recently updated active projects" />
            {projects.isLoading && (
              <div className="space-y-3 p-5" role="status" aria-label="Loading projects">
                {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}
              </div>
            )}
            {!projects.isLoading && continueWorking.length === 0 && totalBrands > 0 && (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium text-foreground">Nothing in progress yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">Create a piece of content and it will appear here so you can pick it back up.</p>
                <Link href="/create" className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Create content
                </Link>
              </div>
            )}
            <ul className="divide-y divide-border">
              {continueWorking.map(project => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className="group flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-secondary/50 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full border border-border px-2 py-0.5 font-medium capitalize text-foreground/85">{project.contentType}</span>
                        {project.brandName && <span>{project.brandName}</span>}
                        <span aria-hidden="true">·</span>
                        <span>Updated {relativeTime(project.updatedAt)}</span>
                      </div>
                      <p className="truncate text-sm font-semibold text-foreground">{project.title}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${stageProgress(project.workflowStage)}%` }} />
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{STAGE_LABELS[project.workflowStage] ?? project.workflowStage}</span>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand">
                      Resume <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {activeProjects.length > continueWorking.length && (
              <div className="border-t border-border px-5 py-3">
                <Link href="/projects" className="text-xs font-semibold text-brand hover:underline">
                  View all {activeProjects.length} active projects
                </Link>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Recent activity" description="Latest workspace events" icon={<Activity className="h-4 w-4 text-brand" aria-hidden="true" />} />
            {!activity?.length ? (
              <p className="px-5 py-8 text-center text-xs text-muted-foreground">Activity from drafting, review and export will appear here.</p>
            ) : (
              <ul className="divide-y divide-border">
                {activity.slice(0, 6).map(item => (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-foreground">{item.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ACTIVITY_LABELS[item.type ?? ''] ?? 'Workspace update'}{item.brandName ? ` · ${item.brandName}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(item.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-6" aria-label="Production overview">
          <Panel>
            <PanelHeader title="Production pipeline" description={`${activeProjects.length} active project${activeProjects.length === 1 ? '' : 's'} by stage`} />
            <ul className="space-y-1 p-3">
              {pipeline.map(group => (
                <li key={group.label} className="flex items-center justify-between rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{group.label}</p>
                    <p className="text-[11px] text-muted-foreground">{group.hint}</p>
                  </div>
                  <span className="min-w-8 rounded-lg bg-muted px-2 py-1 text-center text-sm font-semibold tabular-nums text-foreground">{group.count}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-3 border-t border-border text-center">
              {[
                ['Documents', stats.data?.totalDocuments],
                ['Sources', stats.data?.totalSources],
                ['Exports', stats.data?.totalExports],
              ].map(([label, value]) => (
                <div key={label as string} className="px-2 py-4">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title="Quick actions" />
            <div className="space-y-1 p-3">
              {[
                { href: '/create', label: 'Create content', icon: Sparkles },
                { href: '/projects', label: 'Open documents', icon: FolderKanban },
                { href: '/brands', label: 'Manage brands', icon: Building2 },
                { href: '/distribution', label: 'Plan distribution', icon: Send },
              ].map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="group flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-secondary">
                  <span className="flex items-center gap-3"><Icon className="h-4 w-4 text-muted-foreground group-hover:text-brand" aria-hidden="true" /> {label}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </Panel>
        </aside>
      </div>

      {stats.data && totalProjects === 0 && totalBrands > 0 && (
        <p className="mt-6 text-center text-xs text-muted-foreground">Tip: Create walks you from a one-line intent to a brief, research plan, outline and first draft.</p>
      )}
    </PageShell>
  );
}
