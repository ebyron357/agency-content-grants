import { useGetDashboardStats, useGetRecentActivity, getGetDashboardStatsQueryKey, getGetRecentActivityQueryKey, useListProviders, getListProvidersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Library, FolderKanban, FileText, Download, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });

  const { data: activities, isLoading: activityLoading } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey() }
  });

  const { data: providers } = useListProviders({
    query: { queryKey: getListProvidersQueryKey() }
  });

  const hasConfiguredProvider = providers?.some(p => p.isConfigured);

  return (
    <div className="space-y-8 animate-in fade-in zoom-in duration-500">
      {providers && !hasConfiguredProvider && (
        <div className="bg-destructive/10 text-destructive border border-destructive/20 p-4 rounded-md flex items-center gap-3">
          <AlertCircle className="h-5 w-5" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">No AI Providers Configured</h4>
            <p className="text-sm opacity-90">Content OS requires at least one LLM provider to function.</p>
          </div>
          <Link href="/settings/providers">
            <Button variant="outline" size="sm" className="bg-background text-foreground">Configure Providers</Button>
          </Link>
        </div>
      )}

      <div>
        <h1 className="text-4xl font-serif tracking-tight mb-2">Editorial Dashboard</h1>
        <p className="text-muted-foreground">Overview of your publishing pipeline and brand activities.</p>
      </div>

      {statsLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-16" />
              <CardContent className="h-10" />
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Active Brands</CardTitle>
              <Library className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalBrands}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Active Projects</CardTitle>
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.activeProjects}</div>
              <p className="text-xs text-muted-foreground mt-1">Out of {stats.totalProjects} total</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Documents</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalDocuments}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Exports</CardTitle>
              <Download className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalExports}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-2">
          <h2 className="text-2xl font-serif mb-4">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              {activityLoading ? (
                <div className="p-8 text-center text-muted-foreground">Loading activity...</div>
              ) : activities && activities.length > 0 ? (
                <div className="divide-y">
                  {activities.map((item) => (
                    <div key={item.id} className="p-6 flex items-start gap-4 hover:bg-muted/30 transition-colors">
                      <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">
                          <Link href={`/projects/${item.projectId}`} className="hover:underline hover:text-primary">
                            {item.projectTitle}
                          </Link>
                        </p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                          <span>{format(new Date(item.createdAt), 'MMM d, yyyy • h:mm a')}</span>
                          {item.brandName && (
                            <>
                              <span>&middot;</span>
                              <span className="font-medium text-foreground">{item.brandName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground">No recent activity found.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-serif mb-4">Project Pipeline</h2>
          <Card>
            <CardContent className="p-6">
              {stats?.projectsByStatus && Object.keys(stats.projectsByStatus).length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(stats.projectsByStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-sm bg-primary/20 border border-primary/30" />
                        <span className="text-sm font-medium capitalize">{status.replace('_', ' ')}</span>
                      </div>
                      <span className="text-sm font-bold bg-muted px-2 py-1 rounded-md">{count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">No active projects in pipeline.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
