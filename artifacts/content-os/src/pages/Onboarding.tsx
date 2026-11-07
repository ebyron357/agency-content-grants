import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ExternalLink, Landmark, Search, Sparkles } from 'lucide-react';
import { LoadingState, PageHeader, PageShell, Panel, PanelHeader, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DeadlineChip, Field, Notice, ScoreBadge } from '@/components/grants/GrantUi';
import { apiGet } from '@/lib/api';
import { deadlineLabel, errorMessage, grantsApi, type ApplicantType, type MatchesResponse } from '@/lib/grants';
import { HISTORY_LABEL, usd as usdWhole, type Suggestions } from '@/lib/foundations';
import { durationLabel, formatEinInput, onboardingApi, useInvalidateOnboarding, useOnboarding, type CreatedOrganization, type LookupResult, type Prefill } from '@/lib/onboarding';
import { cn } from '@/lib/utils';

type Step = 'find' | 'confirm' | 'focus' | 'results';
const STEPS: { key: Step; label: string }[] = [
  { key: 'find', label: 'Find your organization' },
  { key: 'confirm', label: 'Confirm details' },
  { key: 'focus', label: 'Choose focus areas' },
  { key: 'results', label: 'First matches' },
];

const TYPES: { type: ApplicantType; label: string }[] = [
  { type: 'nonprofit_501c3', label: 'Nonprofit, 501(c)(3)' },
  { type: 'nonprofit_other', label: 'Nonprofit, other' },
  { type: 'small_business', label: 'Small business' },
  { type: 'for_profit', label: 'Other for-profit' },
];

/** The values from the IRS records a person ticks before they are used. */
type ConfirmKey = 'name' | 'address' | 'state' | 'ntee' | 'revenue' | 'subsection';

interface Profile {
  applicantType: ApplicantType;
  ein: string;
  name: string;
  principalAddress: string;
  state: string;
  annualBudget: string;
  mission: string;
}

const emptyProfile: Profile = { applicantType: 'nonprofit_501c3', ein: '', name: '', principalAddress: '', state: '', annualBudget: '', mission: '' };

function StepList({ current }: { current: Step }) {
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <ol aria-label="Setup steps" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === index ? 'step' : undefined}
          className={cn('rounded-xl border px-3 py-2 text-xs', i === index ? 'border-brand/50 bg-brand/10 text-foreground' : i < index ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-border bg-card text-muted-foreground')}
        >
          <span className="block font-semibold">{i < index ? <Check className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}Step {i + 1}</span>
          {s.label}
          {i < index && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

/** One value from the IRS records, editable, with its own "this is correct" tick. */
function ConfirmRow({ id, label, value, onChange, confirmed, onConfirm, readOnly, hint }: { id: ConfirmKey; label: string; value: string; onChange?: (v: string) => void; confirmed: boolean; onConfirm: (v: boolean) => void; readOnly?: boolean; hint?: string }) {
  return (
    <div className="grid gap-2 border-b border-border px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="min-w-0">
        <label htmlFor={`confirm-${id}-value`} className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
        {readOnly ? (
          <p id={`confirm-${id}-value`} className="break-words text-sm text-foreground">{value || '—'}</p>
        ) : (
          <Input id={`confirm-${id}-value`} value={value} onChange={(e) => onChange?.(e.target.value)} aria-describedby={hint ? `confirm-${id}-hint` : undefined} />
        )}
        {hint && <p id={`confirm-${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <label className="flex h-10 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} aria-label={`${label} is correct`} />
        Correct
      </label>
    </div>
  );
}

/**
 * /onboarding: the setup wizard, from EIN to first match (docs/SELF_SIGNUP.md §4).
 * Reachable any time from the getting-started checklist and Grant Studio.
 */
export default function Onboarding() {
  const state = useOnboarding();
  const invalidate = useInvalidateOnboarding();
  const startedAt = useRef(performance.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>('find');
  const [mode, setMode] = useState<'ein' | 'manual'>('ein');
  const [einInput, setEinInput] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [confirmed, setConfirmed] = useState<Partial<Record<ConfirmKey, boolean>>>({});
  const [areas, setAreas] = useState<string[]>([]);
  const [customAreas, setCustomAreas] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedOrganization | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // Move focus to the new step's heading, so keyboard and screen-reader users land on it (not on first load).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  if (state.isLoading) return <LoadingState label="Loading setup…" />;
  if (state.isError || !state.data) {
    return (
      <PageShell width="narrow">
        <StateMessage tone="error" title="Setup could not load" description={errorMessage(state.error)} action={<Button onClick={() => state.refetch()}>Try again</Button>} />
      </PageShell>
    );
  }
  const data = state.data;
  const found = lookup?.status === 'found' ? lookup : null;
  const suggested = found?.suggestedFocusAreas ?? data.focusAreas.general;

  async function runLookup(event: FormEvent) {
    event.preventDefault();
    setLookupError('');
    setLookup(null);
    const digits = einInput.replace(/\D/g, '');
    if (digits.length !== 9) {
      setLookupError('Enter all 9 digits of the EIN, for example 12-3456789.');
      return;
    }
    setLooking(true);
    try {
      const result = await onboardingApi.lookup(digits);
      setLookup(result);
      if (result.status === 'found') {
        const p: Prefill = result.prefill;
        setProfile({ ...emptyProfile, applicantType: p.applicantType, ein: result.einFormatted, name: p.name, principalAddress: p.principalAddress ?? '', state: p.state ?? '', annualBudget: p.revenue != null ? String(p.revenue) : '' });
        setConfirmed({});
        setAreas([]);
        setStep('confirm');
      }
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setLooking(false);
    }
  }

  function enterByHand() {
    setMode('manual');
    setLookup(null);
    setProfile({ ...emptyProfile, ein: formatEinInput(einInput), applicantType: einInput ? 'nonprofit_501c3' : 'small_business' });
    setConfirmed({});
    setStep('confirm');
  }

  function continueFromConfirm(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (!profile.name.trim()) return setFormError('Enter the organization’s legal name.');
    if (found && profile.name.trim().toLowerCase() === found.prefill.name.toLowerCase() && !confirmed.name) return setFormError('Tick “Correct” next to the legal name, or correct it.');
    if (profile.state.trim() && !/^[A-Za-z]{2}$/.test(profile.state.trim())) return setFormError('Use the two-letter state code, for example NC.');
    if (profile.annualBudget.trim() && !/^\d[\d,]*$/.test(profile.annualBudget.trim().replace(/^\$/, ''))) return setFormError('Enter revenue as a whole number of dollars, for example 350000.');
    setStep('focus');
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    setCreating(true);
    const focusAreas = [...areas, ...customAreas.split(',').map((a) => a.trim()).filter(Boolean)];
    try {
      const result = await onboardingApi.createOrganization({
        applicantType: profile.applicantType,
        ein: profile.ein.trim() || null,
        name: profile.name.trim(),
        state: profile.state.trim() || null,
        principalAddress: profile.principalAddress.trim() || null,
        annualBudget: profile.annualBudget.trim() ? Number(profile.annualBudget.replace(/[$,]/g, '')) : null,
        mission: profile.mission.trim() || null,
        focusAreas,
        confirmations: found ? confirmed : undefined,
      });
      setCreated(result);
      setStep('results');
      await invalidate();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  const confirmAll = () => setConfirmed({ name: true, address: true, state: true, ntee: true, revenue: true, subsection: true });

  let body: ReactNode;
  if (step === 'find') {
    body = (
      <Panel className="p-5 sm:p-6">
        <fieldset className="mb-5">
          <legend className="mb-2 text-sm font-medium text-foreground">Does your organization have an EIN?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { key: 'ein' as const, title: 'Yes, look it up', body: 'Nonprofits on IRS records: we fill in your details for you to confirm.' },
              { key: 'manual' as const, title: 'No, or not on IRS records yet', body: 'Businesses and new nonprofits: enter your details yourself.' },
            ].map((c) => (
              <label key={c.key} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-brand', mode === c.key ? 'border-brand/60 bg-brand/10' : 'border-border bg-background hover:bg-secondary')}>
                <input type="radio" name="ein-mode" className="mt-1 h-4 w-4 accent-[hsl(var(--brand))]" checked={mode === c.key} onChange={() => setMode(c.key)} />
                <span>
                  <span className="block text-sm font-semibold text-foreground">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{c.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === 'ein' ? (
          <form onSubmit={runLookup} className="space-y-4">
            <Field label="EIN (Employer Identification Number)" hint="9 digits, for example 12-3456789. It is on your IRS determination letter and Form 990.">
              <Input value={einInput} onChange={(e) => setEinInput(formatEinInput(e.target.value))} inputMode="numeric" autoComplete="off" placeholder="12-3456789" maxLength={10} />
            </Field>
            {looking && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Looking up {einInput} in IRS records…</p>}
            {lookupError && <Notice tone="error">{lookupError}</Notice>}
            {lookup && lookup.status !== 'found' && (
              <Notice tone="warn" title={lookup.status === 'not_found' ? 'No match for that EIN' : 'The lookup is not available right now'} action={<Button type="button" variant="outline" size="sm" onClick={enterByHand}>Enter details yourself</Button>}>
                {lookup.message}
              </Notice>
            )}
            {!data.lookup.available && <Notice tone="warn">The EIN lookup is turned off on this server. Enter your details yourself.</Notice>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={enterByHand}>Enter details yourself</Button>
              <Button type="submit" disabled={looking || !data.lookup.available} className="gap-2"><Search className="h-4 w-4" aria-hidden="true" /> {looking ? 'Looking up…' : 'Look up'}</Button>
            </div>
          </form>
        ) : (
          <div className="flex justify-end">
            <Button onClick={enterByHand} className="gap-2">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        )}
      </Panel>
    );
  } else if (step === 'confirm') {
    body = (
      <form onSubmit={continueFromConfirm} className="space-y-5">
        {found ? (
          <>
            <Notice
              tone="info"
              title={`From IRS records for EIN ${found.einFormatted}`}
              action={<Button type="button" variant="outline" size="sm" onClick={confirmAll}>Mark all correct</Button>}
            >
              {found.source.attribution} Check each item. Only what you mark correct goes into your profile; everything is also saved to your fact library with its source, so you can review it later.{' '}
              <a href={found.organization.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                View on ProPublica <ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
              </a>
            </Notice>
            <Panel>
              <PanelHeader title="Your organization" description="Unconfirmed until you tick Correct. Edit anything that is out of date." />
              <ConfirmRow id="name" label="Legal name" value={profile.name} onChange={(v) => setProfile({ ...profile, name: v })} confirmed={!!confirmed.name} onConfirm={(v) => setConfirmed({ ...confirmed, name: v })} />
              <ConfirmRow id="address" label="Address" value={profile.principalAddress} onChange={(v) => setProfile({ ...profile, principalAddress: v })} confirmed={!!confirmed.address} onConfirm={(v) => setConfirmed({ ...confirmed, address: v })} />
              <ConfirmRow id="state" label="State" value={profile.state} onChange={(v) => setProfile({ ...profile, state: v.toUpperCase().slice(0, 2) })} confirmed={!!confirmed.state} onConfirm={(v) => setConfirmed({ ...confirmed, state: v })} hint="Used for state programs and foundations that give in your state." />
              <ConfirmRow id="ntee" label="Cause (NTEE classification)" value={found.prefill.ntee ?? ''} readOnly confirmed={!!confirmed.ntee} onConfirm={(v) => setConfirmed({ ...confirmed, ntee: v })} />
              <ConfirmRow
                id="revenue"
                label={`Total revenue${found.prefill.revenueYear ? ` (tax year ${found.prefill.revenueYear})` : ''}`}
                value={profile.annualBudget}
                onChange={(v) => setProfile({ ...profile, annualBudget: v })}
                confirmed={!!confirmed.revenue}
                onConfirm={(v) => setConfirmed({ ...confirmed, revenue: v })}
                hint={found.prefill.revenueBand ? `Revenue band: ${found.prefill.revenueBand}. Used to judge award size.` : 'Used to judge award size.'}
              />
              <ConfirmRow id="subsection" label="IRS tax-exempt status" value={found.prefill.subsection ?? 'Not stated'} readOnly confirmed={!!confirmed.subsection} onConfirm={(v) => setConfirmed({ ...confirmed, subsection: v })} />
            </Panel>
          </>
        ) : (
          <Panel className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal name" className="sm:col-span-2">
                <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} autoComplete="organization" required />
              </Field>
              <Field label="EIN (optional)" hint="Leave empty if you do not have one yet.">
                <Input value={profile.ein} onChange={(e) => setProfile({ ...profile, ein: formatEinInput(e.target.value) })} inputMode="numeric" placeholder="12-3456789" maxLength={10} />
              </Field>
              <Field label="State" hint="Two letters, for state programs.">
                <Input value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value.toUpperCase().slice(0, 2) })} placeholder="NC" />
              </Field>
              <Field label="Address (optional)" className="sm:col-span-2">
                <Input value={profile.principalAddress} onChange={(e) => setProfile({ ...profile, principalAddress: e.target.value })} autoComplete="street-address" />
              </Field>
              <Field label="Annual revenue or budget in USD (optional)" hint="Used to judge award size." className="sm:col-span-2">
                <Input value={profile.annualBudget} onChange={(e) => setProfile({ ...profile, annualBudget: e.target.value })} inputMode="numeric" placeholder="350000" />
              </Field>
            </div>
          </Panel>
        )}
        <Panel className="p-5 sm:p-6">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">What kind of organization is it?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TYPES.map((t) => (
                <label key={t.type} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm focus-within:ring-2 focus-within:ring-brand', profile.applicantType === t.type ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border bg-background text-foreground hover:bg-secondary')}>
                  <input type="radio" name="applicant-type" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={profile.applicantType === t.type} onChange={() => setProfile({ ...profile, applicantType: t.type })} />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>
        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" className="gap-2" onClick={() => { setStep('find'); setFormError(''); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</Button>
          <Button type="submit" className="gap-2">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </form>
    );
  } else if (step === 'focus') {
    body = (
      <form onSubmit={finish} className="space-y-5">
        <Panel className="p-5 sm:p-6">
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-foreground">What do you work on?</legend>
            <p className="mb-3 text-xs text-muted-foreground">{found?.prefill.ntee ? `Suggested from your classification, ${found.prefill.ntee}. ` : ''}Pick any that fit. Matches use these words to find on-topic opportunities. You can change them later.</p>
            <div className="flex flex-wrap gap-2">
              {suggested.map((area) => {
                const on = areas.includes(area);
                return (
                  <label key={area} className={cn('inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-within:ring-2 focus-within:ring-brand', on ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-secondary')}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--brand))]" checked={on} onChange={(e) => setAreas(e.target.checked ? [...areas, area] : areas.filter((a) => a !== area))} />
                    {area}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-5 grid gap-4">
            <Field label="Other focus areas" hint="Comma separated, for example: early literacy, rural broadband.">
              <Input value={customAreas} onChange={(e) => setCustomAreas(e.target.value)} />
            </Field>
            <Field label="Mission (optional)" hint="One or two sentences. Distinctive words in it also help matching.">
              <Textarea value={profile.mission} onChange={(e) => setProfile({ ...profile, mission: e.target.value })} rows={3} />
            </Field>
          </div>
        </Panel>
        {areas.length === 0 && !customAreas.trim() && <Notice tone="warn">Without a focus area, matches show every opportunity you may be eligible for, not only on-topic ones.</Notice>}
        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" className="gap-2" onClick={() => { setStep('confirm'); setFormError(''); }}><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</Button>
          <Button type="submit" disabled={creating} className="gap-2"><Sparkles className="h-4 w-4" aria-hidden="true" /> {creating ? 'Saving and matching…' : 'Show my matches'}</Button>
        </div>
      </form>
    );
  } else {
    body = created ? <Results created={created} startedAt={startedAt.current} elapsed={elapsed} onElapsed={setElapsed} /> : null;
  }

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="Setup"
        title="Set up your organization"
        description="From your EIN to your first grant matches in a few minutes. Matches are guidance, never an eligibility decision."
        actions={<Button variant="outline" asChild><Link href="/get-started">Checklist</Link></Button>}
      />
      <StepList current={step} />
      <h2 ref={heading} tabIndex={-1} className="mb-4 text-lg font-semibold text-foreground focus:outline-none">
        {STEPS.find((s) => s.key === step)!.label}
      </h2>
      {data.organizations.length > 0 && step === 'find' && (
        <div className="mb-4">
          <Notice tone="info">This adds another organization. To change {data.organizations[0].name}, open it in Grant Studio.</Notice>
        </div>
      )}
      {body}
    </PageShell>
  );
}

/** The last step: the first matched opportunities and foundations, from Grant Studio's own matching. */
function Results({ created, startedAt, elapsed, onElapsed }: { created: CreatedOrganization; startedAt: number; elapsed: number | null; onElapsed: (ms: number) => void }) {
  const id = created.applicant.id;
  const matches = useQuery({
    queryKey: ['grants', 'onboarding-matches', id],
    queryFn: async () => {
      const relevant = await apiGet<MatchesResponse>(`/grants/applicants/${id}/matches?relevantOnly=1&limit=5`);
      // No on-topic match yet: show the top eligible ones instead, and say so.
      if (relevant.matches.length > 0) return { ...relevant, onTopic: true };
      return { ...(await apiGet<MatchesResponse>(`/grants/applicants/${id}/matches?limit=5`)), onTopic: false };
    },
  });
  const foundations = useQuery({ queryKey: ['foundations', 'suggestions', id], queryFn: () => apiGet<Suggestions>(`/grants/applicants/${id}/foundation-suggestions`) });
  const marked = useRef(false);

  useEffect(() => {
    if (!matches.data || marked.current) return;
    marked.current = true;
    onElapsed(performance.now() - startedAt);
    grantsApi.markMatchesSeen(id).catch(() => {});
  }, [matches.data, id, startedAt, onElapsed]);

  const facts = created.facts.confirmed + created.facts.unconfirmed;
  return (
    <div className="space-y-5">
      <Notice tone="ok" title={`${created.applicant.name} is set up`}>
        {created.lookedUp ? `${facts} facts from IRS records saved to your fact library (${created.facts.confirmed} confirmed, ${created.facts.unconfirmed} to review). ` : 'Your details are saved. '}
        {elapsed !== null && <span>You reached your first matches in {durationLabel(elapsed)}.</span>}
      </Notice>
      <Notice tone="warn" title="Matches are guidance, not an eligibility decision">
        Each match explains why it fits. Read the notice’s eligibility section, and confirm it yourself before you apply.
      </Notice>
      <Panel>
        <PanelHeader title="Federal and state opportunities" description={matches.data && !matches.data.onTopic ? 'None matched your focus areas yet; these are open opportunities you may be eligible for.' : 'Open now, best fit first.'} />
        {matches.isLoading && <LoadingState label="Finding your first matches…" className="min-h-0" />}
        {matches.isError && (
          <div className="p-5">
            <StateMessage tone="error" className="mb-0" title="Matches could not load" description={errorMessage(matches.error)} action={<Button onClick={() => matches.refetch()}>Try again</Button>} />
          </div>
        )}
        {matches.data && matches.data.matches.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">No open opportunities fit this profile yet. Grant Studio checks official sources daily and shows new matches on your organization’s page.</p>
        )}
        {matches.data && matches.data.matches.length > 0 && (
          <ul className="divide-y divide-border" aria-label="First matches">
            {matches.data.matches.map(({ opportunity: o, match }) => (
              <li key={o.id} className="px-5 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/grant-studio/opportunities/${o.id}?org=${id}`} className="text-sm font-semibold text-foreground hover:text-brand focus-visible:text-brand">{o.title}</Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{o.agency ?? 'Funder not recorded'} · {o.jurisdiction ? `${o.jurisdiction} state program` : 'Federal'}</p>
                  </div>
                  <ScoreBadge score={match.score} />
                </div>
                {match.reasons[0] && <p className="mt-2 text-xs text-muted-foreground">{match.reasons[0]}</p>}
                <div className="mt-2"><DeadlineChip daysLeft={o.daysLeft} label={deadlineLabel(o)} /></div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <PanelHeader title="Foundations to research" description={HISTORY_LABEL} />
        {foundations.isLoading && <LoadingState label="Checking foundation giving…" className="min-h-0" />}
        {foundations.isError && <p role="alert" className="px-5 py-4 text-sm text-red-200">Foundation suggestions could not load. {errorMessage(foundations.error)}</p>}
        {foundations.data && foundations.data.suggestions.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">{foundations.data.missing ?? 'No foundation in the imported tax filings gave to your causes in your state yet.'}</p>
        )}
        {foundations.data && foundations.data.suggestions.length > 0 && (
          <ul className="divide-y divide-border" aria-label="Foundation suggestions">
            {foundations.data.suggestions.slice(0, 3).map((f) => (
              <li key={f.ein} className="px-5 py-4">
                <Link href={`/grant-studio/foundations/${f.ein}`} className="text-sm font-semibold text-foreground hover:text-brand focus-visible:text-brand">{f.name}</Link>
                <p className="mt-0.5 text-xs text-muted-foreground">Gave {usdWhole(f.inStateUsd)} in your state · {f.reasons[0]}</p>
              </li>
            ))}
          </ul>
        )}
        {foundations.data && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{foundations.data.note}</p>}
      </Panel>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" asChild><Link href="/get-started">Go to your checklist</Link></Button>
        <Button asChild className="gap-2"><Link href={`/grant-studio/organizations/${id}`}><Landmark className="h-4 w-4" aria-hidden="true" /> Open {created.applicant.name}</Link></Button>
      </div>
    </div>
  );
}
