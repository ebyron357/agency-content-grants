import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import {
  useGetBrand, useUpdateBrand, useListAudienceProfiles, useCreateAudienceProfile,
  useListBrandFacts, useListProjects,
  getGetBrandQueryKey, getListAudienceProfilesQueryKey, getListBrandFactsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { ChevronLeft, Plus, Trash2, FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

const TABS = ['Identity', 'Audience', 'Brand Facts', 'Brand Brain', 'Projects'] as const;
type Tab = typeof TABS[number];

interface BrainEntry {
  id: string; brandId: string; category: string; label: string; content: string;
  structured: unknown; enabled: boolean; provenance: string; sourceUrl: string | null;
}
interface BrainCategoryMeta { label: string; rule: boolean; description: string }
interface ValidationCheck { type: string; label: string; passed: boolean; score: number; detail: string; violations: string[] }

export default function BrandDetail() {
  const [, params] = useRoute('/brands/:id');
  const id = params?.id ?? '';
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('Identity');
  const [editing, setEditing] = useState(false);

  const { data: brand, isLoading } = useGetBrand(id);
  const updateBrand = useUpdateBrand();
  const { data: profiles, isLoading: profilesLoading } = useListAudienceProfiles(id);
  const createProfile = useCreateAudienceProfile();
  const { data: facts, isLoading: factsLoading } = useListBrandFacts(id);
  const createFact = useMutation({ mutationFn: (data: any) => apiPost(`/brands/${id}/brand-facts`, data) });
  const deleteFact = useMutation({ mutationFn: (fid: string) => apiDelete(`/brand-facts/${fid}`) });
  const { data: projects, isLoading: projectsLoading } = useListProjects({ brandId: id });

  const { data: brain, isLoading: brainLoading } = useQuery({
    queryKey: ['brand-brain', id],
    queryFn: () => apiGet<{ categories: Record<string, BrainCategoryMeta>; entries: BrainEntry[] }>(`/brands/${id}/brain`),
    enabled: !!id,
  });
  const createEntry = useMutation({
    mutationFn: (data: { category: string; label: string; content: string }) => apiPost(`/brands/${id}/brain/entries`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-brain', id] }),
  });
  const toggleEntry = useMutation({
    mutationFn: ({ entryId, enabled }: { entryId: string; enabled: boolean }) => apiPatch(`/brain-entries/${entryId}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-brain', id] }),
  });
  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => apiDelete(`/brain-entries/${entryId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brand-brain', id] }),
  });
  const [newEntry, setNewEntry] = useState({ category: 'positioning', label: '', content: '' });
  const [addingEntry, setAddingEntry] = useState(false);
  const [validateText, setValidateText] = useState('');
  const validateContent = useMutation({
    mutationFn: (content: string) => apiPost(`/brands/${id}/validate-content`, { content, useAi: false }) as Promise<{ checks: ValidationCheck[]; overallScore: number }>,
  });

  const [form, setForm] = useState<Record<string, string>>({});
  const [newFactClaim, setNewFactClaim] = useState('');
  const [newProfile, setNewProfile] = useState({ name: '', description: '', ageRange: '' });
  const [addingProfile, setAddingProfile] = useState(false);

  function startEdit() {
    if (!brand) return;
    setForm({
      name: brand.name ?? '', description: brand.description ?? '', industry: brand.industry ?? '',
      voiceDescription: brand.voiceDescription ?? '', tonePreferences: brand.tonePreferences ?? '',
      readingLevel: brand.readingLevel ?? '', preferredVocabulary: brand.preferredVocabulary ?? '',
      prohibitedVocabulary: brand.prohibitedVocabulary ?? '', geographicFocus: brand.geographicFocus ?? '',
      complianceNotes: brand.complianceNotes ?? '',
    });
    setEditing(true);
  }

  if (isLoading) return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-6 space-y-3">
        <div className="h-3 w-24 bg-stone-100 animate-pulse rounded" />
        <div className="h-8 w-64 bg-stone-100 animate-pulse rounded" />
        <div className="h-4 w-40 bg-stone-100 animate-pulse rounded" />
      </div>
      <div className="h-10 bg-stone-100 animate-pulse rounded mb-6" />
      <div className="h-64 bg-stone-100 animate-pulse rounded-lg" />
    </div>
  );
  if (!brand) return <div className="px-8 py-8 text-stone-400 text-sm">Brand not found</div>;

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-6">
        <Link href="/brands" className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 mb-3"><ChevronLeft className="w-3 h-3" /> All Brands</Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#111] font-serif">{brand.name}</h1>
            {brand.industry && <p className="text-stone-400 text-sm mt-1">{brand.industry}</p>}
          </div>
          {!editing && <Button variant="outline" size="sm" onClick={startEdit}>Edit Brand</Button>}
        </div>
      </div>

      <div className="border-b border-stone-200 mb-6">
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-[#C8102E] text-[#C8102E]' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Identity */}
      {activeTab === 'Identity' && (
        <div className="bg-white border border-stone-200 rounded-lg p-6 space-y-5">
          {editing ? (
            <>
              {([
                ['name', 'Brand Name', false], ['industry', 'Industry', false],
                ['description', 'Description', true], ['voiceDescription', 'Voice Description', true],
                ['tonePreferences', 'Tone Preferences', false], ['readingLevel', 'Reading Level', false],
                ['preferredVocabulary', 'Preferred Vocabulary', false], ['prohibitedVocabulary', 'Prohibited Words/Phrases', false],
                ['geographicFocus', 'Geographic Focus', false], ['complianceNotes', 'Compliance Notes', true],
              ] as [string, string, boolean][]).map(([key, label, multi]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">{label}</label>
                  {multi
                    ? <Textarea value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} rows={3} />
                    : <Input value={form[key] ?? ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />}
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <Button onClick={async () => { await updateBrand.mutateAsync({ id, data: form }); qc.invalidateQueries({ queryKey: getGetBrandQueryKey(id) }); setEditing(false); }} disabled={updateBrand.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
                  {updateBrand.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-x-8 gap-y-5">
              {[
                ['Description', brand.description], ['Voice Description', brand.voiceDescription],
                ['Tone Preferences', brand.tonePreferences], ['Reading Level', brand.readingLevel],
                ['Geographic Focus', brand.geographicFocus], ['Preferred Vocabulary', brand.preferredVocabulary],
                ['Prohibited Vocabulary', brand.prohibitedVocabulary], ['Compliance Notes', brand.complianceNotes],
              ].map(([label, val]) => val ? (
                <div key={label as string} className="col-span-2">
                  <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">{label}</p>
                  <p className="text-sm text-stone-700 leading-relaxed">{val}</p>
                </div>
              ) : null)}
            </div>
          )}
        </div>
      )}

      {/* Audience */}
      {activeTab === 'Audience' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setAddingProfile(true)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2"><Plus className="w-4 h-4" /> Add Audience</Button>
          </div>
          {addingProfile && (
            <form onSubmit={async e => { e.preventDefault(); await createProfile.mutateAsync({ id, data: newProfile as any }); qc.invalidateQueries({ queryKey: getListAudienceProfilesQueryKey(id) }); setAddingProfile(false); setNewProfile({ name: '', description: '', ageRange: '' }); }} className="bg-white border border-stone-200 rounded-lg p-5 space-y-3">
              <div><label className="text-xs font-medium text-stone-500 mb-1 block">Name *</label><Input value={newProfile.name} onChange={e => setNewProfile(p => ({ ...p, name: e.target.value }))} required /></div>
              <div><label className="text-xs font-medium text-stone-500 mb-1 block">Age Range</label><Input value={newProfile.ageRange} onChange={e => setNewProfile(p => ({ ...p, ageRange: e.target.value }))} placeholder="e.g. 25-40" /></div>
              <div><label className="text-xs font-medium text-stone-500 mb-1 block">Description</label><Textarea value={newProfile.description} onChange={e => setNewProfile(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
              <div className="flex gap-2"><Button type="submit" disabled={createProfile.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">{createProfile.isPending ? 'Adding…' : 'Add'}</Button><Button type="button" variant="outline" onClick={() => setAddingProfile(false)}>Cancel</Button></div>
            </form>
          )}
          {profilesLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="h-20 bg-stone-100 animate-pulse rounded-lg" />)}
            </div>
          )}
          {!profilesLoading && !profiles?.length && !addingProfile && (
            <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">
              No audience profiles yet. Add one to define your reader personas.
              <p className="mt-1 text-stone-500">Use the <span className="font-medium text-[#C8102E]">Add Audience</span> button above to create your first persona.</p>
            </div>
          )}
          {profiles?.map(profile => (
            <div key={profile.id} className="bg-white border border-stone-200 rounded-lg p-5">
              <p className="font-semibold text-stone-800">{profile.name}</p>
              {profile.demographics && <p className="text-sm text-stone-500 mt-1">{profile.demographics}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Brand Facts */}
      {activeTab === 'Brand Facts' && (
        <div className="space-y-4">
          <form onSubmit={async e => { e.preventDefault(); if (!newFactClaim.trim()) return; await createFact.mutateAsync({ claim: newFactClaim, isVerified: false }); qc.invalidateQueries({ queryKey: getListBrandFactsQueryKey(id) }); setNewFactClaim(''); }} className="flex gap-2">
            <Input value={newFactClaim} onChange={e => setNewFactClaim(e.target.value)} placeholder="Add a verified brand fact (e.g. 'Founded in 2010 in Austin, TX')" className="flex-1" />
            <Button type="submit" disabled={createFact.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Fact</Button>
          </form>
          <div className="space-y-2">
            {factsLoading && [1, 2, 3].map(i => <div key={i} className="h-12 bg-stone-100 animate-pulse rounded-lg" />)}
            {!factsLoading && !facts?.length && <p className="text-sm text-stone-400 py-4 text-center">No brand facts yet. Add facts that AI should always know about this brand.</p>}
            {facts?.map(fact => (
              <div key={fact.id} className="flex items-start gap-3 bg-white border border-stone-200 rounded-lg px-4 py-3">
                <p className="flex-1 text-sm text-stone-700">{fact.claim}</p>
                {fact.status === 'verified' && <Badge variant="outline" className="text-green-600 border-green-200 text-xs">Verified</Badge>}
                <ConfirmDialog
                  title="Delete brand fact?"
                  description="This brand fact will be permanently removed. This action cannot be undone."
                  disabled={deleteFact.isPending}
                  onConfirm={async () => { await deleteFact.mutateAsync(fact.id); qc.invalidateQueries({ queryKey: getListBrandFactsQueryKey(id) }); }}
                  trigger={
                    <button className="text-stone-300 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brand Brain */}
      {activeTab === 'Brand Brain' && (
        <div className="space-y-6">
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">Content Validator</p>
            <p className="text-xs text-stone-500 mb-3">Paste any draft to check it against this brand's rules — banned phrases, preferred terminology, required claims, and compliance.</p>
            <Textarea value={validateText} onChange={e => setValidateText(e.target.value)} rows={4} placeholder="Paste content to validate against this brand's rules…" />
            <div className="flex items-center gap-3 mt-2">
              <Button size="sm" disabled={!validateText.trim() || validateContent.isPending} onClick={() => validateContent.mutate(validateText)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
                {validateContent.isPending ? 'Checking…' : 'Check Against Brand Brain'}
              </Button>
              {validateContent.data && <span className="text-sm font-semibold text-stone-700">Overall score: {validateContent.data.overallScore}/100</span>}
            </div>
            {validateContent.data && (
              <div className="mt-3 space-y-2">
                {validateContent.data.checks.map(c => (
                  <div key={c.type} className={`text-xs rounded-lg px-3 py-2 border ${c.passed ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    <span className="font-medium">{c.label} ({c.score}/100):</span> {c.detail}
                    {c.violations.length > 0 && <span className="block mt-0.5 opacity-80">{c.violations.slice(0, 5).join('; ')}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setAddingEntry(true)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2"><Plus className="w-4 h-4" /> Add Knowledge</Button>
          </div>
          {addingEntry && brain && (
            <form onSubmit={async e => { e.preventDefault(); if (!newEntry.label.trim() || !newEntry.content.trim()) return; await createEntry.mutateAsync(newEntry); setAddingEntry(false); setNewEntry({ category: 'positioning', label: '', content: '' }); }} className="bg-white border border-stone-200 rounded-lg p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-stone-500 mb-1 block">Category</label>
                <select value={newEntry.category} onChange={e => setNewEntry(f => ({ ...f, category: e.target.value }))} className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm">
                  {Object.entries(brain.categories).map(([key, meta]) => <option key={key} value={key}>{meta.label}{meta.rule ? ' (rule)' : ''}</option>)}
                </select>
              </div>
              <div><label className="text-xs font-medium text-stone-500 mb-1 block">Label *</label><Input value={newEntry.label} onChange={e => setNewEntry(f => ({ ...f, label: e.target.value }))} required /></div>
              <div><label className="text-xs font-medium text-stone-500 mb-1 block">Content *</label><Textarea value={newEntry.content} onChange={e => setNewEntry(f => ({ ...f, content: e.target.value }))} rows={3} required /></div>
              <div className="flex gap-2"><Button type="submit" disabled={createEntry.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">{createEntry.isPending ? 'Adding…' : 'Add'}</Button><Button type="button" variant="outline" onClick={() => setAddingEntry(false)}>Cancel</Button></div>
            </form>
          )}

          {brainLoading && [1, 2, 3].map(i => <div key={i} className="h-14 bg-stone-100 animate-pulse rounded-lg" />)}
          {!brainLoading && !brain?.entries.length && !addingEntry && (
            <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">
              No brand knowledge entries yet. Add positioning, competitors, terminology, CTAs, and other standing knowledge that should guide generation for this brand.
            </div>
          )}
          {brain?.entries.length ? (
            <div className="space-y-2">
              {brain.entries.map(entry => (
                <div key={entry.id} className={`flex items-start gap-3 bg-white border rounded-lg px-4 py-3 ${entry.enabled ? 'border-stone-200' : 'border-stone-100 opacity-50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{brain.categories[entry.category]?.label ?? entry.category}</Badge>
                      {brain.categories[entry.category]?.rule && <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">Rule</Badge>}
                      {entry.provenance === 'imported' && <Badge variant="outline" className="text-xs text-stone-400">Imported</Badge>}
                      <p className="text-sm font-medium text-stone-800">{entry.label}</p>
                    </div>
                    <p className="text-sm text-stone-500 mt-1">{entry.content}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleEntry.mutate({ entryId: entry.id, enabled: !entry.enabled })} className="text-xs text-stone-400 hover:text-stone-700">
                      {entry.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <ConfirmDialog
                      title="Delete knowledge entry?"
                      description="This brand knowledge entry will be permanently removed."
                      disabled={deleteEntry.isPending}
                      onConfirm={() => deleteEntry.mutate(entry.id)}
                      trigger={<button className="text-stone-300 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Projects */}
      {activeTab === 'Projects' && (
        <div className="space-y-3">
          {projectsLoading && [1, 2, 3].map(i => <div key={i} className="h-14 bg-stone-100 animate-pulse rounded-lg" />)}
          {!projectsLoading && !projects?.length && (
            <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">
              No projects for this brand yet.{' '}
              <Link href="/projects" className="text-[#C8102E] underline">Create a project</Link>
            </div>
          )}
          {projects?.map(project => (
            <Link key={project.id} href={`/projects/${project.id}`} className="flex items-center gap-3 bg-white border border-stone-200 hover:border-stone-300 rounded-lg px-5 py-3.5 transition-colors">
              <FolderKanban className="w-4 h-4 text-stone-300" />
              <span className="flex-1 text-sm font-medium text-stone-700">{project.title}</span>
              <span className="text-xs text-stone-400 capitalize">{project.contentType}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${project.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-stone-100 text-stone-400'}`}>{project.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
