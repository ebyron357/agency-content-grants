import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Fit score badge. Bands: 70+ strong, 45–69 possible, below 45 weak. */
export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tone = score >= 70 ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : score >= 45 ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-border bg-muted text-muted-foreground';
  const label = score >= 70 ? 'Strong fit' : score >= 45 ? 'Possible fit' : 'Weak fit';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', tone, className)}>
      <span className="tabular-nums">{score}</span>
      <span className="font-medium">{label}</span>
    </span>
  );
}

/** Closing-date chip; amber inside 14 days. */
export function DeadlineChip({ daysLeft, label }: { daysLeft: number | null; label: string }) {
  const urgent = daysLeft != null && daysLeft < 14;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', urgent ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-border bg-muted text-muted-foreground')}>
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  in_review: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  approved: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  exported: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  submitted: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  awarded: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200',
  declined: 'border-border bg-muted text-muted-foreground',
  withdrawn: 'border-border bg-muted text-muted-foreground',
  empty: 'border-border bg-muted text-muted-foreground',
  drafting: 'border-brand/25 bg-brand/10 text-brand',
  missing: 'border-border bg-muted text-muted-foreground',
  in_progress: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  ready: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  open: 'border-border bg-muted text-muted-foreground',
  covered: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  not_applicable: 'border-border bg-muted text-muted-foreground',
  queued: 'border-border bg-muted text-muted-foreground',
  running: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  succeeded: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  failed: 'border-red-400/30 bg-red-500/10 text-red-300',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  exported: 'Exported',
  submitted: 'Submitted',
  awarded: 'Awarded',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  empty: 'Not started',
  drafting: 'Drafting',
  missing: 'Missing',
  in_progress: 'In progress',
  ready: 'Ready',
  open: 'Open',
  covered: 'Covered',
  not_applicable: 'Not applicable',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[status] ?? STATUS_STYLES.draft)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Readiness as a ring with the percentage of items ready. */
export function ReadinessRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const tone = score >= 80 ? 'text-emerald-400' : score >= 40 ? 'text-amber-400' : 'text-brand';
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-secondary" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} className={tone} />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular-nums text-foreground">{score}%</span>
      <span className="sr-only">Readiness {score} percent</span>
    </span>
  );
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'ok' | 'error'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    info: 'border-border bg-card text-muted-foreground',
    warn: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    ok: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    error: 'border-red-400/25 bg-red-500/[0.06] text-red-200',
  }[tone];
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn('flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between', styles)}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          {title && <p className="font-semibold text-foreground">{title}</p>}
          {children && <div className={cn('leading-relaxed', title && 'mt-0.5 text-xs')}>{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A reason (green tick) or a gap (amber warning) line. */
export function ReasonList({ items, kind }: { items: string[]; kind: 'reason' | 'gap' | 'exclusion' }) {
  if (!items.length) return null;
  const Icon = kind === 'reason' ? CheckCircle2 : AlertTriangle;
  const tone = kind === 'reason' ? 'text-emerald-400' : kind === 'gap' ? 'text-amber-400' : 'text-red-300';
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone)} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-sm font-medium text-foreground', className)}>
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const selectClass = 'h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm text-foreground';
