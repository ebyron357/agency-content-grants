import type { ReactNode } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared page frame for every authenticated route: one background, one
 * max-width rule, one title hierarchy and one panel/state language.
 * See docs/DESIGN_SYSTEM.md.
 */
export function PageShell({ children, width = 'wide', className }: { children: ReactNode; width?: 'wide' | 'default' | 'narrow'; className?: string }) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8',
        width === 'wide' && 'max-w-[1480px]',
        width === 'default' && 'max-w-6xl',
        width === 'narrow' && 'max-w-4xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  return <Tag className={cn('overflow-hidden rounded-2xl border border-border bg-card', className)}>{children}</Tag>;
}

export function PanelHeader({ title, description, icon, actions }: { title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}

/** Empty / error / informational state with one recommended next action. */
export function StateMessage({
  title,
  description,
  action,
  tone = 'neutral',
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
  icon?: ReactNode;
  className?: string;
}) {
  const error = tone === 'error';
  return (
    <div
      role={error ? 'alert' : undefined}
      className={cn(
        'mb-6 flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between',
        error ? 'border-red-400/25 bg-red-500/[0.06]' : 'border-border bg-card',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 shrink-0', error ? 'text-red-300' : 'text-brand')} aria-hidden="true">
          {icon ?? (error ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />)}
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading workspace…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-[40vh] items-center justify-center p-8', className)}>
      <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
