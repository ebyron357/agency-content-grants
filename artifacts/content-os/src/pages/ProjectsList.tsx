import { useState } from 'react';
import { useListProjects, useCreateProject, useListBrands, useListBlueprints, getListProjectsQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Plus, FolderKanban, ChevronRight } from 'lucide-react';
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
  active: 'bg-green-50 text-green-700',
  draft: 'bg-stone-100 text-stone-500',
  completed: 'bg-blue-50 text-blue-700',
  archived: 'bg-stone-100 text-stone-400',
};

export default function ProjectsList() {
  const qc = useQueryClient();
  const { data: projects, isLoading } = useListProjects();
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
  const filteredProjects = query
    ? (projects ?? []).filter(p =>
        (p.title ?? '').toLowerCase().includes(query) ||
        ((p as any).topic ?? '').toLowerCase().includes(query))
    : (projects ?? []);

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#111] font-serif">Content Projects</h1>
          <p className="text-stone-500 mt-1 text-sm">{projects?.length ?? 0} projects across all brands</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
          <Plus className="w-4 h-4" /> New Project
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-stone-100 animate-pulse rounded-lg" />)}
        </div>
      )}

      {!isLoading && !projects?.length && (
        <div className="text-center py-16 text-stone-400">
          <FolderKanban className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-stone-600">No projects yet</p>
          <p className="text-sm mt-1">Create your first content project to begin</p>
          <Button onClick={() => setOpen(true)} className="mt-4 bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
            <Plus className="w-4 h-4" /> Create your first project
          </Button>
        </div>
      )}

      {!isLoading && !!projects?.length && (
        <div className="mb-4">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects by title or topic…"
            className="max-w-sm"
          />
        </div>
      )}

      <div className="space-y-3">
        {!isLoading && !!projects?.length && !filteredProjects.length && (
          <p className="text-sm text-stone-400 py-4 text-center">No projects match “{search}”.</p>
        )}
        {filteredProjects.map(project => (
          <Link key={project.id} href={`/projects/${project.id}`} className="flex items-center gap-4 bg-white border border-stone-200 hover:border-stone-300 rounded-lg p-5 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs bg-stone-100 text-stone-500 px-2 py-0.5 rounded font-medium capitalize">{project.contentType}</span>
                  <span className={`text-xs px-2 py-0.5 rounded capitalize font-medium ${STATUS_COLORS[project.status ?? ''] ?? 'bg-stone-100 text-stone-400'}`}>{project.status}</span>
                </div>
                <p className="font-semibold text-[#111] font-serif text-base leading-snug">{project.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  {(project as any).brandName && (
                    <span className="text-xs text-stone-400">{(project as any).brandName}</span>
                  )}
                  <span className="text-xs text-stone-300">·</span>
                  <span className="text-xs text-stone-400">Stage: {STAGE_LABELS[project.workflowStage ?? ''] ?? project.workflowStage}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-500 transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">New Content Project</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            {step === 1 && (
              <div className="space-y-4 mt-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Brand *</label>
                  <select
                    value={form.brandId}
                    onChange={e => set('brandId', e.target.value)}
                    className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E] focus:border-transparent"
                    required
                  >
                    <option value="">Select a brand…</option>
                    {brands?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Content Type *</label>
                  <select
                    value={form.contentType}
                    onChange={e => set('contentType', e.target.value)}
                    className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]"
                  >
                    {CONTENT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Project Title *</label>
                  <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. The Complete First-Time Homebuyer's Guide" required />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="button" onClick={() => setStep(2)} disabled={!form.brandId || !form.title} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">Next →</Button>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-4 mt-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Topic / Core Subject</label>
                  <Textarea value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="What is this content specifically about?" rows={2} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Intended Audience</label>
                  <Input value={form.intendedAudience} onChange={e => set('intendedAudience', e.target.value)} placeholder="e.g. First-time homebuyers aged 25-40" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Purpose</label>
                  <Input value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="What should the reader be able to do after reading?" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1.5">Target Length</label>
                    <Input value={form.targetLength} onChange={e => set('targetLength', e.target.value)} placeholder="e.g. 2000-3000 words" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1.5">Tone</label>
                    <Input value={form.tone} onChange={e => set('tone', e.target.value)} placeholder="e.g. Professional, warm" />
                  </div>
                </div>
                <div className="flex justify-between gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>← Back</Button>
                  <Button type="submit" disabled={createProject.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
                    {createProject.isPending ? 'Creating…' : 'Create Project'}
                  </Button>
                </div>
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
