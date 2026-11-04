import { useState, type FormEvent } from 'react';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { errorMessage, grantsApi, useFacts, useInvalidateGrants, type Fact, type FactCategoryInfo } from '@/lib/grants';

interface FactForm {
  category: string;
  label: string;
  body: string;
  source: string;
  asOf: string;
  confirmed: boolean;
}

const emptyForm = (category = 'need'): FactForm => ({ category, label: '', body: '', source: '', asOf: '', confirmed: false });

function FactFields({ form, setForm, categories, idPrefix }: { form: FactForm; setForm: (f: FactForm) => void; categories: FactCategoryInfo[]; idPrefix: string }) {
  const hint = categories.find((c) => c.key === form.category)?.hint;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Category" hint={hint}>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={selectClass}>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </Field>
      <Field label="Label" hint="A short name, for example “Third-grade reading rate”.">
        <Input value={form.label} maxLength={160} onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Fact" hint="One accurate statement, as you would want a reviewer to read it.">
          <Textarea rows={3} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
      </div>
      <Field label="Source" hint="Report, document or URL it comes from.">
        <Input value={form.source} maxLength={500} onChange={(e) => setForm({ ...form, source: e.target.value })} />
      </Field>
      <Field label="True as of">
        <Input type="date" value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} />
      </Field>
      <label htmlFor={`${idPrefix}-confirmed`} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3 text-sm text-foreground sm:col-span-2">
        <input id={`${idPrefix}-confirmed`} type="checkbox" checked={form.confirmed} onChange={(e) => setForm({ ...form, confirmed: e.target.checked })} className="mt-1 h-4 w-4 accent-primary" />
        <span>I checked this fact against its source. Confirmed facts are the only ones AI drafting may use.</span>
      </label>
    </div>
  );
}

function toBody(form: FactForm) {
  return { category: form.category, label: form.label, body: form.body, source: form.source || null, asOf: form.asOf || null, confirmed: form.confirmed };
}

function FactItem({ fact, categories }: { fact: Fact; categories: FactCategoryInfo[] }) {
  const invalidate = useInvalidateGrants();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FactForm>({ category: fact.category, label: fact.label, body: fact.body, source: fact.source ?? '', asOf: fact.asOf ?? '', confirmed: fact.confirmed });
  const [error, setError] = useState('');

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await invalidate();
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (editing) {
    return (
      <li className="space-y-3 px-5 py-4">
        <FactFields form={form} setForm={setForm} categories={categories} idPrefix={`edit-${fact.id}`} />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={() => act(() => grantsApi.updateFact(fact.id, toBody(form)))} disabled={!form.label.trim() || !form.body.trim()}>Save fact</Button>
        </div>
      </li>
    );
  }
  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{fact.label}</p>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{fact.body}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {fact.source ? `Source: ${fact.source}` : 'No source recorded'}
            {fact.asOf ? ` · as of ${fact.asOf}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {fact.confirmed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed</span>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => act(() => grantsApi.updateFact(fact.id, { confirmed: true }))}>Confirm</Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${fact.label}`} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete ${fact.label}`} onClick={() => { if (window.confirm(`Delete “${fact.label}”?`)) void act(() => grantsApi.deleteFact(fact.id)); }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </div>
      </div>
      {!fact.confirmed && <p className="mt-2 text-xs text-amber-300">Not confirmed, so drafting does not use it.</p>}
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </li>
  );
}

export function FactLibrary({ applicantId }: { applicantId: string }) {
  const facts = useFacts(applicantId);
  const invalidate = useInvalidateGrants();
  const [form, setForm] = useState<FactForm>(emptyForm());
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  if (facts.isLoading) return <LoadingState label="Loading the fact library…" className="min-h-[20vh]" />;
  if (facts.isError || !facts.data) return <StateMessage tone="error" title="The fact library could not load" description={errorMessage(facts.error)} action={<Button onClick={() => facts.refetch()}>Try again</Button>} />;
  const { categories, facts: list } = facts.data;
  const confirmed = list.filter((f) => f.confirmed).length;

  async function add(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaved('');
    try {
      await grantsApi.createFact(applicantId, toBody(form));
      await invalidate();
      setForm(emptyForm(form.category));
      setSaved('Fact added.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <Notice tone="info" title="Write it once, use it in every application">
        Record the facts funders ask for again and again, each with its source. AI drafting uses only the facts you confirm and marks anything missing as [Add: …]. In demo mode, the draft outline lists them for you.
      </Notice>
      <Panel>
        <PanelHeader title="Add a fact" description={`${list.length} fact${list.length === 1 ? '' : 's'} on file, ${confirmed} confirmed.`} />
        <form onSubmit={add} className="space-y-3 px-5 py-4">
          <FactFields form={form} setForm={setForm} categories={categories} idPrefix="new-fact" />
          {error && <Notice tone="error">{error}</Notice>}
          {saved && <p role="status" className="text-xs text-emerald-300">{saved}</p>}
          <div className="flex justify-end">
            <Button type="submit" className="gap-1.5" disabled={!form.label.trim() || !form.body.trim()}><Plus className="h-4 w-4" aria-hidden="true" /> Add fact</Button>
          </div>
        </form>
      </Panel>
      {categories.filter((c) => list.some((f) => f.category === c.key)).map((c) => (
        <Panel key={c.key}>
          <PanelHeader title={c.label} description={c.hint} />
          <ul className="divide-y divide-border">
            {list.filter((f) => f.category === c.key).map((f) => <FactItem key={f.id} fact={f} categories={categories} />)}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
