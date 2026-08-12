import { useGetDashboardStats, useGetRecentActivity, useListProviders } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { AlertTriangle, Activity, FolderKanban, Building2, CheckCircle2, Clock, Sparkles } from 'lucide-react';

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-5">
      <p className="text-xs text-stone-500 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-[#111] mt-1 font-serif">{value}</p>
      {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, string> = {
  project_created: '📁',
  brand_created: '🏷️',
  research_plan_generated: '🔬',
  outline_generated: '📋',
  section_drafted: '✍️',
  quality_evaluated: '✅',
  source_approved: '📄',
};

export default function Dashboard() {
  const { data: stats } = useGetDashboardStats();
  const { data: activity } = useGetRecentActivity();
  const { data: providers } = useListProviders();

  const unconfiguredProviders = providers?.filter(p => !p.isConfigured) ?? [];
  const hasAnyProvider = providers?.some(p => p.isConfigured) ?? false;
  const hasData = (stats?.totalBrands ?? 0) > 0 || (stats?.totalProjects ?? 0) > 0;

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#111] font-serif">Editorial Dashboard</h1>
        <p className="text-stone-500 mt-1 text-sm">Overview of your content operation</p>
      </div>

      {/* Welcome / zero-data state */}
      {stats && !hasData && (
        <div className="mb-6 flex items-start gap-3 bg-white border border-stone-200 rounded-lg p-6">
          <Sparkles className="w-5 h-5 text-[#C8102E] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-stone-800">Welcome to Content OS — create your first brand to get started</p>
            <p className="text-xs text-stone-500 mt-1">
              Brands define the voice, audience, and facts your content is built on.{' '}
              <Link href="/brands" className="text-[#C8102E] underline font-medium">Go to Brands →</Link>
            </p>
          </div>
        </div>
      )}

      {/* AI Provider Warning */}
      {!hasAnyProvider && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-900">No AI provider configured</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Add an API key in{' '}
              <Link href="/settings" className="underline font-medium">Settings → AI Providers</Link>{' '}
              to enable content generation. The system runs in demo mode until then.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="Brands" value={stats?.totalBrands ?? 0} />
        <StatCard label="Projects" value={stats?.totalProjects ?? 0} sub={`${stats?.activeProjects ?? 0} active`} />
        <StatCard label="Documents" value={stats?.totalDocuments ?? 0} />
        <StatCard label="Exports" value={stats?.totalExports ?? 0} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Activity Feed */}
        <div className="col-span-2 bg-white border border-stone-200 rounded-lg">
          <div className="px-5 py-4 border-b border-stone-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-stone-400" />
            <h2 className="font-semibold text-stone-800 text-sm">Recent Activity</h2>
          </div>
          <div className="divide-y divide-stone-50">
            {!activity?.length && (
              <div className="px-5 py-8 text-center text-stone-400 text-sm">No activity yet</div>
            )}
            {activity?.map(item => (
              <div key={item.id} className="px-5 py-3 flex items-start gap-3">
                <span className="text-base leading-none mt-0.5">{ACTIVITY_ICONS[item.type ?? ''] ?? '📌'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-700 leading-snug">{item.description}</p>
                  {item.brandName && (
                    <p className="text-xs text-stone-400 mt-0.5">{item.brandName}</p>
                  )}
                </div>
                <span className="text-xs text-stone-300 flex-shrink-0 mt-0.5">
                  {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Links */}
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <h2 className="font-semibold text-stone-800 text-sm mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <Link href="/projects" className="flex items-center gap-2 text-sm text-stone-600 hover:text-[#C8102E] transition-colors">
                <FolderKanban className="w-4 h-4" /> View all projects
              </Link>
              <Link href="/brands" className="flex items-center gap-2 text-sm text-stone-600 hover:text-[#C8102E] transition-colors">
                <Building2 className="w-4 h-4" /> Manage brands
              </Link>
              <Link href="/settings" className="flex items-center gap-2 text-sm text-stone-600 hover:text-[#C8102E] transition-colors">
                <CheckCircle2 className="w-4 h-4" /> Configure AI providers
              </Link>
            </div>
          </div>

          {/* Project status breakdown */}
          {stats?.projectsByStatus && (
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <h2 className="font-semibold text-stone-800 text-sm mb-3">Project Status</h2>
              <div className="space-y-2">
                {Object.entries(stats.projectsByStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-stone-300" />
                      <span className="text-xs text-stone-600 capitalize">{status}</span>
                    </div>
                    <span className="text-xs font-semibold text-stone-800">{count as number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
