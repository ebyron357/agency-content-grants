import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Sidebar } from '@/components/layout/Sidebar';
import Dashboard from '@/pages/Dashboard';
import BrandsList from '@/pages/BrandsList';
import BrandDetail from '@/pages/BrandDetail';
import ProjectsList from '@/pages/ProjectsList';
import ProjectDetail from '@/pages/ProjectDetail';
import Settings from '@/pages/Settings';
import Distribution from '@/pages/Distribution';
import Performance from '@/pages/Performance';
import Create from '@/pages/Create';
import Login from '@/pages/Login';
import NotFound from '@/pages/not-found';
import { useAuth } from '@/hooks/use-auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#F9F8F6]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
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
      </main>
    </div>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading, refetch } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-stone-300 border-t-[#C8102E] rounded-full animate-spin" />
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
