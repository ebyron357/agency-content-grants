import { Mountain } from 'lucide-react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

/** The product's user-facing name and public address. */
export const PRODUCT_NAME = 'GrantCrest';
export const PRODUCT_URL = 'https://grantcrest.co';
export const PRODUCT_TAGLINE = 'Grants and applications';

/**
 * The attribution the Grants.gov API terms require wherever its data is shown
 * (https://grants.gov/api/terms-conditions, "Attribution").
 */
export const GRANTS_GOV_NOTICE =
  'This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.';

/** The square logo tile used in the rail and on the sign-in screens. */
export function BrandMark({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-primary/15 text-brand',
        size === 'lg' ? 'h-10 w-10' : 'h-9 w-9',
        className,
      )}
    >
      <Mountain className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden="true" />
    </span>
  );
}

/** Logo and name, centred above the sign-in, invitation and two-factor cards. */
export function BrandLockup() {
  return (
    <div className="mb-8 flex items-center justify-center gap-3">
      <BrandMark size="lg" />
      <div>
        <p className="text-sm font-semibold tracking-tight text-foreground">{PRODUCT_NAME}</p>
        <p className="mt-1 text-xs leading-none text-muted-foreground">{PRODUCT_TAGLINE}</p>
      </div>
    </div>
  );
}

/** The Grants.gov attribution, shown on screens that display Grants.gov data. */
export function GrantsGovNotice({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs leading-relaxed text-muted-foreground', className)} data-testid="grants-gov-notice">
      {GRANTS_GOV_NOTICE}
    </p>
  );
}

/** Footer on every signed-in page: help, the public address and the Grants.gov notice. */
export function AppFooter() {
  return (
    <footer role="contentinfo" className="mx-auto w-full max-w-[1480px] border-t border-border px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        <span className="font-medium text-foreground">{PRODUCT_NAME}</span>
        <Link href="/help" className="underline-offset-4 hover:text-foreground hover:underline">Help and user guide</Link>
        <a href={PRODUCT_URL} className="underline-offset-4 hover:text-foreground hover:underline" target="_blank" rel="noreferrer">
          grantcrest.co<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <GrantsGovNotice className="mt-2 max-w-3xl" />
    </footer>
  );
}
