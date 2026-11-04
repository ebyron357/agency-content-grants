import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ExternalLink, MapPin } from 'lucide-react';
import { Panel, PanelHeader } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { errorMessage, grantsApi, useInvalidateGrants, type Applicant, type PlaceDesignation, type PlaceStatus } from '@/lib/grants';

const CENSUS_GEOCODER = 'https://geocoding.geo.census.gov/geocoder/';

const today = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ item }: { item: PlaceDesignation }) {
  if (item.effectiveStatus === 'in') {
    return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> In a designated area</span>;
  }
  if (item.effectiveStatus === 'not_in') return <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">Not in one</span>;
  if (item.record?.status === 'in') return <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">Designation ended</span>;
  return <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">Not checked</span>;
}

function DesignationItem({ applicantId, item }: { applicantId: string; item: PlaceDesignation }) {
  const invalidate = useInvalidateGrants();
  const initial = () => ({
    status: item.record?.status ?? ('unknown' as PlaceStatus),
    place: item.record?.place ?? 'Principal office',
    geoRef: item.record?.geoRef ?? '',
    checkedOn: item.record?.checkedOn ?? '',
    validThrough: item.record?.validThrough ?? '',
    note: item.record?.note ?? '',
  });
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setForm(initial()), [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = `place-${item.key}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await grantsApi.setPlace(applicantId, item.key, {
        status: form.status,
        place: form.place || null,
        geoRef: form.geoRef || null,
        checkedOn: form.checkedOn || null,
        validThrough: form.validThrough || null,
        note: form.note || null,
      });
      await invalidate();
      setMessage('Saved.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const geoHint = item.geography === 'census tract' ? '11-digit tract GEOID' : item.geography === 'county' ? '5-digit county FIPS' : item.geography === 'ZIP Code Tabulation Area' ? '5-digit ZCTA' : 'Optional';
  return (
    <li className="space-y-3 px-5 py-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold text-foreground">{item.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.authority} · by {item.geography}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusBadge item={item} />
          {item.needsRecheck && <span className="inline-flex items-center rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-300">Recheck: over a year old</span>}
          <Button asChild size="sm" variant="secondary" className="gap-1.5">
            <a href={item.lookupUrl} target="_blank" rel="noreferrer">Check on the official tool <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens {item.authority} in a new tab)</span></a>
          </Button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{item.guidance}</p>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_minmax(0,1fr)_10rem_10rem_10rem]">
        <Field label="Result">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PlaceStatus, checkedOn: e.target.value !== 'unknown' && !form.checkedOn ? today() : form.checkedOn })} className={selectClass} aria-label={`${item.label} result`}>
            <option value="unknown">Not checked</option>
            <option value="in">In one</option>
            <option value="not_in">Not in one</option>
          </select>
        </Field>
        <Field label="Location checked"><Input value={form.place} maxLength={200} onChange={(e) => setForm({ ...form, place: e.target.value })} aria-label={`${item.label} location checked`} /></Field>
        <Field label={item.geography === 'address' ? 'Reference' : `${item.geography[0].toUpperCase()}${item.geography.slice(1)}`} hint={geoHint}><Input value={form.geoRef} inputMode={item.geography === 'address' ? 'text' : 'numeric'} maxLength={60} onChange={(e) => setForm({ ...form, geoRef: e.target.value.trim() })} aria-label={`${item.label} ${item.geography}`} /></Field>
        <Field label="Checked on"><Input type="date" max={today()} value={form.checkedOn} onChange={(e) => setForm({ ...form, checkedOn: e.target.value })} aria-label={`${item.label} checked on`} /></Field>
        <Field label="Valid through" hint="If the tool shows an end date."><Input type="date" value={form.validThrough} onChange={(e) => setForm({ ...form, validThrough: e.target.value })} aria-label={`${item.label} valid through`} /></Field>
        <Field label="Note" hint="For example the designation year, or a link to the saved result." className="sm:col-span-2 lg:col-span-4"><Input value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label={`${item.label} note`} /></Field>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm">Save</Button>
          <span role="status" className="text-xs text-muted-foreground">{message}</span>
        </div>
        {error && <div className="sm:col-span-2 lg:col-span-5"><Notice tone="error">{error}</Notice></div>}
      </form>
      {item.record?.recordedBy && item.record.status !== 'unknown' && (
        <p className="text-xs text-muted-foreground">Recorded by {item.record.recordedBy}{item.record.checkedOn ? `, checked ${item.record.checkedOn}` : ''}.</p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer text-foreground">Sources</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {item.sources.map((s) => <li key={s.url}><a className="underline hover:text-brand" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}
        </ul>
      </details>
    </li>
  );
}

function LocationForm({ applicant }: { applicant: Applicant }) {
  const invalidate = useInvalidateGrants();
  const initial = () => ({ principalAddress: applicant.principalAddress ?? '', censusTract: applicant.censusTract ?? '', countyFips: applicant.countyFips ?? '' });
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setForm(initial()), [applicant]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await grantsApi.updateApplicant(applicant.id, { principalAddress: form.principalAddress || null, censusTract: form.censusTract || null, countyFips: form.countyFips || null });
      await invalidate();
      setMessage('Location saved.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Location"
        icon={<MapPin className="h-4 w-4 text-brand" aria-hidden="true" />}
        description="The address funders look at: usually the principal office, or the project site when the notice says so."
        actions={
          <Button asChild size="sm" variant="ghost" className="gap-1.5">
            <a href={CENSUS_GEOCODER} target="_blank" rel="noreferrer">Find the tract (Census Geocoder) <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">(opens census.gov in a new tab)</span></a>
          </Button>
        }
      />
      <form onSubmit={save} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] sm:items-end">
        <Field label="Street address"><Input value={form.principalAddress} maxLength={300} autoComplete="street-address" onChange={(e) => setForm({ ...form, principalAddress: e.target.value })} /></Field>
        <Field label="Census tract GEOID" hint="11 digits: state, county, tract."><Input value={form.censusTract} inputMode="numeric" maxLength={11} onChange={(e) => setForm({ ...form, censusTract: e.target.value.trim() })} /></Field>
        <Field label="County FIPS" hint="5 digits."><Input value={form.countyFips} inputMode="numeric" maxLength={5} onChange={(e) => setForm({ ...form, countyFips: e.target.value.trim() })} /></Field>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm">Save location</Button>
          <span role="status" className="text-xs text-muted-foreground">{message}</span>
        </div>
        {error && <div className="sm:col-span-4"><Notice tone="error">{error}</Notice></div>}
      </form>
    </Panel>
  );
}

export function PlaceDesignations({ applicant }: { applicant: Applicant }) {
  const places = applicant.places ?? [];
  const inCount = places.filter((p) => p.effectiveStatus === 'in').length;
  return (
    <div className="space-y-5">
      <Notice tone="info" title="Zones that can bring priority points or eligibility">
        Check your location on each agency's own tool and record what it says. Grant Studio does not decide designations. Matches name every designation a notice mentions and what you recorded, and drafting may use the ones you recorded as in.
      </Notice>
      <LocationForm applicant={applicant} />
      <Panel>
        <PanelHeader title="Place designations" description={`${inCount} of ${places.length} recorded as in a designated area.`} />
        <ul className="divide-y divide-border">
          {places.map((item) => <DesignationItem key={item.key} applicantId={applicant.id} item={item} />)}
        </ul>
      </Panel>
    </div>
  );
}
