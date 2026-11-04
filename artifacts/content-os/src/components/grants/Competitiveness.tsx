import { Gauge } from 'lucide-react';
import { Panel, PanelHeader } from '@/components/layout/Page';
import { cn } from '@/lib/utils';
import type { Calibration, CompetitivenessRating } from '@/lib/grants';

const BAND_STYLE: Record<string, string> = {
  strong: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  competitive: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  needs_work: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  not_ready: 'border-red-400/30 bg-red-500/10 text-red-300',
  not_eligible: 'border-red-400/30 bg-red-500/10 text-red-300',
};

/** The rating as a small chip, for headers. */
export function RatingChip({ rating }: { rating: CompetitivenessRating }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium', BAND_STYLE[rating.band])}>
      <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="tabular-nums">{rating.score}</span> {rating.bandLabel}
      <span className="sr-only">competitiveness rating out of 100 (not a probability of approval)</span>
    </span>
  );
}

export function CompetitivenessPanel({ rating }: { rating: CompetitivenessRating }) {
  return (
    <Panel>
      <PanelHeader title="Competitiveness rating" icon={<Gauge className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />} description="How ready it is to compete. Not a probability of approval." actions={<RatingChip rating={rating} />} />
      <div className="space-y-5 px-5 py-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{rating.disclaimer}</p>
        <ul className="space-y-3" aria-label="Rating components">
          {rating.components.map((c) => (
            <li key={c.key}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">{c.label}</span>
                <span className="tabular-nums text-muted-foreground">{c.points} / {c.max}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${c.label} points`} aria-valuemin={0} aria-valuemax={c.max} aria-valuenow={c.points}>
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round((c.points / c.max) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
            </li>
          ))}
        </ul>
        {rating.actions.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To raise it</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground">{rating.actions.map((a) => <li key={a}>{a}</li>)}</ol>
          </div>
        )}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context (not scored)</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{rating.context.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      </div>
    </Panel>
  );
}

/** Real award rates by the rating frozen at submission. */
export function CalibrationPanel({ calibration }: { calibration: Calibration }) {
  return (
    <Panel className="mb-6">
      <PanelHeader
        title="Award rate by competitiveness rating"
        icon={<Gauge className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
        description={`Measured from your recorded decisions: the rating is frozen when a submission is recorded. A rate shows once a band has ${calibration.minDecisions} decisions.`}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th scope="col" className="px-5 py-2 font-medium">Rating at submission</th><th scope="col" className="px-3 py-2 font-medium">Awarded</th><th scope="col" className="px-3 py-2 font-medium">Declined</th><th scope="col" className="px-3 py-2 font-medium">Awaiting</th><th scope="col" className="px-5 py-2 font-medium">Award rate</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {calibration.bands.map((b) => (
              <tr key={b.band}>
                <th scope="row" className="px-5 py-2 text-left font-medium text-foreground">{b.label}</th>
                <td className="px-3 py-2 tabular-nums">{b.awarded}</td>
                <td className="px-3 py-2 tabular-nums">{b.declined}</td>
                <td className="px-3 py-2 tabular-nums">{b.pending}</td>
                <td className="px-5 py-2 tabular-nums text-muted-foreground">{b.awardRate === null ? `Needs ${Math.max(0, calibration.minDecisions - b.awarded - b.declined)} more` : `${Math.round(b.awardRate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
