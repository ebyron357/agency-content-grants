import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/layout/Layout';

// Pages
import Dashboard from '@/pages/Dashboard';
import Brands from '@/pages/Brands';
import BrandDetail from '@/pages/BrandDetail';
import Projects from '@/pages/Projects';
import ProjectNew from '@/pages/ProjectNew';
import ProjectDetail from '@/pages/ProjectDetail';
import ResearchLibrary from '@/pages/ResearchLibrary';
import ContentLibrary from '@/pages/ContentLibrary';
import Templates from '@/pages/Templates';
import SettingsProviders from '@/pages/SettingsProviders';
import SettingsModels from '@/pages/SettingsModels';
import SettingsDependencies from '@/pages/SettingsDependencies';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/brands" component={Brands} />
        <Route path="/brands/:id" component={BrandDetail} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/new" component={ProjectNew} />
        <Route path="/projects/:id/:tab?" component={ProjectDetail} />
        <Route path="/research-library" component={ResearchLibrary} />
        <Route path="/content-library" component={ContentLibrary} />
        <Route path="/templates" component={Templates} />
        <Route path="/settings/providers" component={SettingsProviders} />
        <Route path="/settings/models" component={SettingsModels} />
        <Route path="/settings/dependencies" component={SettingsDependencies} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
          <Router />
        </WouterRouter>
        {/* <Toaster /> */}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
