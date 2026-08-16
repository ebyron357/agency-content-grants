import { useState, useRef, useEffect, useCallback } from 'react';
import { useRoute, Link, useSearch } from 'wouter';
import {
  useGetProject,
  useGetProjectWorkflowStatus,
  useGetResearchPlan,
  useGenerateResearchPlan,
  useListSources,
  useCreateSource,
  useFetchSourceContent,
  useListClaims,
  useVerifyClaim,
  useGetOutline,
  useGenerateOutline,
  useUpdateOutlineSection,
  useGetDocument,
  useInitDocument,
  useDraftDocumentSection,
  useEditDocumentSection,
  useGetQualityEvaluation,
  useRunQualityEvaluation,
  useListExports,
  useCreateExport,
  getGetProjectQueryKey,
  getGetResearchPlanQueryKey,
  getListSourcesQueryKey,
  getListClaimsQueryKey,
  getGetOutlineQueryKey,
  getGetDocumentQueryKey,
  getGetQualityEvaluationQueryKey,
  getListExportsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { apiPost, apiPatch, apiDelete } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDraftAllSections, type SectionProgress } from '@/hooks/useDraftAllSections';
import { ChevronLeft, Sparkles, CheckCircle, XCircle, Loader2, Lock, Unlock, Download, Plus, Trash2, AlertTriangle, RefreshCw, FileText, Upload, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RepurposeTab } from './RepurposeTab';
import { PublishDialog } from '@/components/publishing/PublishDialog';
import { RichEditor } from '@/components/RichEditor';

const WORKFLOW_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'research', label: 'Research Plan' },
  { id: 'sources', label: 'Sources' },
  { id: 'claims', label: 'Claims' },
  { id: 'outline', label: 'Outline' },
  { id: 'editor', label: 'Editor' },
  { id: 'quality', label: 'Quality' },
  { id: 'repurpose', label: 'Repurpose' },
  { id: 'export', label: 'Export' },
];

function ProgressPip({ status }: { status: string }) {
  if (status === 'completed') return <div className="w-2 h-2 rounded-full bg-green-500" />;
  if (status === 'active') return <div className="w-2 h-2 rounded-full bg-[#C8102E]" />;
  return <div className="w-2 h-2 rounded-full bg-stone-200" />;
}

function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  const v = value ?? 0;
  const color = v >= 80 ? 'bg-green-500' : v >= 60 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-stone-500">{label}</span>
        <span className="text-xs font-semibold text-stone-700">{v}</span>
      </div>
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({ project, workflowStatus, onEdit }: any) {
  const fields: [string, string | null | undefined][] = [
    ['Topic', project.topic], ['Content Type', project.contentType],
    ['Intended Audience', project.intendedAudience], ['Knowledge Level', project.audienceKnowledgeLevel],
    ['Purpose', project.purpose], ['Target Length', project.targetLength],
    ['Tone', project.tone], ['Reading Level', project.readingLevel],
    ['Point of View', project.pointOfView], ['Geographic Focus', project.geographicFocus],
    ['Research Freshness', project.researchFreshness], ['Citation Requirement', project.citationRequirement],
    ['Required Sections', project.requiredSections], ['Subjects to Avoid', project.subjectsToAvoid],
    ['Words to Avoid', project.wordsToAvoid],
  ];

  return (
    <div className="space-y-5">
      {workflowStatus && (
        <div className="bg-white border border-stone-200 rounded-lg p-5">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Pipeline</h3>
          <div className="flex items-start flex-wrap gap-y-2">
            {workflowStatus.stages?.map((stage: any, i: number) => (
              <div key={stage.stage} className="flex items-center">
                <div className="flex flex-col items-center gap-1">
                  <ProgressPip status={stage.status} />
                  <span className="text-[9px] text-stone-400 text-center leading-tight w-14">{stage.label}</span>
                </div>
                {i < workflowStatus.stages.length - 1 && (
                  <div className={`w-5 h-px mb-4 ${stage.status === 'completed' ? 'bg-green-400' : 'bg-stone-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white border border-stone-200 rounded-lg p-6">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Assignment Brief</h3>
          <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {fields.map(([label, val]) => val ? (
            <div key={label}>
              <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-0.5">{label}</p>
              <p className="text-sm text-stone-700 leading-relaxed">{val}</p>
            </div>
          ) : null)}
        </div>
      </div>
    </div>
  );
}

// ─── Research ─────────────────────────────────────────────────────────────────
function ResearchTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: plan, isLoading } = useGetResearchPlan(projectId);
  const generate = useGenerateResearchPlan();
  const approve = useMutation({ mutationFn: (id: string) => apiPost(`/research-plans/${id}/approve`) });

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-stone-800">Research Plan</h3>
        <Button onClick={async () => { await generate.mutateAsync({ id: projectId, data: {} }); qc.invalidateQueries({ queryKey: getGetResearchPlanQueryKey(projectId) }); }} disabled={generate.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {plan ? 'Regenerate' : 'Generate Plan'}
        </Button>
      </div>
      {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
      {plan && (
        <>
          <div className="bg-white border border-stone-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className={plan.status === 'approved' ? 'text-green-600 border-green-200' : 'text-stone-500'}>{plan.status}</Badge>
              {plan.status !== 'approved' && (
                <Button size="sm" onClick={async () => { await approve.mutateAsync((plan as any).id); qc.invalidateQueries({ queryKey: getGetResearchPlanQueryKey(projectId) }); }} className="bg-green-600 hover:bg-green-700 text-white">Approve Plan</Button>
              )}
            </div>
            {plan.summary && <div><p className="text-xs text-stone-400 font-medium uppercase tracking-wider mb-1">Summary</p><p className="text-sm text-stone-700 leading-relaxed">{plan.summary}</p></div>}
            <div className="grid grid-cols-2 gap-4">
              {plan.geographicBoundaries && <div><p className="text-xs text-stone-400 mb-0.5">Geographic Boundaries</p><p className="text-sm text-stone-700">{plan.geographicBoundaries}</p></div>}
              {plan.sourceCategories && <div><p className="text-xs text-stone-400 mb-0.5">Source Categories</p><p className="text-sm text-stone-700">{plan.sourceCategories}</p></div>}
              {plan.potentialConflicts && <div><p className="text-xs text-stone-400 mb-0.5">Potential Conflicts</p><p className="text-sm text-stone-700">{plan.potentialConflicts}</p></div>}
              {plan.missingInformation && <div><p className="text-xs text-stone-400 mb-0.5">Information Gaps</p><p className="text-sm text-stone-700">{plan.missingInformation}</p></div>}
            </div>
          </div>
          {(plan as any).questions?.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <h4 className="text-sm font-semibold text-stone-700 mb-3">Research Questions</h4>
              <ol className="space-y-2">
                {(plan as any).questions.map((q: any, i: number) => (
                  <li key={q.id ?? i} className="flex gap-3 items-start">
                    <span className="text-xs text-stone-300 font-mono mt-0.5 w-4 flex-shrink-0">{i + 1}</span>
                    <p className="text-sm text-stone-700">{q.question}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
      {!isLoading && !plan && (
        <div className="bg-white border border-dashed border-stone-200 rounded-lg p-10 text-center text-stone-400">
          <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-stone-500">No research plan yet</p>
          <p className="text-xs mt-1">Generate an AI-powered research strategy</p>
        </div>
      )}
        </div>
  );
}

// ─── Sources ──────────────────────────────────────────────────────────────────
function SourcesTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: sources, isLoading } = useListSources(projectId);
  const createSource = useCreateSource();
  const fetchContent = useFetchSourceContent();
  const approveSource = useMutation({ mutationFn: (id: string) => apiPost(`/sources/${id}/approve`) });
  const rejectSource = useMutation({ mutationFn: (id: string) => apiPost(`/sources/${id}/reject`, {}) });
  const reextractSource = useMutation({ mutationFn: (id: string) => apiPost(`/sources/${id}/reextract`) });
  const [adding, setAdding] = useState<'none' | 'url' | 'pdf'>('none');
  const [ns, setNs] = useState({ title: '', url: '', publisher: '', sourceType: 'web', publicationDate: '', relevantExcerpts: '' });

  // PDF upload state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfMeta, setPdfMeta] = useState({ title: '', publisher: '', author: '', publicationDate: '' });
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: getListSourcesQueryKey(projectId) });

  const statusColors: Record<string, string> = {
    pending: 'bg-stone-100 text-stone-500', approved: 'bg-green-50 text-green-700',
    rejected: 'bg-red-50 text-red-600', needs_review: 'bg-amber-50 text-amber-700',
  };

  const handlePdfUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) return;
    setPdfUploading(true);
    setPdfError(null);
    try {
      const formData = new FormData();
      formData.append('file', pdfFile);
      if (pdfMeta.title) formData.append('title', pdfMeta.title);
      if (pdfMeta.publisher) formData.append('publisher', pdfMeta.publisher);
      if (pdfMeta.author) formData.append('author', pdfMeta.author);
      if (pdfMeta.publicationDate) formData.append('publicationDate', pdfMeta.publicationDate);

      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      const resp = await fetch(`${base}/api/projects/${projectId}/sources/upload-pdf`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error ?? 'Upload failed');
      }
      refresh();
      setAdding('none');
      setPdfFile(null);
      setPdfMeta({ title: '', publisher: '', author: '', publicationDate: '' });
    } catch (err: any) {
      setPdfError(err.message ?? 'Upload failed');
    } finally {
      setPdfUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-stone-800">Source Library</h3>
        <div className="flex gap-2">
          <Button onClick={() => setAdding('pdf')} variant="outline" className="gap-2 text-stone-600"><FileText className="w-4 h-4" /> Upload PDF</Button>
          <Button onClick={() => setAdding('url')} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2"><Plus className="w-4 h-4" /> Add Source</Button>
        </div>
      </div>

      {/* URL / Manual form */}
      {adding === 'url' && (
        <form onSubmit={async e => { e.preventDefault(); await createSource.mutateAsync({ id: projectId, data: ns as any }); refresh(); setAdding('none'); setNs({ title: '', url: '', publisher: '', sourceType: 'web', publicationDate: '', relevantExcerpts: '' }); }} className="bg-white border border-stone-200 rounded-lg p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Title *</label><Input value={ns.title} onChange={e => setNs(s => ({ ...s, title: e.target.value }))} required /></div>
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Type</label>
              <select value={ns.sourceType} onChange={e => setNs(s => ({ ...s, sourceType: e.target.value }))} className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm">
                {['web', 'pdf', 'government', 'academic', 'industry_report', 'news', 'book', 'interview'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className="text-xs font-medium text-stone-500 mb-1 block">URL</label><Input value={ns.url} onChange={e => setNs(s => ({ ...s, url: e.target.value }))} placeholder="https://…" /></div>
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Publisher</label><Input value={ns.publisher} onChange={e => setNs(s => ({ ...s, publisher: e.target.value }))} /></div>
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Publication Date</label><Input type="date" value={ns.publicationDate} onChange={e => setNs(s => ({ ...s, publicationDate: e.target.value }))} /></div>
            <div className="col-span-2"><label className="text-xs font-medium text-stone-500 mb-1 block">Relevant Excerpts</label><Textarea value={ns.relevantExcerpts} onChange={e => setNs(s => ({ ...s, relevantExcerpts: e.target.value }))} rows={3} placeholder="Key quotes or statistics…" /></div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={createSource.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">{createSource.isPending ? 'Adding…' : 'Add Source'}</Button>
            <Button type="button" variant="outline" onClick={() => setAdding('none')}>Cancel</Button>
          </div>
        </form>
      )}

      {/* PDF upload form */}
      {adding === 'pdf' && (
        <form onSubmit={handlePdfUpload} className="bg-white border border-stone-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-[#C8102E]" />
            <h4 className="text-sm font-semibold text-stone-700">Upload PDF Document</h4>
          </div>

          {/* File picker */}
          <div>
            <label className="text-xs font-medium text-stone-500 mb-1 block">PDF File *</label>
            {pdfFile ? (
              <div className="flex items-center gap-3 bg-stone-50 border border-stone-200 rounded-md px-3 py-2">
                <FileText className="w-4 h-4 text-stone-400 flex-shrink-0" />
                <span className="text-sm text-stone-700 flex-1 truncate">{pdfFile.name}</span>
                <span className="text-xs text-stone-400">{(pdfFile.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => setPdfFile(null)} className="text-stone-400 hover:text-stone-600 text-xs">✕</button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-stone-200 rounded-lg p-6 cursor-pointer hover:border-[#C8102E] hover:bg-red-50/30 transition-colors">
                <Upload className="w-6 h-6 text-stone-300" />
                <span className="text-sm text-stone-500">Click to select a PDF</span>
                <span className="text-xs text-stone-400">Max 50 MB</span>
                <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) { setPdfFile(f); if (!pdfMeta.title) setPdfMeta(m => ({ ...m, title: f.name.replace(/\.pdf$/i, '') })); } }} />
              </label>
            )}
          </div>

          {/* Optional metadata */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Title <span className="text-stone-400">(auto-filled from filename)</span></label><Input value={pdfMeta.title} onChange={e => setPdfMeta(m => ({ ...m, title: e.target.value }))} placeholder="Document title" /></div>
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Author</label><Input value={pdfMeta.author} onChange={e => setPdfMeta(m => ({ ...m, author: e.target.value }))} /></div>
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Publisher</label><Input value={pdfMeta.publisher} onChange={e => setPdfMeta(m => ({ ...m, publisher: e.target.value }))} /></div>
            <div><label className="text-xs font-medium text-stone-500 mb-1 block">Publication Date</label><Input type="date" value={pdfMeta.publicationDate} onChange={e => setPdfMeta(m => ({ ...m, publicationDate: e.target.value }))} /></div>
          </div>

          {pdfError && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded px-3 py-2">{pdfError}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={pdfUploading || !pdfFile} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
              {pdfUploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Extracting text…</> : <><Upload className="w-4 h-4" /> Upload & Extract</>}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setAdding('none'); setPdfFile(null); setPdfError(null); }}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
        {!isLoading && !sources?.length && adding === 'none' && <div className="bg-white border border-dashed border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">No sources yet. Add URLs or upload PDF documents to build your research library.</div>}
        {sources?.map(source => (
          <div key={source.id} className="bg-white border border-stone-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[source.status ?? ''] ?? 'bg-stone-100 text-stone-500'}`}>{source.status}</span>
                  <span className="text-xs text-stone-400 capitalize">{source.sourceType}</span>
                  {(source as any).fileObjectPath && <span className="text-xs text-stone-400 flex items-center gap-1"><FileText className="w-3 h-3" /> PDF</span>}
                  {source.authorityScore != null && <span className="text-xs text-stone-400">Authority: {Math.round((source.authorityScore as number) * 100)}%</span>}
                </div>
                <p className="font-medium text-stone-800 mt-1.5 text-sm">{source.title}</p>
                {source.publisher && <p className="text-xs text-stone-400 mt-0.5">{source.publisher}{source.publicationDate ? ` · ${source.publicationDate}` : ''}</p>}
                {source.relevantExcerpts && <p className="text-xs text-stone-500 mt-2 line-clamp-2 italic">"{source.relevantExcerpts}"</p>}
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {(source as any).fileObjectPath && (
                  <>
                    <Button size="sm" variant="outline" asChild title="View PDF">
                      <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/sources/${source.id}/pdf`} target="_blank" rel="noopener noreferrer"><Download className="w-3.5 h-3.5" /></a>
                    </Button>
                    <Button size="sm" variant="outline" onClick={async () => { await reextractSource.mutateAsync(source.id); refresh(); }} disabled={reextractSource.isPending} title="Re-extract text from stored PDF"><RefreshCw className="w-3.5 h-3.5" /></Button>
                  </>
                )}
                {source.url && <Button size="sm" variant="outline" onClick={async () => { await fetchContent.mutateAsync({ id: source.id }); refresh(); }} disabled={fetchContent.isPending} title="Fetch content"><RefreshCw className="w-3.5 h-3.5" /></Button>}
                {source.status !== 'approved' && <Button size="sm" variant="outline" onClick={async () => { await approveSource.mutateAsync(source.id); refresh(); }} className="text-green-600 border-green-200 hover:bg-green-50"><CheckCircle className="w-3.5 h-3.5" /></Button>}
                {source.status !== 'rejected' && (
                  <ConfirmDialog
                    title="Reject source?"
                    confirmLabel="Reject"
                    description="This source will be marked as rejected and excluded from use in research and drafting."
                    disabled={rejectSource.isPending}
                    onConfirm={async () => { await rejectSource.mutateAsync(source.id); refresh(); }}
                    trigger={<Button size="sm" variant="outline" className="text-red-400 border-red-100 hover:bg-red-50"><XCircle className="w-3.5 h-3.5" /></Button>}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Claims ───────────────────────────────────────────────────────────────────
function ClaimsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: claims, isLoading } = useListClaims(projectId);
  const verify = useVerifyClaim();
  const createClaim = useMutation({ mutationFn: (data: any) => apiPost(`/projects/${projectId}/claims`, data) });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ claimText: '', claimType: 'statistical' });

  const refresh = () => qc.invalidateQueries({ queryKey: getListClaimsQueryKey(projectId) });

  const statusColors: Record<string, string> = {
    supported: 'text-green-600 bg-green-50', weakly_supported: 'text-amber-600 bg-amber-50',
    unsupported: 'text-red-600 bg-red-50', conflicting: 'text-orange-600 bg-orange-50',
    pending: 'text-stone-500 bg-stone-100', outdated: 'text-purple-600 bg-purple-50',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-stone-800">Claims Ledger</h3>
        <Button onClick={() => setAdding(true)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2"><Plus className="w-4 h-4" /> Add Claim</Button>
      </div>
      {adding && (
        <form onSubmit={async e => { e.preventDefault(); await createClaim.mutateAsync(form); refresh(); setAdding(false); setForm({ claimText: '', claimType: 'statistical' }); }} className="bg-white border border-stone-200 rounded-lg p-5 space-y-3">
          <div><label className="text-xs font-medium text-stone-500 mb-1 block">Claim Text *</label><Textarea value={form.claimText} onChange={e => setForm(f => ({ ...f, claimText: e.target.value }))} rows={2} placeholder="The specific factual claim to be verified…" required /></div>
          <div><label className="text-xs font-medium text-stone-500 mb-1 block">Type</label>
            <select value={form.claimType} onChange={e => setForm(f => ({ ...f, claimType: e.target.value }))} className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm">
              {['statistical', 'causal', 'definitional', 'comparative', 'predictive', 'normative', 'anecdotal'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={createClaim.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">{createClaim.isPending ? 'Adding…' : 'Add Claim'}</Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      )}
      <div className="space-y-2">
        {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
        {!isLoading && !claims?.length && !adding && <div className="bg-white border border-dashed border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">No claims tracked yet. Add factual claims to verify before they appear in content.</div>}
        {claims?.map((claim: any) => (
          <div key={claim.id} className="bg-white border border-stone-200 rounded-lg px-4 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-700 leading-snug">{claim.claimText}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[claim.verificationStatus ?? 'pending'] ?? 'bg-stone-100 text-stone-500'}`}>{claim.verificationStatus ?? 'pending'}</span>
                <span className="text-xs text-stone-400 capitalize">{claim.claimType}</span>
                {claim.confidence != null && <span className="text-xs text-stone-400">Confidence: {Math.round(claim.confidence * 100)}%</span>}
                {claim.sourceTitle && <span className="text-xs text-blue-600">Source: {claim.sourceTitle}</span>}
                {claim.timeSensitive && <span className="text-xs text-amber-500">⏰ Time-sensitive</span>}
              </div>
              {claim.reviewerNotes && <p className="text-xs text-stone-400 mt-1 italic">{claim.reviewerNotes}</p>}
            </div>
            <Button size="sm" variant="outline" onClick={async () => { await verify.mutateAsync({ id: claim.id }); refresh(); }} disabled={verify.isPending} className="flex-shrink-0">
              {verify.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verify'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Outline ──────────────────────────────────────────────────────────────────
function OutlineTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: outline, isLoading } = useGetOutline(projectId);
  const generate = useGenerateOutline();
  const updateSection = useUpdateOutlineSection();
  const approveOutline = useMutation({ mutationFn: (id: string) => apiPost(`/outlines/${id}/approve`) });
  const deleteSection = useMutation({ mutationFn: (id: string) => apiDelete(`/outline-sections/${id}`) });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const refresh = () => qc.invalidateQueries({ queryKey: getGetOutlineQueryKey(projectId) });
  const sections = (outline as any)?.sections ?? [];

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-stone-800">Content Outline</h3>
        <div className="flex gap-2">
          {outline && (outline as any).status !== 'approved' && (
            <Button size="sm" onClick={async () => { await approveOutline.mutateAsync((outline as any).id); refresh(); }} className="bg-green-600 hover:bg-green-700 text-white">Approve Outline</Button>
          )}
          <Button onClick={async () => { await generate.mutateAsync({ id: projectId, data: {} }); refresh(); }} disabled={generate.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {outline ? 'Regenerate' : 'Generate Outline'}
          </Button>
        </div>
      </div>
      {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
      {outline && (
        <div className="space-y-3">
          {sections.map((section: any, i: number) => (
            <div key={section.id} className="bg-white border border-stone-200 rounded-lg p-4">
              {editingId === section.id ? (
                <div className="space-y-3">
                  <Input value={editForm.title ?? ''} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                  <Textarea value={editForm.purpose ?? ''} onChange={e => setEditForm(f => ({ ...f, purpose: e.target.value }))} rows={2} placeholder="Purpose" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" value={editForm.targetWordCount ?? ''} onChange={e => setEditForm(f => ({ ...f, targetWordCount: Number(e.target.value) }))} placeholder="Target word count" />
                    <Input value={editForm.readerOutcome ?? ''} onChange={e => setEditForm(f => ({ ...f, readerOutcome: e.target.value }))} placeholder="Reader outcome" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={async () => { await updateSection.mutateAsync({ id: section.id, data: editForm }); refresh(); setEditingId(null); }} className="bg-[#C8102E] text-white">Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="text-sm font-mono text-stone-300 w-5 flex-shrink-0 mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-800">{section.title}</p>
                    {section.purpose && <p className="text-xs text-stone-500 mt-1">{section.purpose}</p>}
                    {section.targetWordCount && <p className="text-xs text-stone-400 mt-1">~{section.targetWordCount} words</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => { setEditingId(section.id); setEditForm({ title: section.title, purpose: section.purpose, targetWordCount: section.targetWordCount, readerOutcome: section.readerOutcome }); }}>Edit</Button>
                    <ConfirmDialog
                      title="Delete section?"
                      description="This outline section will be permanently removed. This action cannot be undone."
                      disabled={deleteSection.isPending}
                      onConfirm={async () => { await deleteSection.mutateAsync(section.id); refresh(); }}
                      trigger={<Button size="sm" variant="outline" className="text-red-400 border-red-100"><Trash2 className="w-3.5 h-3.5" /></Button>}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!isLoading && !outline && (
        <div className="bg-white border border-dashed border-stone-200 rounded-lg p-10 text-center text-stone-400">
          <Sparkles className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-stone-500">No outline yet</p>
          <p className="text-xs mt-1">Generate a structured outline based on your research and sources</p>
        </div>
      )}
    </div>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────
function EditorTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: doc, isLoading } = useGetDocument(projectId);
  const initDoc = useInitDocument();
  const draftSection = useDraftDocumentSection();
  const editSection = useEditDocumentSection();
  const lockSection = useMutation({ mutationFn: (id: string) => apiPost(`/document-sections/${id}/lock`) });
  const unlockSection = useMutation({ mutationFn: (id: string) => apiPost(`/document-sections/${id}/unlock`) });
  const approveSection = useMutation({ mutationFn: (id: string) => apiPost(`/document-sections/${id}/approve`) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editType, setEditType] = useState('natural_tone');
  const [richContent, setRichContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: getGetDocumentQueryKey(projectId) });
  const sections = (doc as any)?.sections ?? [];
  const selected = sections.find((s: any) => s.id === selectedId) ?? sections[0] ?? null;
  const isPending = draftSection.isPending || editSection.isPending;

  const handleSave = useCallback(async () => {
    if (!selected || !richContent) return;
    setSaving(true);
    setSaveError('');
    try {
      await apiPatch(`/document-sections/${selected.id}`, { content: richContent, contentFormat: 'html' });
      await refresh();
    } catch (err) {
      setSaveError((err as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [selected, richContent]);

  if (isLoading) return <div className="h-64 animate-pulse rounded-3xl border border-white/[0.08] bg-white/[0.03]" />;

  if (!doc) return (
    <div className="flex min-h-[520px] items-center justify-center rounded-3xl border border-dashed border-white/[0.12] bg-[#0d1017] p-10 text-center text-white">
      <div><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e5484d]/[0.12] text-[#ff9696]"><Sparkles className="h-5 w-5" /></div><p className="mb-2 font-semibold">No document yet</p><p className="mb-5 text-sm text-white/45">Create the document to start drafting from your approved outline.</p><Button onClick={async () => { await initDoc.mutateAsync({ id: projectId }); refresh(); }} disabled={initDoc.isPending} className="bg-[#e5484d] text-white hover:bg-[#f15b5f]">{initDoc.isPending ? 'Creating…' : 'Create document'}</Button></div>
    </div>
  );

  return (
    <div className="rounded-[28px] border border-white/[0.09] bg-[#0d1017] text-white shadow-2xl shadow-black/20">
      <div className="grid min-h-[720px] grid-cols-1 lg:grid-cols-[228px_minmax(0,1fr)_240px]">
        <aside className="border-b border-white/[0.08] p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Document map</p><p className="mt-1 text-xs text-white/45">{(doc as any).wordCount ?? 0} words</p></div><span className="rounded-full border border-white/[0.1] px-2 py-1 text-[10px] text-white/35">{sections.length} parts</span></div>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">{sections.map((section: any, index: number) => <button key={section.id} onClick={() => { setSelectedId(section.id); setRichContent(null); }} className={cn('group min-w-[170px] rounded-2xl border px-3 py-3 text-left transition-all lg:min-w-0 lg:w-full', selected?.id === section.id ? 'border-[#e5484d]/55 bg-[#e5484d]/[0.12]' : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.03]')}><div className="mb-2 flex items-center justify-between"><span className={cn('font-mono text-[10px]', selected?.id === section.id ? 'text-[#ff9696]' : 'text-white/25')}>{String(index + 1).padStart(2, '0')}</span><span className="flex items-center gap-1">{section.isLocked && <Lock className="h-3 w-3 text-white/35" />}{section.isApproved && <CheckCircle className="h-3 w-3 text-emerald-300" />}</span></div><p className={cn('line-clamp-2 text-xs font-medium leading-5', selected?.id === section.id ? 'text-white' : 'text-white/55')}>{section.title}</p><p className="mt-1 text-[10px] text-white/25">{section.wordCount > 0 ? `${section.wordCount} words` : 'Not drafted'}</p></button>)}</div>
        </aside>

        <section className="min-w-0 border-b border-white/[0.08] lg:border-b-0 lg:border-r">
          {selected ? <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-4 sm:px-8"><div><div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/30"><span className="h-1.5 w-1.5 rounded-full bg-[#ff7979]" /> Writing canvas</div><h3 className="text-lg font-semibold tracking-tight text-white">{selected.title}</h3><div className="mt-1 flex items-center gap-2 text-xs text-white/35"><span className="rounded-full border border-white/[0.1] px-2 py-0.5">{selected.status}</span><span>{selected.wordCount || 0} words</span>{richContent !== null && <span className="text-amber-300">Unsaved changes</span>}</div></div><div className="flex items-center gap-2">{selected.isLocked && <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] px-3 py-1.5 text-xs text-white/45"><Lock className="h-3.5 w-3.5" /> Locked</span>}<button type="button" onClick={async () => { selected.isLocked ? await unlockSection.mutateAsync(selected.id) : await lockSection.mutateAsync(selected.id); refresh(); }} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.1] px-3 text-xs text-white/55 transition hover:border-white/25 hover:text-white">{selected.isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}{selected.isLocked ? 'Unlock' : 'Lock'}</button>{!selected.isApproved && <button type="button" onClick={async () => { await approveSection.mutateAsync(selected.id); refresh(); }} className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-400/15 px-3 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/25"><CheckCircle className="h-3.5 w-3.5" /> Approve</button>}</div></div>
            {!selected.isLocked && <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] bg-white/[0.015] px-5 py-3 sm:px-8"><button type="button" onClick={async () => { setRichContent(null); await draftSection.mutateAsync({ id: selected.id }); refresh(); }} disabled={isPending} className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#e5484d] px-3.5 text-xs font-semibold text-white transition hover:bg-[#f15b5f] disabled:opacity-50">{draftSection.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{selected.content ? 'Re-draft section' : 'Draft section'}</button>{selected.content && <><select value={editType} onChange={e => setEditType(e.target.value)} className="h-9 rounded-xl border border-white/[0.1] bg-[#080a0f] px-3 text-xs text-white/65"><option value="natural_tone">Natural tone</option><option value="developmental">Developmental edit</option><option value="continuity">Continuity check</option><option value="proofread">Proofread</option><option value="shorten">Shorten</option><option value="expand">Expand</option><option value="simplify">Simplify</option></select><button type="button" onClick={async () => { setRichContent(null); await editSection.mutateAsync({ id: selected.id, data: { editType } }); refresh(); }} disabled={isPending} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.1] px-3 text-xs text-white/60 transition hover:border-white/25 hover:text-white">{editSection.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply edit</button></>}{richContent !== null && <div className="ml-auto flex items-center gap-2"><button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3.5 text-xs font-semibold text-[#0d1017] transition hover:bg-white/90">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{saving ? 'Saving…' : 'Save changes'}</button>{saveError && <span className="text-xs text-red-300">{saveError}</span>}</div>}</div>}
            <div className="min-h-[560px] lg:h-[calc(100vh-420px)]">{isPending ? <div className="flex h-full min-h-[560px] items-center justify-center"><div className="text-center"><Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-[#ff7979]" /><p className="text-sm text-white/60">AI is writing this section…</p><p className="mt-1 text-xs text-white/30">The canvas will update when the pass is complete.</p></div></div> : <RichEditor key={selected.id} sectionId={selected.id} initialContent={selected?.content ?? ''} contentFormat={selected?.contentFormat === 'html' ? 'html' : 'plain'} readOnly={selected.isLocked} onChange={(html) => setRichContent(html)} onImageInserted={() => refresh()} />}</div>
          </> : <div className="flex min-h-[560px] items-center justify-center p-8 text-center"><div><p className="text-sm font-medium text-white/65">Select a section to start writing</p><p className="mt-1 text-xs text-white/30">Your section navigation stays visible as you move through the draft.</p></div></div>}
        </section>

        <aside className="p-5 sm:p-6"><div className="mb-6 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Workspace intelligence</p><p className="mt-1 text-xs text-white/45">Context for this section</p></div><Sparkles className="h-4 w-4 text-[#ff7979]" /></div><div className="space-y-3"><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-white/65">Section state</span><span className="h-2 w-2 rounded-full bg-emerald-300" /></div><p className="text-2xl font-semibold text-white">{selected?.wordCount ?? 0}</p><p className="mt-1 text-xs text-white/30">words in this pass</p><div className="mt-4 h-1 rounded-full bg-white/[0.08]"><div className="h-full w-[72%] rounded-full bg-[#e5484d]" /></div><p className="mt-2 text-[10px] text-white/30">Draft completeness · active</p></div><div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4"><p className="mb-2 text-xs font-medium text-amber-100">Review attention</p><p className="text-xs leading-5 text-amber-100/55">Claims and citations can be checked from the Quality and Sources stages before approval.</p><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('content-os-open-quality'))} className="mt-3 text-xs font-medium text-amber-200 underline underline-offset-4">View quality signals</button></div><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><p className="mb-3 text-xs font-medium text-white/65">Next best action</p><div className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-[#ff7979]" /><p className="text-xs leading-5 text-white/45">{selected?.isApproved ? 'Move to the next section or export the document.' : 'Review this section, then approve it when the voice and evidence feel right.'}</p></div></div></div></aside>
      </div>
    </div>
  );
}

// ─── Quality ──────────────────────────────────────────────────────────────────
function QualityTab({ projectId, brandId, documentId }: { projectId: string; brandId?: string; documentId?: string }) {
  const qc = useQueryClient();
  const { data: evaluation, isLoading } = useGetQualityEvaluation(projectId);
  const runEval = useRunQualityEvaluation();
  const [publishOpen, setPublishOpen] = useState(false);

  const scores: [string, number | null | undefined][] = evaluation ? [
    ['Accuracy', evaluation.accuracyScore], ['Citations', evaluation.citationScore],
    ['Source Quality', evaluation.sourceQualityScore], ['Coverage', evaluation.coverageScore],
    ['Coherence', evaluation.coherenceScore], ['Continuity', evaluation.continuityScore],
    ['Naturalness', evaluation.naturalnessScore], ['Usefulness', evaluation.usefulnessScore],
    ['Audience Fit', evaluation.audienceFitScore], ['Brand Fit', evaluation.brandFitScore],
    ['Readability', evaluation.readabilityScore], ['Originality', evaluation.repetitionScore],
  ] : [];

  const issues = (evaluation as any)?.issues ?? [];
  const severityColors: Record<string, string> = {
    critical: 'bg-red-50 border-red-100 text-red-700',
    warning: 'bg-amber-50 border-amber-100 text-amber-700',
    info: 'bg-blue-50 border-blue-100 text-blue-700',
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-stone-800">Quality Evaluation</h3>
        <Button onClick={async () => { await runEval.mutateAsync({ id: projectId }); qc.invalidateQueries({ queryKey: getGetQualityEvaluationQueryKey(projectId) }); }} disabled={runEval.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
          {runEval.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Run Evaluation
        </Button>
      </div>
      {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
      {evaluation && (
        <div className="space-y-5">
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${evaluation.isPublicationReady ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            {evaluation.isPublicationReady ? <CheckCircle className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
            <div className="flex-1">
              <p className="font-semibold text-stone-800 text-sm">{evaluation.isPublicationReady ? 'Ready for publication' : 'Not yet publication-ready'}</p>
              {evaluation.summary && <p className="text-xs text-stone-600 mt-0.5">{evaluation.summary}</p>}
            </div>
            {evaluation.isPublicationReady && documentId && brandId && (
              <Button size="sm" onClick={() => setPublishOpen(true)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-1.5 flex-shrink-0">
                <Send className="w-3.5 h-3.5" /> Publish
              </Button>
            )}
          </div>
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <h4 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">Quality Scores</h4>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              {scores.map(([label, value]) => <ScoreBar key={label} label={label} value={value} />)}
            </div>
          </div>
          {issues.length > 0 && (
            <div className="bg-white border border-stone-200 rounded-lg p-5">
              <h4 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Issues to Address</h4>
              <div className="space-y-2">
                {issues.map((issue: any, i: number) => (
                  <div key={issue.id ?? i} className={`rounded border px-4 py-3 ${severityColors[issue.severity] ?? 'bg-stone-50 border-stone-100 text-stone-700'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{issue.description}</p>
                      <span className="text-xs uppercase font-bold flex-shrink-0">{issue.severity}</span>
                    </div>
                    {issue.suggestedFix && <p className="text-xs mt-1 opacity-80">Fix: {issue.suggestedFix}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!isLoading && !evaluation && (
        <div className="bg-white border border-dashed border-stone-200 rounded-lg p-10 text-center text-stone-400">
          <CheckCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-stone-500">No evaluation yet</p>
          <p className="text-xs mt-1">Run a quality evaluation to get a publication readiness report</p>
        </div>
      )}
      {documentId && brandId && (
        <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} brandId={brandId} sourceType="document" documentId={documentId} itemLabel="this document" />
      )}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────
function ExportTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: exports, isLoading } = useListExports(projectId);
  const createExport = useCreateExport();
  const [format, setFormat] = useState('markdown');

  const FORMATS = [
    { value: 'markdown', label: 'Markdown (.md)' }, { value: 'html', label: 'HTML (.html)' },
    { value: 'txt', label: 'Plain Text (.txt)' }, { value: 'docx', label: 'Word Document (.docx)' },
    { value: 'pdf', label: 'PDF Document (.pdf)' },
  ];
  const statusColors: Record<string, string> = { completed: 'text-green-600', processing: 'text-amber-600', failed: 'text-red-500' };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <h3 className="font-semibold text-stone-800 mb-2">Export Document</h3>
        <p className="text-xs text-stone-500 mb-4">Every export includes an evidence register when this project has sources or claims, including source links, retrieval status, and supporting excerpts.</p>
        <div className="flex items-center gap-3">
          <select value={format} onChange={e => setFormat(e.target.value)} className="border border-stone-200 rounded-md px-3 py-2 text-sm flex-1">
            {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <Button onClick={async () => { await createExport.mutateAsync({ id: projectId, data: { format } }); qc.invalidateQueries({ queryKey: getListExportsQueryKey(projectId) }); }} disabled={createExport.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
            <Download className="w-4 h-4" />{createExport.isPending ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
        {exports?.map(exp => (
          <div key={exp.id} className="bg-white border border-stone-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <Download className="w-4 h-4 text-stone-300" />
            <div className="flex-1">
              <p className="text-sm font-medium text-stone-700">{exp.format} export</p>
              <p className="text-xs text-stone-400">{exp.createdAt ? new Date(exp.createdAt as string).toLocaleString() : ''}{exp.fileSizeBytes ? ` · ${Math.round((exp.fileSizeBytes as number) / 1024)}KB` : ''}</p>
              {exp.validationNotes && <p className="text-xs text-stone-400 mt-0.5">{exp.validationNotes}</p>}
            </div>
            <span className={`text-xs font-medium ${statusColors[exp.status ?? ''] ?? 'text-stone-400'}`}>{exp.status}</span>
            {exp.status === 'completed' && exp.fileUrl && (
              <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api${exp.fileUrl}`} download className="text-xs text-[#C8102E] underline hover:no-underline">Download</a>
            )}
          </div>
        ))}
        {!isLoading && !exports?.length && (
          <div className="bg-white border border-dashed border-stone-200 rounded-lg p-10 text-center text-stone-400">
            <Download className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium text-stone-500">No exports yet</p>
            <p className="text-xs mt-1">Download the finished document as PDF, DOCX, Markdown, or plain text using the controls above. Your document must exist first — create and draft it in the Editor tab before exporting.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Project Modal ───────────────────────────────────────────────────────
function EditProjectModal({ project, onClose, onSave }: any) {
  const [form, setForm] = useState<Record<string, string>>({
    title: project.title ?? '', topic: project.topic ?? '', purpose: project.purpose ?? '',
    intendedAudience: project.intendedAudience ?? '', audienceKnowledgeLevel: project.audienceKnowledgeLevel ?? '',
    targetLength: project.targetLength ?? '', tone: project.tone ?? '',
    readingLevel: project.readingLevel ?? '', pointOfView: project.pointOfView ?? '',
    geographicFocus: project.geographicFocus ?? '', researchFreshness: project.researchFreshness ?? '',
    citationRequirement: project.citationRequirement ?? '', requiredSections: project.requiredSections ?? '',
    subjectsToAvoid: project.subjectsToAvoid ?? '', wordsToAvoid: project.wordsToAvoid ?? '',
  });
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <h2 className="font-serif text-xl font-bold mb-5">Edit Assignment Brief</h2>
        <div className="grid grid-cols-2 gap-4">
          {([
            ['title', 'Title', false, true], ['topic', 'Topic', true, false], ['purpose', 'Purpose', false, false],
            ['intendedAudience', 'Intended Audience', false, false], ['audienceKnowledgeLevel', 'Knowledge Level', false, false],
            ['targetLength', 'Target Length', false, false], ['tone', 'Tone', false, false],
            ['readingLevel', 'Reading Level', false, false], ['pointOfView', 'Point of View', false, false],
            ['geographicFocus', 'Geographic Focus', false, false], ['researchFreshness', 'Research Freshness', false, false],
            ['citationRequirement', 'Citation Requirement', false, false], ['requiredSections', 'Required Sections', true, false],
            ['subjectsToAvoid', 'Subjects to Avoid', false, false], ['wordsToAvoid', 'Words to Avoid', false, false],
          ] as [string, string, boolean, boolean][]).map(([key, label, multi, full]) => (
            <div key={key} className={full || multi ? 'col-span-2' : ''}>
              <label className="block text-xs font-medium text-stone-500 mb-1">{label}</label>
              {multi ? <Textarea value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} rows={2} /> : <Input value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-5">
          <Button disabled={saving} onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">{saving ? 'Saving…' : 'Save Changes'}</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Generation Progress View ─────────────────────────────────────────────────
// Shown during Quick mode Phase 2 (section-by-section drafting).

function GenerationProgressView({
  draftProgress,
  completedCount,
  totalCount,
  isRunning,
}: {
  draftProgress: SectionProgress[];
  completedCount: number;
  totalCount: number;
  isRunning: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[55vh] px-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-2">
          <div className="w-10 h-10 bg-[#C8102E] rounded-lg flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-xl font-bold text-[#111] font-serif">Writing your draft</h2>
          {totalCount > 0 ? (
            <p className="text-sm text-stone-500">{completedCount} of {totalCount} sections done</p>
          ) : (
            <p className="text-sm text-stone-500">Preparing sections…</p>
          )}
        </div>

        {draftProgress.length > 0 && (
          <div className="space-y-2 text-left">
            {draftProgress.map((section) => (
              <div key={section.sectionId} className="flex items-center gap-3">
                {section.status === 'done' ? (
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : section.status === 'drafting' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#C8102E] flex-shrink-0" />
                ) : section.status === 'error' ? (
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-stone-200 flex-shrink-0" />
                )}
                <span className={cn(
                  'text-sm truncate',
                  section.status === 'done' && 'text-stone-400',
                  section.status === 'drafting' && 'text-stone-800 font-medium',
                  section.status === 'error' && 'text-red-600',
                  (section.status === 'waiting') && 'text-stone-400',
                )}>
                  {section.title}
                </span>
              </div>
            ))}
          </div>
        )}

        {!isRunning && totalCount === 0 && (
          <div className="flex items-center justify-center gap-2 text-sm text-stone-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading document…</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const [, params] = useRoute('/projects/:id');
  const id = params?.id ?? '';
  const search = useSearch();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [editingProject, setEditingProject] = useState(false);
  const autoStartedRef = useRef(false);

  const { data: project, isLoading } = useGetProject(id);
  const { data: workflowStatus } = useGetProjectWorkflowStatus(id);
  const { data: docData } = useGetDocument(id);
  const updateProject = useMutation({ mutationFn: (data: any) => apiPatch(`/projects/${id}`, data) });

  const isQuickMode = new URLSearchParams(search).get('mode') === 'quick';

  // Called when all sections are drafted — run quality evaluation then show editor
  const handleAllDrafted = useCallback(async () => {
    try {
      await apiPost(`/projects/${id}/quality`);
      qc.invalidateQueries({ queryKey: getGetQualityEvaluationQueryKey(id) });
    } catch {
      // Quality is advisory; a failure here should not block the editor
    }
    qc.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetProjectQueryKey(id) });
    setActiveTab('editor');
  }, [id, qc]);

  const draftAll = useDraftAllSections({
    onAllComplete: handleAllDrafted,
    onSectionComplete: () => {
      qc.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) });
    },
  });

  // Auto-start section drafting when arriving via Quick mode
  useEffect(() => {
    if (!isQuickMode || autoStartedRef.current || draftAll.isRunning) return;
    const sections = (docData as any)?.sections as Array<{ id: string; title: string; status?: string | null }> | undefined;
    if (!sections?.some(s => !s.status || s.status === 'pending')) return;
    autoStartedRef.current = true;
    draftAll.start(sections);
  }, [isQuickMode, docData, draftAll.isRunning, draftAll.start]);

  if (isLoading) return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="mb-6 space-y-3">
        <div className="h-3 w-24 bg-stone-100 animate-pulse rounded" />
        <div className="h-8 w-2/3 bg-stone-100 animate-pulse rounded-lg" />
      </div>
      <div className="border-b border-stone-200 mb-6">
        <div className="flex gap-3 pb-2">
          {WORKFLOW_TABS.map(tab => <div key={tab.id} className="h-4 w-16 bg-stone-100 animate-pulse rounded" />)}
        </div>
      </div>
      <div className="space-y-4">
        <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />
        <div className="h-48 bg-stone-100 animate-pulse rounded-lg" />
      </div>
    </div>
  );
  if (!project) return <div className="px-8 py-8 text-stone-400 text-sm">Project not found</div>;

  // Show generation progress while Quick mode section drafting is in flight
  if (isQuickMode && (draftAll.isRunning || (draftAll.totalCount > 0 && draftAll.completedCount < draftAll.totalCount))) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="mb-6">
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 mb-3">
            <ChevronLeft className="w-3 h-3" /> All Projects
          </Link>
          <h1 className="text-2xl font-bold text-[#111] font-serif leading-snug">{project.title}</h1>
        </div>
        <GenerationProgressView
          draftProgress={draftAll.progress}
          completedCount={draftAll.completedCount}
          totalCount={draftAll.totalCount}
          isRunning={draftAll.isRunning}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080a0f] px-4 py-5 text-white sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-[1480px]">
        <div className="mb-7 flex items-center justify-between gap-4">
          <Link href="/projects" className="inline-flex items-center gap-2 text-xs text-white/40 transition hover:text-white"><ChevronLeft className="h-3.5 w-3.5" /> All projects</Link>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30"><span className="h-1.5 w-1.5 rounded-full bg-[#ff7979]" /> Editorial workspace</div>
        </div>
        <div className="mb-7 rounded-[28px] border border-white/[0.09] bg-[#10131a] p-5 shadow-2xl shadow-black/20 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><span className="rounded-full border border-[#e5484d]/35 bg-[#e5484d]/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#ff9b9b]">{project.contentType}</span><span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-2.5 py-1 text-[10px] font-medium text-emerald-200">{project.status}</span>{(project as any).brandName && <span className="text-xs text-white/35">{(project as any).brandName}</span>}</div><h1 className="max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">{project.title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">Move from brief to approved draft with evidence, quality signals, and a clear next action at every stage.</p></div>
            <div className="flex shrink-0 items-center gap-2"><span className="rounded-full border border-white/[0.1] px-3 py-2 text-xs text-white/45">{(docData as any)?.wordCount ?? 0} words</span><button type="button" onClick={() => setEditingProject(true)} className="rounded-xl border border-white/[0.1] px-3.5 py-2 text-xs font-medium text-white/65 transition hover:border-white/25 hover:text-white">Edit brief</button></div>
          </div>
        </div>

        <div className="mb-7 overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#10131a] p-1.5"><div className="flex min-w-max gap-1">{WORKFLOW_TABS.map(tab => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('rounded-xl px-3.5 py-2.5 text-xs font-medium whitespace-nowrap transition', activeTab === tab.id ? 'bg-white text-[#0d1017] shadow-lg' : 'text-white/38 hover:bg-white/[0.04] hover:text-white/80')}>{tab.label}</button>)}</div></div>

      {activeTab === 'overview' && <OverviewTab project={project} workflowStatus={workflowStatus} onEdit={() => setEditingProject(true)} />}
      {activeTab === 'research' && <ResearchTab projectId={id} />}
      {activeTab === 'sources' && <SourcesTab projectId={id} />}
      {activeTab === 'claims' && <ClaimsTab projectId={id} />}
      {activeTab === 'outline' && <OutlineTab projectId={id} />}
      {activeTab === 'editor' && <EditorTab projectId={id} />}
      {activeTab === 'quality' && <QualityTab projectId={id} brandId={(project as any)?.brandId} documentId={(docData as any)?.id} />}
      {activeTab === 'repurpose' && <RepurposeTab projectId={id} brandId={(project as any)?.brandId} />}
      {activeTab === 'export' && <ExportTab projectId={id} />}

      {editingProject && (
        <EditProjectModal project={project} onClose={() => setEditingProject(false)}
          onSave={async (form: any) => { await updateProject.mutateAsync(form); qc.invalidateQueries({ queryKey: getGetProjectQueryKey(id) }); setEditingProject(false); }} />
      )}
        </div>
      </div>
  );
}
