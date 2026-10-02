import { useState } from 'react';
import { useListProjects, useCreateProject, useListBrands, useListBlueprints, getListProjectsQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Plus, FolderKanban, ArrowRight, Search } from 'lucide-react';
import { PageHeader, PageShell, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';

const CONTENT_TYPES = ['blog', 'manual', 'ebook', 'sop', 'guide', 'whitepaper', 'newsletter', 'other'];

const STAGE_LABELS: Record<string, string> = {
  assignment: 'Assignment',
  sources: 'Sources',
  research_plan: 'Research',
  claims: 'Claims',
  outline: 'Outline',
  drafting: 'Drafting',
  editing: 'Editing',
  quality: 'Quality',
  export: 'Export',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-400/10 text-emerald-300',
  draft: 'bg-muted text-muted-foreground',
  completed: 'bg-sky-400/10 text-sky-300',
  archived: 'bg-muted text-muted-foreground',
};

export default function ProjectsList() {
  const qc = useQueryClient();
  const { data: projects, isLoading, isError, refetch } = useListProjects();
  const { data: brands } = useListBrands();
  const { data: blueprints } = useListBlueprints();
  const createProject = useCreateProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    brandId: '', title: '', contentType: 'blog', topic: '', purpose: '',
    intendedAudience: '', audienceKnowledgeLevel: 'intermediate', targetLength: '',
    tone: 'professional', geographicFocus: 'United States',
  });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createProject.mutateAsync(form as any);
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    setOpen(false);
    setStep(1);
    setForm({ brandId: '', title: '', contentType: 'blog', topic: '', purpose: '', intendedAudience: '', audienceKnowledgeLevel: 'intermediate', targetLength: '', tone: 'professional', geographicFocus: 'United States' });
  }

  const brandMap = Object.fromEntries((brands ?? []).map(b => [b.id, b.name]));

  const query = search.trim().toLowerCase();
  const [typeFilter, setTypeFilter] = useState('all');
  const sorted = [...(projects ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const types = Array.from(new Set(sorted.map(p => p.contentType))).sort();
  const filteredProjects = sorted.filter(p =>
    (typeFilter === 'all' || p.contentType === typeFilter) &&
    (!query ||
      (p.title ?? '').toLowerCase().includes(query) ||
      ((p as any).topic ?? '').toLowerCase().includes(query) ||
      ((p as any).brandName ?? '').toLowerCase().includes(query)));

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Documents"
        title="Documents"
        description={`${projects?.length ?? 0} document project${projects?.length === 1 ? '' : 's'} across all brands, most recently updated first.`}
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Blank project
            </Button>
            <Link
              href="/create"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> New content
            </Link>
          </>
        }
      />

      {isError && (
        <StateMessage
          tone="error"
          title="Documents could not be loaded."
          description="Nothing has been lost. Check the connection and try again."
          action={<Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>}
        />
      )}

      {isLoading && (
        <div className="space-y-3" role="status" aria-label="Loading documents">
          {[1, 2, 3].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-card" />)}
        </div>
      )}

      {!isLoading && !isError && !projects?.length && (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <FolderKanban className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">No documents yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Describe what you want to write and Content OS will build the brief, research plan, outline and first draft.</p>
          <Link href="/create" className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" aria-hidden="true" /> Create your first document
          </Link>
        </div>
      )}

      {!isLoading && !!projects?.length && (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title, topic or brand…"
              aria-label="Search documents"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by content type">
            {['all', ...types].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                aria-pressed={typeFilter === t}
                className={`h-8 rounded-lg border px-3 text-xs font-medium capitalize transition-colors ${typeFilter === t ? 'border-brand/50 bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {t === 'all' ? 'All types' : t}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card empty:hidden">
        {!isLoading && !!projects?.length && !filteredProjects.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">No documents match your search.</p>
        )}
        <ul className="divide-y divide-border">
          {filteredProjects.map(project => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-secondary/50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{project.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-0.5 font-medium capitalize text-foreground/85">{project.contentType}</span>
                    {(project as any).brandName && <span>{(project as any).brandName}</span>}
                    <span aria-hidden="true">·</span>
                    <span>Stage: <span className="text-foreground/85">{STAGE_LABELS[project.workflowStage ?? ''] ?? project.workflowStage}</span></span>
                    <span aria-hidden="true">·</span>
                    <span className={`rounded px-1.5 py-0.5 capitalize ${STATUS_COLORS[project.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>{project.status}</span>
                    <span aria-hidden="true">·</span>
                    <span>Updated {new Date(project.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className="hidden shrink-0 items-center gap-1.5 text-xs font-semibold text-brand sm:inline-flex">
                  Resume <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-brand sm:hidden" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">New blank project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            {step === 1 && (
              <div className="space-y-4 mt-3">
                <div>
                  <label htmlFor="np-brand" className="mb-1.5 block text-xs font-medium text-muted-foreground">Brand *</label>
                  <select id="np-brand"
                    value={form.brandId}
                    onChange={e => set('brandId', e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    required
                  >
                    <option value="">Select a brand…</option>
                    {brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="np-type" className="mb-1.5 block text-xs font-medium text-muted-foreground">Content Type *</label>
                  <select id="np-type"
                    value={form.contentType}
                    onChange={e => set('contentType', e.target.value)}
                    className="h-10 w-full rounded-xl border border-input bg-background/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {CONTENT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="np-title" className="mb-1.5 block text-xs font-medium text-muted-foreground">Project Title *</label>
                  <Input id="np-title" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. The Complete First-Time Homebuyer's Guide" required />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="button" onClick={() => setStep(2)} disabled={!form.brandId || !form.title}>Next →</Button>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-4 mt-3">
                <div>
                  <label htmlFor="np-topic" className="mb-1.5 block text-xs font-medium text-muted-foreground">Topic / Core Subject</label>
                  <Textarea id="np-topic" value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="What is this content specifically about?" rows={2} />
                </div>
                <div>
                  <label htmlFor="np-audience" className="mb-1.5 block text-xs font-medium text-muted-foreground">Intended Audience</label>
                  <Input id="np-audience" value={form.intendedAudience} onChange={e => set('intendedAudience', e.target.value)} placeholder="e.g. First-time homebuyers aged 25-40" />
                </div>
                <div>
                  <label htmlFor="np-purpose" className="mb-1.5 block text-xs font-medium text-muted-foreground">Purpose</label>
                  <Input id="np-purpose" value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="What should the reader be able to do after reading?" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="np-length" className="mb-1.5 block text-xs font-medium text-muted-foreground">Target Length</label>
                    <Input id="np-length" value={form.targetLength} onChange={e => set('targetLength', e.target.value)} placeholder="e.g. 2000-3000 words" />
                  </div>
                  <div>
                    <label htmlFor="np-tone" className="mb-1.5 block text-xs font-medium text-muted-foreground">Tone</label>
                    <Input id="np-tone" value={form.tone} onChange={e => set('tone', e.target.value)} placeholder="e.g. Professional, warm" />
                  </div>
                </div>
                <div className="flex justify-between gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>← Back</Button>
                  <Button type="submit" disabled={createProject.isPending}>
                    {createProject.isPending ? 'Creating…' : 'Create project'}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
