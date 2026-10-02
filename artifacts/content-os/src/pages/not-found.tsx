import { Link } from 'wouter';
import { Compass } from 'lucide-react';
import { PageShell } from '@/components/layout/Page';

export default function NotFound() {
  return (
    <PageShell width="narrow">
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-brand">
          <Compass className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Page not found</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">This page does not exist.</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The link may be outdated or the item may have been removed. Your documents are listed on the Documents page.
        </p>
        <Link
          href="/projects"
          className="mt-6 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Go to Documents
        </Link>
      </div>
    </PageShell>
  );
}
