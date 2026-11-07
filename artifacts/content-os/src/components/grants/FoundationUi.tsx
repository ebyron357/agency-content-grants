import { ExternalLink, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApplicationPolicy, FilingLinks, MatchComponent } from '@/lib/foundations';

const POLICY_STYLES: Record<ApplicationPolicy['status'], string> = {
  accepts_applications: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  invitation_only: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  unknown: 'border-border bg-muted text-muted-foreground',
};

/** "Accepts applications" / "Invitation only" / "Unknown", with the tax year of the filing it came from. */
export function PolicyBadge({ policy, className }: { policy: ApplicationPolicy | undefined; className?: string }) {
  const p = policy ?? { status: 'unknown' as const, label: 'Unknown', taxYear: null, objectId: null, detail: '' };
  const text = p.status === 'unknown' ? 'Applications: unknown' : `${p.label}${p.taxYear ? ` · tax year ${p.taxYear}` : ''}`;
  return (
    <span title={p.detail || undefined} className={cn('inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium', POLICY_STYLES[p.status], className)}>
      {text}
    </span>
  );
}

/** One scored factor: its points out of the maximum, and the sentence behind them. */
export function ComponentList({ items }: { items: MatchComponent[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((c) => (
        <li key={c.key} className="rounded-xl border border-border bg-background px-3 py-2">
          <p className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
            <span>{c.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round(c.points)} of {c.max}
            </span>
          </p>
          <div className="mt-1.5 h-1 rounded-full bg-muted" aria-hidden="true">
            <div className="h-1 rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, (c.points / c.max) * 100))}%` }} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{c.reason}</p>
        </li>
      ))}
    </ul>
  );
}

/** The filing behind a record: its IRS object id and where to find it. */
export function FilingLinkRow({ filing, label = 'Source filing' }: { filing: FilingLinks | null | undefined; label?: string }) {
  if (!filing) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {label}: IRS object id <span className="break-all font-mono text-foreground">{filing.objectId ?? '—'}</span>
      </span>
      {filing.propublica && (
        <a className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground" href={filing.propublica} target="_blank" rel="noreferrer">
          ProPublica filings <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
      <a className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground" href={filing.irsDownloads} target="_blank" rel="noreferrer">
        IRS e-file downloads <ExternalLink className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}
