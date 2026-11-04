import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { usePermissions } from '@/lib/account';
import {
  APPLICANT_KIND_LABELS,
  JURISDICTION_LABELS,
  LIMIT_LABELS,
  REQUIREMENT_KIND_LABELS,
  appliesToText,
  templateErrors,
  templatesApi,
  useInvalidateTemplates,
  useTemplate,
  useTemplates,
  type TemplateDraft,
  type TemplateRequirement,
  type TemplateSection,
} from '@/lib/templates';

/**
 * One template: read only for built-in templates (with Duplicate), an editor
 * for the workspace's own, and a blank editor at /grant-studio/templates/new.
 * The server validates everything again and returns every problem it finds.
 */

const EMPTY: TemplateDraft = {
  label: '',
  description: '',
  appliesTo: { applicantKind: 'any', jurisdiction: 'any', titleIncludes: null },
  sections: [{ key: '', title: '', guidance: '', limitType: 'words', limitValue: 500 }],
  requirements: [],
};

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The key the server will derive for a section, so requirements can point at sections not saved yet. */
function keyOf(s: TemplateSection): string {
  const source = s.key || s.title;
  return source.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'section';
}

function SectionEditor({ section, index, count, onChange, onMove, onRemove }: { section: TemplateSection; index: number; count: number; onChange: (s: TemplateSection) => void; onMove: (to: number) => void; onRemove: () => void }) {
  const n = index + 1;
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Section {n}</p>
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move section ${n} up`}><ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move section ${n} down`}><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={count === 1} onClick={onRemove} aria-label={`Remove section ${n}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_10rem_8rem]">
        <Field label={`Section ${n} title`}><Input value={section.title} maxLength={200} onChange={(e) => onChange({ ...section, title: e.target.value })} required /></Field>
        <Field label={`Section ${n} limit`}>
          <select className={selectClass} value={section.limitType ?? ''} onChange={(e) => onChange({ ...section, limitType: (e.target.value || null) as TemplateSection['limitType'], limitValue: e.target.value ? section.limitValue ?? 500 : null })}>
            <option value="">No limit</option>
            {Object.entries(LIMIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label={`Section ${n} maximum`}>
          <Input type="number" min={1} max={100000} value={section.limitValue ?? ''} disabled={!section.limitType} onChange={(e) => onChange({ ...section, limitValue: e.target.value ? Number(e.target.value) : null })} />
        </Field>
      </div>
      <Field label={`Section ${n} guidance`} hint="What a strong answer covers. Writers see it above the section, and AI drafting follows it.">
        <Textarea rows={3} maxLength={4000} value={section.guidance} onChange={(e) => onChange({ ...section, guidance: e.target.value })} />
      </Field>
    </li>
  );
}

function RequirementEditor({ req, index, sections, onChange, onRemove }: { req: TemplateRequirement; index: number; sections: TemplateSection[]; onChange: (r: TemplateRequirement) => void; onRemove: () => void }) {
  const n = index + 1;
  return (
    <li className="grid gap-3 px-5 py-4 md:grid-cols-[10rem_1fr_12rem_auto] md:items-end">
      <Field label={`Requirement ${n} kind`}>
        <select className={selectClass} value={req.kind} onChange={(e) => onChange({ ...req, kind: e.target.value })}>
          {Object.entries(REQUIREMENT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label={`Requirement ${n}`}><Input value={req.label} maxLength={200} onChange={(e) => onChange({ ...req, label: e.target.value })} required /></Field>
      <Field label={`Requirement ${n} section`}>
        <select className={selectClass} value={req.sectionKey ?? ''} onChange={(e) => onChange({ ...req, sectionKey: e.target.value || undefined })}>
          <option value="">None</option>
          {sections.map((s) => <option key={keyOf(s)} value={keyOf(s)}>{s.title || keyOf(s)}</option>)}
        </select>
      </Field>
      <Button type="button" size="icon" variant="ghost" className="h-10 w-10" onClick={onRemove} aria-label={`Remove requirement ${n}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
      <div className="md:col-span-4">
        <Field label={`Requirement ${n} detail`}><Input value={req.detail} maxLength={2000} onChange={(e) => onChange({ ...req, detail: e.target.value })} placeholder="What the notice asks for, and where to confirm it" /></Field>
      </div>
    </li>
  );
}

function ReadOnly({ draft }: { draft: TemplateDraft }) {
  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title="Sections" description={`${draft.sections.length} sections, in order.`} />
        <ol className="divide-y divide-border">
          {draft.sections.map((s, i) => (
            <li key={s.key} className="px-5 py-3 text-sm">
              <p className="font-medium text-foreground">{i + 1}. {s.title} <span className="font-normal text-muted-foreground">{s.limitType ? `· ${s.limitValue?.toLocaleString('en-US')} ${s.limitType}` : '· no limit'}</span></p>
              {s.guidance && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.guidance}</p>}
            </li>
          ))}
        </ol>
      </Panel>
      <Panel>
        <PanelHeader title="Requirements" description="Each starts unconfirmed in a new application, until someone checks it against the notice." />
        <ul className="divide-y divide-border">
          {draft.requirements.map((r, i) => (
            <li key={`${r.label}-${i}`} className="px-5 py-3 text-sm">
              <p className="text-foreground"><span className="text-xs text-muted-foreground">{REQUIREMENT_KIND_LABELS[r.kind] ?? r.kind} · </span>{r.label}</p>
              {r.detail && <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export default function GrantTemplateEditor() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(params.key ?? '');
  const isNew = key === 'new';
  const loaded = useTemplate(isNew ? '' : key);
  const list = useTemplates();
  const invalidate = useInvalidateTemplates();
  const [, navigate] = useLocation();
  const { can } = usePermissions();
  const [draft, setDraft] = useState<TemplateDraft | null>(isNew ? EMPTY : null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNew && loaded.data) {
      const t = loaded.data;
      setDraft({ label: t.label, description: t.description ?? '', appliesTo: t.appliesTo, sections: t.sections, requirements: t.requirements });
    }
  }, [isNew, loaded.data]);

  const builtIn = !isNew && loaded.data?.builtIn === true;
  const editable = can('grants.write') && !builtIn;
  const dirty = useMemo(() => {
    if (isNew || !loaded.data || !draft) return isNew;
    const t = loaded.data;
    return JSON.stringify(draft) !== JSON.stringify({ label: t.label, description: t.description ?? '', appliesTo: t.appliesTo, sections: t.sections, requirements: t.requirements });
  }, [draft, loaded.data, isNew]);

  if (!isNew && loaded.isLoading) return <LoadingState label="Loading the template…" />;
  if (!isNew && (loaded.isError || !loaded.data)) return <PageShell><StateMessage tone="error" title="Template not found" description="It may have been removed, or it belongs to another workspace." action={<Button asChild><Link href="/grant-studio/templates">All templates</Link></Button>} /></PageShell>;
  if (!draft) return <LoadingState label="Loading the template…" />;

  const set = (patch: Partial<TemplateDraft>) => {
    setDraft({ ...draft, ...patch });
    setSaved('');
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSaved('');
    setBusy(true);
    try {
      const body = { ...draft!, description: draft!.description || null };
      if (isNew) {
        const created = await templatesApi.create(body);
        await invalidate();
        navigate(`/grant-studio/templates/${encodeURIComponent(created.key)}`, { replace: true });
      } else {
        const result = await templatesApi.save(key, { ...body, version: loaded.data!.version });
        await invalidate();
        setSaved(`Saved as version ${result.version}. New applications use it; applications already started keep their copy.`);
      }
    } catch (err) {
      setErrors(templateErrors(err));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    setErrors([]);
    try {
      const copy = await templatesApi.duplicate(key);
      await invalidate();
      navigate(`/grant-studio/templates/${encodeURIComponent(copy.key)}`);
    } catch (err) {
      setErrors(templateErrors(err));
    }
  }

  const label = isNew ? 'New template' : loaded.data!.label;
  const basedOn = !isNew && loaded.data!.basedOn ? list.data?.templates.find((t) => t.key === loaded.data!.basedOn)?.label ?? loaded.data!.basedOn : null;

  return (
    <PageShell width="default">
      <Link href="/grant-studio/templates" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All templates
      </Link>
      <PageHeader
        eyebrow={builtIn ? 'Built-in template' : 'Workspace template'}
        title={label}
        description={isNew ? 'Name it, say when it should be used, then lay out its sections and requirements.' : [`Used for ${appliesToText(draft.appliesTo)}`, basedOn ? `based on ${basedOn}` : null, !builtIn ? `version ${loaded.data!.version}` : null].filter(Boolean).join(' · ')}
        actions={!isNew && can('grants.write') ? <Button variant={builtIn ? 'default' : 'outline'} className="gap-2" onClick={duplicate}><Copy className="h-4 w-4" aria-hidden="true" /> {builtIn ? 'Duplicate to customize' : 'Duplicate'}</Button> : undefined}
      />
      {builtIn && <div className="mb-6"><Notice tone="info">Built-in templates are maintained with the product. Duplicate this one to change its sections, limits, guidance or requirements for your funders.</Notice></div>}

      {!editable ? (
        <ReadOnly draft={draft} />
      ) : (
        <form onSubmit={save} className="space-y-6" noValidate>
          <Panel>
            <PanelHeader title="About this template" />
            <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
              <Field label="Template name"><Input value={draft.label} maxLength={120} onChange={(e) => set({ label: e.target.value })} required /></Field>
              <Field label="Description (optional)"><Input value={draft.description ?? ''} maxLength={1000} onChange={(e) => set({ description: e.target.value })} /></Field>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="When to use it" description="New applications start from the most specific template whose rules fit. People can still choose another when they start." />
            <div className="grid gap-4 px-5 py-4 md:grid-cols-3">
              <Field label="Organization type">
                <select className={selectClass} value={draft.appliesTo.applicantKind} onChange={(e) => set({ appliesTo: { ...draft.appliesTo, applicantKind: e.target.value as TemplateDraft['appliesTo']['applicantKind'] } })}>
                  {Object.entries(APPLICANT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Programs">
                <select className={selectClass} value={draft.appliesTo.jurisdiction} onChange={(e) => set({ appliesTo: { ...draft.appliesTo, jurisdiction: e.target.value as TemplateDraft['appliesTo']['jurisdiction'] } })}>
                  {Object.entries(JURISDICTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Title contains (optional)" hint="For example “arts” or “SBIR”.">
                <Input value={draft.appliesTo.titleIncludes ?? ''} maxLength={100} onChange={(e) => set({ appliesTo: { ...draft.appliesTo, titleIncludes: e.target.value || null } })} />
              </Field>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Sections" description="In the order the notice asks for them. Limits are a starting point: each application confirms the notice's real limits." />
            <ol className="divide-y divide-border">
              {draft.sections.map((s, i) => (
                <SectionEditor
                  key={i}
                  section={s}
                  index={i}
                  count={draft.sections.length}
                  onChange={(next) => set({ sections: draft.sections.map((x, j) => (j === i ? next : x)) })}
                  onMove={(to) => set({ sections: move(draft.sections, i, to) })}
                  onRemove={() => set({ sections: draft.sections.filter((_, j) => j !== i), requirements: draft.requirements.filter((r) => r.sectionKey !== keyOf(s)) })}
                />
              ))}
            </ol>
            <div className="border-t border-border px-5 py-3">
              <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => set({ sections: [...draft.sections, { key: '', title: '', guidance: '', limitType: 'words', limitValue: 500 }] })}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add section</Button>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Requirements" description="Attachments, forms, eligibility and formatting rules to confirm. Each starts unconfirmed in a new application." />
            {draft.requirements.length ? (
              <ul className="divide-y divide-border">
                {draft.requirements.map((r, i) => (
                  <RequirementEditor key={i} req={r} index={i} sections={draft.sections} onChange={(next) => set({ requirements: draft.requirements.map((x, j) => (j === i ? next : x)) })} onRemove={() => set({ requirements: draft.requirements.filter((_, j) => j !== i) })} />
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">No requirements yet.</p>
            )}
            <div className="border-t border-border px-5 py-3">
              <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={() => set({ requirements: [...draft.requirements, { kind: 'attachment', label: '', detail: '' }] })}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add requirement</Button>
            </div>
          </Panel>

          {errors.length > 0 && (
            <div role="alert" className="rounded-2xl border border-red-400/25 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
              <p className="font-medium">Fix these to save:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {saved && <Notice tone="ok">{saved}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : isNew ? 'Create template' : 'Save changes'}</Button>
            {dirty && !isNew && <span className="text-xs text-amber-300">Unsaved changes</span>}
          </div>
        </form>
      )}
    </PageShell>
  );
}
