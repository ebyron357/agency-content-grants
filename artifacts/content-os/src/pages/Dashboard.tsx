import { useGetDashboardStats, useGetRecentActivity, useListProviders } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { AlertTriangle, Activity, ArrowUpRight, Building2, CheckCircle2, Clock, FolderKanban, Sparkles } from 'lucide-react';

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, string> = {
  project_created: 'Project created',
  brand_created: 'Brand added',
  research_plan_generated: 'Research plan ready',
  outline_generated: 'Outline ready',
  section_drafted: 'Section drafted',
  quality_evaluated: 'Quality reviewed',
  source_approved: 'Source approved',
};

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: activity } = useGetRecentActivity();
  const { data: providers } = useListProviders();

  const hasAnyProvider = providers?.some(p => p.isConfigured) ?? false;
  const hasData = (stats?.totalBrands ?? 0) > 0 || (stats?.totalProjects ?? 0) > 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Content OS</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Editorial command center</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">Turn a strong idea into publish-ready content with a focused workspace for every stage.</p>
        </div>
        <Link href="/create" className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Sparkles className="mr-2 h-4 w-4" /> Create content
        </Link>
      </div>

      {stats && !hasData && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">Your editorial workspace is ready.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Start by creating a brand so your content has a consistent voice, audience, and point of view. <Link href="/brands" className="font-semibold text-primary underline underline-offset-2">Set up a brand</Link></p>
          </div>
        </div>
      )}

      {!hasAnyProvider && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-4 dark:border-amber-900/70 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-foreground">AI generation is not configured</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Add a provider in <Link href="/settings" className="font-semibold text-foreground underline underline-offset-2">Settings</Link> to enable live generation. Until then, the workspace remains safe to explore in demo mode.</p>
          </div>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="Brands" value={stats?.totalBrands ?? 0} />
        <StatCard label="Projects" value={stats?.totalProjects ?? 0} sub={`${stats?.activeProjects ?? 0} active`} />
        <StatCard label="Documents" value={stats?.totalDocuments ?? 0} />
        <StatCard label="Exports" value={stats?.totalExports ?? 0} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-border/70 bg-card shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-foreground">Recent activity</h2></div>
            <span className="text-xs text-muted-foreground">Latest workspace events</span>
          </div>
          <div className="divide-y divide-border/50">
            {!activity?.length && (
              <div className="px-6 py-12 text-center"><Sparkles className="mx-auto mb-3 h-6 w-6 text-primary/70" /><p className="text-sm font-medium text-foreground">Your workspace is ready.</p><p className="mt-1 text-xs text-muted-foreground">Create a project to see your production activity here.</p></div>
            )}
            {activity?.map(item => (
              <div key={item.id} className="flex items-start gap-3 px-5 py-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10"><Activity className="h-4 w-4 text-primary" /></div>
                <div className="min-w-0 flex-1"><p className="text-sm leading-snug text-foreground">{item.description}</p><p className="mt-0.5 text-xs text-muted-foreground">{ACTIVITY_ICONS[item.type ?? ''] ?? 'Workspace update'}{item.brandName ? ` · ${item.brandName}` : ''}</p></div>
                <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Quick actions</h2>
            <div className="space-y-1">
              <Link href="/create" className="group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"><span className="flex items-center gap-3"><Sparkles className="h-4 w-4 text-primary" /> Create content</span><ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></Link>
              <Link href="/projects" className="group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"><span className="flex items-center gap-3"><FolderKanban className="h-4 w-4 text-muted-foreground" /> View projects</span><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></Link>
              <Link href="/brands" className="group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"><span className="flex items-center gap-3"><Building2 className="h-4 w-4 text-muted-foreground" /> Manage brands</span><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></Link>
              <Link href="/settings" className="group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"><span className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Configure providers</span><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></Link>
            </div>
          </div>

          {stats?.projectsByStatus && (
            <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Project status</h2>
              <div className="space-y-3">
                {Object.entries(stats.projectsByStatus).map(([status, count]) => <div key={status} className="flex items-center justify-between"><div className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs capitalize text-muted-foreground">{status}</span></div><span className="text-xs font-semibold text-foreground">{count as number}</span></div>)}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
