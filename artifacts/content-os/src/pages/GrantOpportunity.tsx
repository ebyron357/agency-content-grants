import { useState } from 'react';
import { Link, useLocation, useParams, useSearch } from 'wouter';
import { ArrowLeft, CalendarPlus, ExternalLink } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, StateMessage, LoadingState } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DeadlineChip, Field, Notice, ReasonList, ScoreBadge, selectClass } from '@/components/grants/GrantUi';
import { awardRange, calendarUrl, deadlineLabel, errorMessage, grantsApi, useApplicants, useGrantMeta, useInvalidateGrants, useOpportunity } from '@/lib/grants';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export default function GrantOpportunity() {
  const { id } = useParams<{ id: string }>();
  const search = new URLSearchParams(useSearch());
  const applicants = useApplicants();
  const [orgId, setOrgId] = useState(search.get('org') ?? '');
  const data = useOpportunity(id, orgId || undefined);
  const invalidate = useInvalidateGrants();
  const [, navigate] = useLocation();
  const [confirming, setConfirming] = useState(false);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  /** Empty: the registry chooses (the workspace's most specific matching template, else a built-in). */
  const [template, setTemplate] = useState('');
  const meta = useGrantMeta();

  if (data.isLoading) return <LoadingState label="Loading the official record…" />;
  if (data.isError || !data.data) {
    return (
      <PageShell>
        <StateMessage tone="error" title="Opportunity not found" description={errorMessage(data.error)} action={<Button asChild><Link href="/grant-studio">Back to Grant Studio</Link></Button>} />
      </PageShell>
    );
  }
  const { opportunity: o, match, existingApplicationId, detailError } = data.data;
  const orgs = applicants.data ?? [];
  const org = orgs.find((a) => a.id === orgId);

  async function start() {
    if (!orgId || !checked) return;
    setStarting(true);
    setError('');
    try {
      const result = await grantsApi.startApplication({ applicantId: orgId, opportunityId: o.id, eligibilityConfirmed: true, eligibilityNote: note || undefined, template: template || undefined });
      await invalidate();
      navigate(`/grant-studio/applications/${result.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <PageShell width="default">
      <Link href={org ? `/grant-studio/organizations/${org.id}` : '/grant-studio'} className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {org ? `${org.name} matches` : 'Grant Studio'}
      </Link>
      <PageHeader
        eyebrow={o.agency ?? 'Federal opportunity'}
        title={o.title}
        description={[o.number ? `Opportunity ${o.number}` : null, o.sourceLabel, o.jurisdiction ? `${o.jurisdiction} state program` : 'Federal program'].filter(Boolean).join(' · ')}
        actions={
          <Button asChild variant="outline" className="gap-2">
            <a href={o.officialUrl} target="_blank" rel="noreferrer">Official listing <ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
          </Button>
        }
      />
      {detailError && <div className="mb-4"><Notice tone="warn">{detailError}</Notice></div>}

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Closing date" value={deadlineLabel(o)} />
        <Fact label="Award" value={awardRange(o)} />
        <Fact label="Cost sharing" value={o.costSharing == null ? 'Not stated' : o.costSharing ? (o.costSharePercent ? `Required: ${o.costSharePercent}% match` : 'Required') : 'Not required'} />
        <Fact label="Status" value={o.status === 'forecasted' ? 'Forecast' : 'Posted'} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="About this opportunity" description="From the official record. Read the full notice before applying." />
            <div className="space-y-4 px-5 py-4">
              {o.description ? <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{o.description}</p> : <p className="text-sm text-muted-foreground">The official record has no summary. Open the official listing for the full notice.</p>}
              {o.categories.length > 0 && <p className="text-xs text-muted-foreground">Categories: {o.categories.join(', ')}</p>}
              {o.assistanceListings.length > 0 && <p className="text-xs text-muted-foreground">Assistance listings: {o.assistanceListings.join(', ')}</p>}
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Who can apply" />
            <div className="space-y-3 px-5 py-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {o.eligibilityLabels.length ? o.eligibilityLabels.map((l) => <li key={l}>{l}</li>) : <li>Not stated in the record: check the notice.</li>}
              </ul>
              {o.eligibilityText && <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{o.eligibilityText}</p>}
            </div>
          </Panel>
        </div>

        <Panel className="h-fit lg:sticky lg:top-6">
          <PanelHeader title="Fit for an organization" />
          <div className="space-y-4 px-5 py-4">
            <Field label="Organization">
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={selectClass}>
                <option value="">Choose an organization</option>
                {orgs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            {applicants.data && orgs.length === 0 && <p className="text-xs text-muted-foreground">Add an organization in Grant Studio first.</p>}
            {match && (
              <>
                {match.eligible ? <ScoreBadge score={match.score} /> : <Notice tone="error" title="Not eligible on the record">{match.exclusions.join(' ')}</Notice>}
                <ReasonList items={match.reasons} kind="reason" />
                <ReasonList items={match.gaps} kind="gap" />
              </>
            )}
            {existingApplicationId ? (
              <Button asChild className="w-full"><Link href={`/grant-studio/applications/${existingApplicationId}`}>Open the application</Link></Button>
            ) : (
              <Button className="w-full" disabled={!orgId || (match ? !match.eligible : false)} onClick={() => { setChecked(false); setConfirming(true); }}>
                Start application
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <DeadlineChip daysLeft={o.daysLeft} label={deadlineLabel(o)} />
              {o.closeDate && (
                <Button asChild size="sm" variant="ghost" className="gap-1.5">
                  <a href={calendarUrl('opportunity', o.id)} download><CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Add to calendar</a>
                </Button>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm eligibility</DialogTitle>
            <DialogDescription>Grant Studio’s match is a guide, not an eligibility decision. Confirm it against the official notice before you start.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button asChild variant="outline" className="w-full gap-2">
              <a href={o.officialUrl} target="_blank" rel="noreferrer">Open the official notice <ExternalLink className="h-4 w-4" aria-hidden="true" /></a>
            </Button>
            <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm text-foreground">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
              <span>I read the notice’s eligibility section and {org?.name ?? 'this organization'} meets it.</span>
            </label>
            <Field label="Template" hint="The sections and requirements the application starts with. Manage them in Grant Studio, Templates.">
              <select className={selectClass} value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Choose automatically</option>
                {(meta.data?.templates ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}{t.builtIn === false ? ' (your template)' : ''}</option>)}
              </select>
            </Field>
            <Field label="Eligibility note (optional)" hint="For example the section you checked. Saved with the application.">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button onClick={start} disabled={!checked || starting}>{starting ? 'Starting…' : 'Confirm and start'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
