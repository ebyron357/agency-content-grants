import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Sidebar } from '@/components/layout/Sidebar';
import Login from '@/pages/Login';
import { useAuth } from '@/hooks/use-auth';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const BrandsList = lazy(() => import('@/pages/BrandsList'));
const BrandDetail = lazy(() => import('@/pages/BrandDetail'));
const ProjectsList = lazy(() => import('@/pages/ProjectsList'));
const ProjectDetail = lazy(() => import('@/pages/ProjectDetail'));
const Settings = lazy(() => import('@/pages/Settings'));
const Distribution = lazy(() => import('@/pages/Distribution'));
const Performance = lazy(() => import('@/pages/Performance'));
const Create = lazy(() => import('@/pages/Create'));
const NotFound = lazy(() => import('@/pages/not-found'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RouteLoading() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm" role="status" aria-live="polite">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
        Loading workspace…
      </div>
    </div>
  );
}

function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Suspense fallback={<RouteLoading />}>
          <Switch>
            <Route path="/" component={Create} />
            <Route path="/create" component={Create} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/brands" component={BrandsList} />
            <Route path="/brands/:id" component={BrandDetail} />
            <Route path="/projects" component={ProjectsList} />
            <Route path="/projects/:id" component={ProjectDetail} />
            <Route path="/distribution" component={Distribution} />
            <Route path="/performance" component={Performance} />
            <Route path="/settings" component={Settings} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading, refetch } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onSuccess={refetch} />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AppLayout />
    </WouterRouter>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
