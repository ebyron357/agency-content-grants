import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Router as WouterRouter } from "wouter";
import { Sidebar } from "@/components/layout/Sidebar";
import Login from "@/pages/Login";
import InviteAccept from "@/pages/InviteAccept";
import Signup from "@/pages/Signup";
import SignupVerify from "@/pages/SignupVerify";
import MfaRequired from "@/pages/MfaRequired";
import { useAuth } from "@/hooks/use-auth";
import { LoadingState } from "@/components/layout/Page";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const BrandsList = lazy(() => import("@/pages/BrandsList"));
const BrandDetail = lazy(() => import("@/pages/BrandDetail"));
const ProjectsList = lazy(() => import("@/pages/ProjectsList"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Settings = lazy(() => import("@/pages/Settings"));
const Distribution = lazy(() => import("@/pages/Distribution"));
const Performance = lazy(() => import("@/pages/Performance"));
const Create = lazy(() => import("@/pages/Create"));
const Grants = lazy(() => import("@/pages/Grants"));
const GrantStudio = lazy(() => import("@/pages/GrantStudio"));
const GrantOrganization = lazy(() => import("@/pages/GrantOrganization"));
const GrantOpportunity = lazy(() => import("@/pages/GrantOpportunity"));
const GrantApplication = lazy(() => import("@/pages/GrantApplication"));
const GrantTemplates = lazy(() => import("@/pages/GrantTemplates"));
const GrantTemplateEditor = lazy(() => import("@/pages/GrantTemplateEditor"));
const GrantFoundations = lazy(() => import("@/pages/GrantFoundations"));
const GrantFunder = lazy(() => import("@/pages/GrantFunder"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const GetStarted = lazy(() => import("@/pages/GetStarted"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RouteLoading() {
  return <LoadingState />;
}

function AppLayout({ firstRun }: { firstRun: boolean }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-xl border border-border bg-card px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main
        id="main-content"
        tabIndex={-1}
        className="min-w-0 flex-1 overflow-y-auto"
      >
        <Suspense fallback={<RouteLoading />}>
          <Switch>
            {/* A workspace its owner just signed up for opens on its getting-started checklist. */}
            <Route path="/" component={firstRun ? GetStarted : Create} />
            <Route path="/get-started" component={GetStarted} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/create" component={Create} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/brands" component={BrandsList} />
            <Route path="/brands/:id" component={BrandDetail} />
            <Route path="/projects" component={ProjectsList} />
            <Route path="/projects/:id" component={ProjectDetail} />
            <Route path="/distribution" component={Distribution} />
            <Route path="/performance" component={Performance} />
            <Route path="/settings" component={Settings} />
            <Route path="/grants" component={Grants} />
            <Route path="/grant-studio" component={GrantStudio} />
            <Route path="/grant-studio/organizations/:id" component={GrantOrganization} />
            <Route path="/grant-studio/opportunities/:id" component={GrantOpportunity} />
            <Route path="/grant-studio/applications/:id" component={GrantApplication} />
            <Route path="/grant-studio/templates" component={GrantTemplates} />
            <Route path="/grant-studio/templates/:key" component={GrantTemplateEditor} />
            <Route path="/grant-studio/foundations" component={GrantFoundations} />
            <Route path="/grant-studio/foundations/:ein" component={GrantFunder} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}

function AuthGate() {
  const { isAuthenticated, isLoading, mfaEnrollmentRequired, firstRun, refetch } = useAuth();
  // Invitation links work whether or not someone is signed in.
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = window.location.pathname.slice(base.length);
  const inviteToken = path.startsWith("/invite/") ? decodeURIComponent(path.slice("/invite/".length)) : null;
  if (inviteToken) return <InviteAccept token={inviteToken} onDone={refetch} />;
  // The confirmation link from a self sign-up email (docs/SELF_SIGNUP.md).
  if (path === "/signup/verify") return <SignupVerify onDone={refetch} />;

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // /signup shows the sign-up form only while the server has self sign-up on; otherwise the sign-in page.
    if (path === "/signup") return <Signup onSignedIn={refetch} />;
    return <Login onSuccess={refetch} />;
  }

  if (mfaEnrollmentRequired) {
    return <MfaRequired onDone={refetch} />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AppLayout firstRun={firstRun} />
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
