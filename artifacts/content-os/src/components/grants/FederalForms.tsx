import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { CheckCircle2, Circle, Download, MinusCircle, XCircle } from 'lucide-react';
import { LoadingState, Panel, PanelHeader, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Notice, selectClass } from '@/components/grants/GrantUi';
import { usePermissions } from '@/lib/account';
import { cn } from '@/lib/utils';
import { errorMessage, formsUrl, grantsApi, useFederalForms, useInvalidateGrants, type FederalFormKey, type FederalFormView, type FormFieldView, type FormStatus, type Workspace } from '@/lib/grants';

/**
 * Federal forms step (docs/GRANT_STUDIO.md, Federal forms): SF-424, SF-424A,
 * SF-424B and SF-LLL from Simpler Grants' public-domain definitions. Prefilled
 * where GrantCrest holds the data; everything else is for a person. The server
 * validates against each form's JSON Schema. GrantCrest never submits them.
 */

const STATUS_TEXT: Record<FormStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready_to_review: 'Ready to review',
  complete: 'Complete',
  not_applicable: 'Not applicable',
};

const SHORT: Record<FederalFormKey, string> = { sf424: 'SF-424', sf424a: 'SF-424A', sf424b: 'SF-424B', sflll: 'SF-LLL' };

function StatusIcon({ status }: { status: FormStatus }) {
  if (status === 'complete') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />;
  if (status === 'not_applicable') return <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  if (status === 'ready_to_review') return <Circle className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />;
  return <XCircle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />;
}

type Draft = Record<string, unknown>;

const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => JSON.stringify(isBlank(a) ? null : a) === JSON.stringify(isBlank(b) ? null : b);

function readOnlyText(field: FormFieldView): string {
  if (field.entry === 'grants_gov') return 'Filled by Grants.gov when you submit.';
  if (field.entry === 'attachment') return 'Attach this file in Grants.gov Workspace if it applies.';
  if (isBlank(field.value)) return field.entry === 'record' ? 'Not on record yet.' : 'Adds up when the amounts are entered.';
  if (typeof field.value === 'boolean') return field.value ? 'Yes' : 'No';
  if (Array.isArray(field.value)) return field.value.join('; ');
  return String(field.value);
}

function FieldControl({ field, value, onChange, onClear, disabled }: { field: FormFieldView; value: unknown; onChange: (v: unknown) => void; onClear?: () => void; disabled: boolean }) {
  const id = `ff-${field.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const invalid = field.errors.length > 0;
  const describedBy = [field.description ? helpId : '', invalid ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const editable = field.entry === 'person';
  const label = (
    <span className="text-sm font-medium text-foreground">
      {field.label}
      {field.required && editable && <span className="text-muted-foreground"> (required)</span>}
    </span>
  );
  const help = (
    <>
      {field.description && <span id={helpId} className="text-xs font-normal leading-relaxed text-muted-foreground">{field.description}</span>}
      {field.origin === 'prefill' && field.source && <span className="text-xs text-emerald-300">Prefilled from {field.source}. Change it here if it is wrong.</span>}
      {field.origin === 'entered' && (
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Entered by a person.
          {onClear && !disabled && <button type="button" className="font-medium text-brand hover:underline" onClick={onClear} aria-label={`Clear the entry for ${field.label}`}>Clear</button>}
        </span>
      )}
      {invalid && <span id={errorId} className="text-xs text-amber-300">{field.errors.join(' ')}</span>}
    </>
  );

  if (!editable) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {label}
        <p className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">{readOnlyText(field)}</p>
        {field.entry === 'record' && <span className="text-xs text-muted-foreground">From {field.id === 'sam_uei' ? 'the organization profile' : 'the opportunity record'}; change it there.</span>}
        {field.entry === 'computed' && <span className="text-xs text-muted-foreground">Calculated from the amounts above.</span>}
        {invalid && field.entry === 'record' && <span className="text-xs text-amber-300">{field.errors.join(' ')}</span>}
      </div>
    );
  }

  if (field.control === 'checkbox') {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm text-foreground">
          <input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : null)} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
          <span>{field.label}</span>
        </label>
        {help}
      </div>
    );
  }

  if (field.control === 'yesno') {
    return (
      <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={describedBy}>
        <legend className="mb-1.5 text-sm font-medium text-foreground">{field.label}{field.required && <span className="text-muted-foreground"> (required)</span>}</legend>
        <div className="flex gap-4">
          {[true, false].map((v) => (
            <label key={String(v)} className="flex items-center gap-2 text-sm text-foreground">
              <input type="radio" name={id} className="h-4 w-4 accent-primary" checked={value === v} onChange={() => onChange(v)} disabled={disabled} />
              {v ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    );
  }

  if (field.control === 'multiselect') {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex min-w-0 flex-col gap-1.5 sm:col-span-2" aria-describedby={describedBy}>
        <legend className="mb-1.5 text-sm font-medium text-foreground">
          {field.label}
          {field.maxItems ? <span className="text-muted-foreground">{` (choose up to ${field.maxItems})`}</span> : null}
        </legend>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-background p-2">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-secondary/60">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={chosen.includes(o)}
                disabled={disabled || (!chosen.includes(o) && field.maxItems !== undefined && chosen.length >= field.maxItems)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, o] : chosen.filter((c) => c !== o))}
              />
              <span className="min-w-0 break-words">{o}</span>
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    );
  }

  const common = { id, disabled, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };
  const text = isBlank(value) ? '' : String(value);
  let control;
  if (field.control === 'select') {
    control = (
      <select {...common} className={selectClass} value={text} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose…</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.control === 'textarea') {
    control = <Textarea {...common} rows={3} value={text} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const type = field.control === 'date' ? 'date' : field.control === 'email' ? 'email' : 'text';
    control = <Input {...common} type={type} inputMode={field.control === 'money' ? 'decimal' : undefined} placeholder={field.control === 'money' ? '0.00' : undefined} value={text} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', field.control === 'textarea' && 'sm:col-span-2')}>
      <label htmlFor={id}>{label}</label>
      {control}
      {help}
    </div>
  );
}

function FormEditor({ appId, form, canWrite, canReview }: { appId: string; form: FederalFormView; canWrite: boolean; canReview: boolean }) {
  const invalidate = useInvalidateGrants();
  const fields = useMemo(() => form.sections.flatMap((s) => s.fields), [form]);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const [reason, setReason] = useState(form.notApplicableReason ?? '');
  useEffect(() => {
    setDraft({});
    setMessage(null);
    setReason(form.notApplicableReason ?? '');
  }, [form.key, form.notApplicableReason]);

  const changed = Object.entries(draft).filter(([id, v]) => !same(v, fields.find((f) => f.id === id)?.value));
  const dirty = changed.length > 0;

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      await invalidate();
      setDraft({});
      setMessage({ tone: 'ok', text: ok });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    void act('save', () => grantsApi.saveForm(appId, form.key, { values: Object.fromEntries(changed.map(([id, v]) => [id, isBlank(v) ? null : v])) }), 'Saved. Fields still to complete are marked.');
  }

  const readOnly = !canWrite || form.notApplicable;

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{SHORT[form.key]}: {form.formName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {[`Version ${form.formVersion}`, form.ombNumber ? `OMB ${form.ombNumber}` : null, form.expirationDate ? `expires ${form.expirationDate}` : null].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-foreground"><StatusIcon status={form.status} /> {STATUS_TEXT[form.status]}
              {!form.notApplicable && <span className="text-xs text-muted-foreground">· {form.counts.toComplete} to complete · {form.counts.prefilled} prefilled · {form.counts.entered} entered</span>}
            </p>
            {form.status === 'complete' && form.reviewedBy && <p className="mt-1 text-xs text-emerald-300">Reviewed by {form.reviewedBy}{form.reviewedAt ? ` on ${new Date(form.reviewedAt).toLocaleDateString('en-US')}` : ''}.</p>}
            {form.reviewedBy && !form.reviewCurrent && !form.notApplicable && <p className="mt-1 text-xs text-amber-300">Changed since {form.reviewedBy} reviewed it: review it again.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(canWrite || canReview) && !form.notApplicable && (
              <Button size="sm" variant="outline" disabled={dirty || form.errorCount > 0 || form.status === 'complete' || busy === 'review'} onClick={() => act('review', () => grantsApi.reviewForm(appId, form.key), 'Marked reviewed.')}>
                {busy === 'review' ? 'Saving…' : form.status === 'complete' ? 'Reviewed' : 'Mark reviewed'}
              </Button>
            )}
          </div>
        </div>
        {form.canBeNotApplicable && canWrite && (
          <div className="space-y-3 border-b border-border px-5 py-4">
            <p className="text-sm text-muted-foreground">The SF-LLL is needed only when someone is paid to lobby Congress or a federal agency about this award. If no one is, record why and mark it not applicable.</p>
            {form.notApplicable ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-foreground">Not applicable: {form.notApplicableReason}{form.notApplicableBy ? ` (${form.notApplicableBy})` : ''}</p>
                <Button size="sm" variant="ghost" disabled={busy === 'na'} onClick={() => act('na', () => grantsApi.setFormApplicability(appId, form.key, { notApplicable: false }), 'The SF-LLL is back on the list.')}>Fill it in instead</Button>
              </div>
            ) : (
              <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void act('na', () => grantsApi.setFormApplicability(appId, form.key, { notApplicable: true, reason }), 'Marked not applicable, with your reason.'); }}>
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-medium text-foreground">
                  Why it does not apply
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No one is paid to lobby for this award." minLength={10} maxLength={1000} />
                </label>
                <Button type="submit" size="sm" variant="secondary" disabled={reason.trim().length < 10 || busy === 'na'}>Mark not applicable</Button>
              </form>
            )}
          </div>
        )}
        {message && <div role="status" className="px-5 pt-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
        {!message && <span role="status" className="sr-only" />}
        {form.formErrors.length > 0 && <div className="px-5 pt-4"><Notice tone="warn" title="To fix on this form">{form.formErrors.join(' ')}</Notice></div>}
        {form.attachmentNotes.length > 0 && !form.notApplicable && <div className="px-5 pt-4"><Notice tone="info">{form.attachmentNotes.join(' ')}</Notice></div>}
        {form.notApplicable ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">This form is marked not applicable, so it is left out of the package with the reason recorded.</p>
        ) : (
          <form onSubmit={save} aria-label={`${SHORT[form.key]} fields`}>
            {form.sections.map((section) => (
              <fieldset key={section.title} className="border-t border-border px-5 py-4 first:border-t-0">
                <legend className="sr-only">{section.title}</legend>
                <h3 aria-hidden="true" className="mb-3 text-sm font-semibold text-foreground">{section.title}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <FieldControl
                      key={field.id}
                      field={field}
                      value={Object.prototype.hasOwnProperty.call(draft, field.id) ? draft[field.id] : field.value}
                      onChange={(v) => setDraft((d) => ({ ...d, [field.id]: v }))}
                      onClear={dirty ? undefined : () => act('save', () => grantsApi.saveForm(appId, form.key, { reset: [field.id] }), 'Entry cleared. A prefilled value, where there is one, is back.')}
                      disabled={readOnly || busy === 'save'}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            {canWrite && (
              <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3">
                <Button type="submit" size="sm" disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Saving…' : dirty ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'Save'}</Button>
                {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({})}>Discard changes</Button>}
                {dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}
              </div>
            )}
          </form>
        )}
      </Panel>
    </div>
  );
}

export function FederalFormsStep({ ws }: { ws: Workspace }) {
  const forms = useFederalForms(ws.application.id);
  const { can, roleLabel } = usePermissions();
  const canWrite = can('grants.write');
  const canReview = can('grants.review');
  const [selected, setSelected] = useState<FederalFormKey>('sf424');

  if (forms.isLoading) return <LoadingState label="Loading the federal forms…" />;
  if (forms.isError || !forms.data) {
    return <StateMessage tone="error" title="The federal forms did not load" description={errorMessage(forms.error)} action={<Button onClick={() => forms.refetch()}>Try again</Button>} />;
  }
  const data = forms.data;
  if (!data.federal) {
    return <StateMessage title="No federal forms for this program" description="State programs use the forms on their own application portal. Check the notice for the forms it asks for." />;
  }
  const form = data.forms.find((f) => f.key === selected) ?? data.forms[0];
  const done = data.forms.filter((f) => f.status === 'complete' || f.status === 'not_applicable').length;

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Fill these here, then enter them in Grants.gov Workspace">
        GrantCrest prefills what it already knows from the organization profile, the opportunity and the budget, and marks the rest for you. It checks each form against the official field rules. It never submits anything to Grants.gov: you enter or upload the forms there yourself.
      </Notice>
      {!canWrite && <Notice tone="info">{`Your role (${roleLabel ?? 'none'}) can read the forms${canReview ? ' and mark a complete form reviewed' : ''}. A writer fills them in.`}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel className="h-fit">
            <PanelHeader title="Forms" description={`${done} of ${data.forms.length} complete`} />
            <nav aria-label="Federal forms">
              <ul className="divide-y divide-border">
                {data.forms.map((f) => (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(f.key)}
                      aria-current={f.key === form.key ? 'true' : undefined}
                      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60', f.key === form.key && 'bg-secondary')}
                    >
                      <StatusIcon status={f.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">{SHORT[f.key]}</span>
                        <span className="block text-[11px] text-muted-foreground">{STATUS_TEXT[f.status]}{f.status === 'in_progress' || f.status === 'not_started' ? ` · ${f.counts.toComplete} to complete` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </Panel>
          <Panel className="h-fit">
            <PanelHeader title="Download" description={ws.compliance.readyToExport ? 'The final forms, as approved with the package.' : 'Drafts, to check or share. The final forms come with the approved package.'} />
            <div className="space-y-2 px-5 py-4">
              <Button asChild variant="ghost" size="sm" className="w-full justify-start gap-2">
                <a href={formsUrl(ws.application.id, 'pdf', !ws.compliance.readyToExport)}><Download className="h-4 w-4" aria-hidden="true" /> {ws.compliance.readyToExport ? 'Forms (PDF)' : 'Draft forms (PDF)'}</a>
              </Button>
              <Button asChild variant="ghost" size="sm" className="w-full justify-start gap-2">
                <a href={formsUrl(ws.application.id, 'json', !ws.compliance.readyToExport)}><Download className="h-4 w-4" aria-hidden="true" /> {ws.compliance.readyToExport ? 'Forms data (JSON)' : 'Draft forms data (JSON)'}</a>
              </Button>
              <p className="text-xs text-muted-foreground">The package DOCX includes the same forms. Definitions: <a className="text-brand hover:underline" href={data.source.repository} target="_blank" rel="noreferrer">Simpler Grants (HHS)</a>, public domain.</p>
            </div>
          </Panel>
          <p className="px-1 text-xs text-muted-foreground">Organization details (EIN, UEI, state) come from the <Link href={`/grant-studio/organizations/${ws.applicant.id}`} className="text-brand hover:underline">organization profile</Link>.</p>
        </div>
        {form ? <FormEditor appId={ws.application.id} form={form} canWrite={canWrite} canReview={canReview} /> : <StateMessage title="No forms" />}
      </div>
    </div>
  );
}
