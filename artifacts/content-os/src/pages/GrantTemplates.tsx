import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Copy, FileText, Plus } from 'lucide-react';
import { PageHeader, PageShell, Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/grants/GrantUi';
import { usePermissions } from '@/lib/account';
import { appliesToText, templateErrors, templatesApi, useInvalidateTemplates, useTemplates, type TemplateSummary } from '@/lib/templates';

/** Grant Studio → Templates: the built-in templates and the workspace's own. */
export default function GrantTemplates() {
  const list = useTemplates();
  const invalidate = useInvalidateTemplates();
  const [, navigate] = useLocation();
  const { can } = usePermissions();
  const canEdit = can('grants.write');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function duplicate(t: TemplateSummary) {
    setError('');
    setBusy(t.key);
    try {
      const copy = await templatesApi.duplicate(t.key);
      await invalidate();
      navigate(`/grant-studio/templates/${encodeURIComponent(copy.key)}`);
    } catch (e) {
      setError(templateErrors(e).join(' '));
    } finally {
      setBusy('');
    }
  }

  async function toggleArchive(t: TemplateSummary) {
    setError('');
    try {
      await (t.status === 'archived' ? templatesApi.restore(t.key) : templatesApi.archive(t.key));
      await invalidate();
    } catch (e) {
      setError(templateErrors(e).join(' '));
    }
  }

  if (list.isLoading) return <LoadingState label="Loading templates…" />;
  if (list.isError || !list.data) return <PageShell><StateMessage tone="error" title="Templates could not load" description={templateErrors(list.error).join(' ')} action={<Button onClick={() => list.refetch()}>Try again</Button>} /></PageShell>;
  const builtIn = list.data.templates.filter((t) => t.builtIn);
  const own = list.data.templates.filter((t) => !t.builtIn);

  const row = (t: TemplateSummary) => (
    <li key={t.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/grant-studio/templates/${encodeURIComponent(t.key)}`} className="font-medium text-foreground underline-offset-4 hover:underline">{t.label}</Link>
          {t.builtIn && <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Built in</span>}
          {t.status === 'archived' && <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Archived</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t.sectionCount} sections · {t.requirementCount} requirements · used for {appliesToText(t.appliesTo)}
          {!t.builtIn ? ` · version ${t.version}` : ''}
        </p>
        {t.description && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
      </div>
      {canEdit && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="gap-1.5" disabled={busy === t.key} onClick={() => duplicate(t)} aria-label={`Duplicate ${t.label}`}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Duplicate
          </Button>
          {!t.builtIn && <Button size="sm" variant="ghost" onClick={() => toggleArchive(t)} aria-label={`${t.status === 'archived' ? 'Restore' : 'Archive'} ${t.label}`}>{t.status === 'archived' ? 'Restore' : 'Archive'}</Button>}
        </div>
      )}
    </li>
  );

  return (
    <PageShell width="default">
      <Link href="/grant-studio" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Grant Studio
      </Link>
      <PageHeader
        eyebrow="Grant Studio"
        title="Application templates"
        description="The sections and requirements a new application starts with. Applications copy their template when they start, so changing a template never changes work already under way."
        actions={canEdit ? <Button asChild className="gap-2"><Link href="/grant-studio/templates/new"><Plus className="h-4 w-4" aria-hidden="true" /> New template</Link></Button> : undefined}
      />
      {error && <div className="mb-4"><Notice tone="error">{error}</Notice></div>}
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Your templates" icon={<FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} description="Chosen automatically when their rules fit the organization and the opportunity, most specific first. You can also pick one when you start an application." />
          {own.length ? <ul className="divide-y divide-border">{own.map(row)}</ul> : <p className="px-5 py-5 text-sm text-muted-foreground">None yet. Duplicate a built-in template below to adapt it to the funders you apply to most, or start a new one.</p>}
        </Panel>
        <Panel>
          <PanelHeader title="Built-in templates" description="Maintained with the product and read only. Duplicate one to change it." />
          <ul className="divide-y divide-border">{builtIn.map(row)}</ul>
        </Panel>
      </div>
    </PageShell>
  );
}
