import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDocument,
  useListRepurposingChannels,
  useListRepurposingBatches,
  useCreateRepurposingBatch,
  useListRepurposedAssetRevisions,
  useUpdateRepurposedAsset,
  useRegenerateRepurposedAsset,
  useApproveRepurposedAsset,
  useRejectRepurposedAsset,
  useListRepurposingPresets,
  useCreateRepurposingPreset,
  useDeleteRepurposingPreset,
  getListRepurposingBatchesQueryKey,
  getListRepurposingPresetsQueryKey,
  type RepurposingBatch,
} from '@workspace/api-client-react';
import { Sparkles, Loader2, CheckCircle, XCircle, RefreshCw, History, ChevronDown, ChevronUp, Share2, Bookmark, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PublishDialog } from '@/components/publishing/PublishDialog';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-500',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-600',
};

const BATCH_STATUS_STYLES: Record<string, string> = {
  processing: 'text-amber-600',
  completed: 'text-green-600',
  partial: 'text-amber-600',
  failed: 'text-red-500',
};

function RevisionHistory({ assetId }: { assetId: string }) {
  const { data: revisions, isLoading } = useListRepurposedAssetRevisions(assetId);
  if (isLoading) return <p className="text-xs text-stone-400 py-2">Loading revisions…</p>;
  if (!revisions?.length) return <p className="text-xs text-stone-400 py-2">No prior versions yet.</p>;
  return (
    <div className="space-y-2 py-2">
      {revisions.map((rev) => (
        <div key={rev.id} className="border border-stone-100 rounded p-2 bg-stone-50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-stone-600">v{rev.versionNumber} · {rev.editType === 'manual_edit' ? 'Manual edit' : 'Regenerated'}</span>
            {rev.wasApproved && <span className="text-[10px] text-green-600 font-medium">was approved</span>}
          </div>
          <p className="text-xs text-stone-500 line-clamp-3 whitespace-pre-wrap">{rev.content}</p>
        </div>
      ))}
    </div>
  );
}

function AssetCard({ asset, channelLabel, projectId, batchId, brandId }: { asset: any; channelLabel: string; projectId: string; batchId: string; brandId?: string }) {
  const qc = useQueryClient();
  const [content, setContent] = useState(asset.content ?? '');
  const [showHistory, setShowHistory] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const update = useUpdateRepurposedAsset();
  const regenerate = useRegenerateRepurposedAsset();
  const approve = useApproveRepurposedAsset();
  const reject = useRejectRepurposedAsset();

  const refresh = () => qc.invalidateQueries({ queryKey: getListRepurposingBatchesQueryKey(projectId) });
  const dirty = content !== (asset.content ?? '');
  const busy = update.isPending || regenerate.isPending || approve.isPending || reject.isPending;

  if (asset.errorMessage && !asset.content) {
    return (
      <div className="bg-white border border-red-100 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-stone-800">{channelLabel}</span>
          <Badge className="bg-red-50 text-red-600">failed</Badge>
        </div>
        <p className="text-xs text-red-500 mb-3">{asset.errorMessage}</p>
        <Button size="sm" variant="outline" onClick={async () => { await regenerate.mutateAsync({ id: asset.id }); refresh(); }} disabled={busy} className="gap-1.5 text-xs h-7">
          {regenerate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-800">{channelLabel}</span>
          <Badge className={STATUS_STYLES[asset.status] ?? 'bg-stone-100 text-stone-500'}>{asset.status}</Badge>
          {asset.brandCheckScore != null && (
            <span className={`text-[11px] font-medium ${asset.brandCheckPassed === false ? 'text-amber-600' : 'text-stone-400'}`} title="Brand Brain consistency check">
              Brand check: {Math.round(asset.brandCheckScore)}
            </span>
          )}
          <span className="text-[11px] text-stone-300">v{asset.versionNumber}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => setShowHistory((s) => !s)}>
            <History className="w-3 h-3" /> {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={async () => { await regenerate.mutateAsync({ id: asset.id }); setShowHistory(false); refresh(); }} disabled={busy}>
            {regenerate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerate
          </Button>
          {asset.status !== 'approved' && (
            <Button size="sm" className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white gap-1" onClick={async () => { await approve.mutateAsync({ id: asset.id }); refresh(); }} disabled={busy}>
              <CheckCircle className="w-3 h-3" /> Approve
            </Button>
          )}
          {asset.status !== 'rejected' && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1 text-stone-500" onClick={async () => { await reject.mutateAsync({ id: asset.id }); refresh(); }} disabled={busy}>
              <XCircle className="w-3 h-3" /> Reject
            </Button>
          )}
          {asset.status === 'approved' && brandId && (
            <Button size="sm" className="h-7 px-2 text-xs bg-[#C8102E] hover:bg-[#a80d25] text-white gap-1" onClick={() => setPublishOpen(true)}>
              <Send className="w-3 h-3" /> Publish
            </Button>
          )}
        </div>
      </div>
      <div className="p-4 space-y-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={asset.channel === 'twitter_thread' || asset.channel === 'short_video_script' ? 8 : 5}
          className="text-sm font-sans leading-relaxed"
        />
        {dirty && (
          <div className="flex justify-end">
            <Button size="sm" onClick={async () => { await update.mutateAsync({ id: asset.id, data: { content } }); refresh(); }} disabled={busy} className="h-7 text-xs bg-[#C8102E] hover:bg-[#a80d25] text-white">
              {update.isPending ? 'Saving…' : 'Save edit'}
            </Button>
          </div>
        )}
        {showHistory && <RevisionHistory assetId={asset.id} />}
      </div>
      {brandId && (
        <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} brandId={brandId} sourceType="repurposed_asset" repurposedAssetId={asset.id} itemLabel={channelLabel} />
      )}
    </div>
  );
}

export function RepurposeTab({ projectId, brandId }: { projectId: string; brandId?: string }) {
  const qc = useQueryClient();
  const { data: doc } = useGetDocument(projectId);
  const { data: channels } = useListRepurposingChannels();
  const { data: batches, isLoading } = useListRepurposingBatches(projectId, {
    query: {
      queryKey: getListRepurposingBatchesQueryKey(projectId),
      refetchInterval: (q) => ((q.state.data as RepurposingBatch[] | undefined) ?? []).some((b) => b.status === 'processing') ? 2000 : false,
    },
  });
  const createBatch = useCreateRepurposingBatch();
  const { data: presets } = useListRepurposingPresets(brandId ?? '', {
    query: { queryKey: getListRepurposingPresetsQueryKey(brandId ?? ''), enabled: !!brandId },
  });
  const createPreset = useCreateRepurposingPreset();
  const deletePreset = useDeleteRepurposingPreset();

  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [documentSectionId, setDocumentSectionId] = useState<string>('');
  const [campaignName, setCampaignName] = useState('');
  const [tone, setTone] = useState('');
  const [audience, setAudience] = useState('');
  const [cta, setCta] = useState('');
  const [targetLength, setTargetLength] = useState('');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');

  const channelMap = useMemo(() => Object.fromEntries((channels ?? []).map((c) => [c.key, c.label])), [channels]);
  const sections = (doc as any)?.sections ?? [];
  const hasContent = sections.some((s: any) => s.content);
  const hasPresetValues = !!(tone || audience || cta || targetLength);

  const toggleChannel = (key: string) => {
    setSelectedChannels((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  };

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = (presets ?? []).find((p) => p.id === presetId);
    if (!preset) return;
    setTone(preset.tone ?? '');
    setAudience(preset.audience ?? '');
    setCta(preset.cta ?? '');
    setTargetLength(preset.targetLength ?? '');
  };

  const handleSavePreset = async () => {
    if (!brandId || !presetName.trim()) return;
    await createPreset.mutateAsync({
      id: brandId,
      data: {
        name: presetName.trim(),
        tone: tone || undefined,
        audience: audience || undefined,
        cta: cta || undefined,
        targetLength: targetLength || undefined,
      },
    });
    qc.invalidateQueries({ queryKey: getListRepurposingPresetsQueryKey(brandId) });
    setPresetName('');
    setSavingPreset(false);
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!brandId) return;
    await deletePreset.mutateAsync({ id: presetId });
    if (selectedPresetId === presetId) setSelectedPresetId('');
    qc.invalidateQueries({ queryKey: getListRepurposingPresetsQueryKey(brandId) });
  };

  const handleGenerate = async () => {
    await createBatch.mutateAsync({
      id: projectId,
      data: {
        channels: selectedChannels,
        documentSectionId: documentSectionId || undefined,
        campaignName: campaignName || undefined,
        tone: tone || undefined,
        audience: audience || undefined,
        cta: cta || undefined,
        targetLength: targetLength || undefined,
        additionalInstructions: additionalInstructions || undefined,
      },
    });
    qc.invalidateQueries({ queryKey: getListRepurposingBatchesQueryKey(projectId) });
    setSelectedChannels([]);
    setCampaignName('');
  };

  if (!hasContent) {
    return (
      <div className="bg-white border border-dashed border-stone-200 rounded-lg p-10 text-center text-stone-400">
        <Share2 className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium text-stone-500">Nothing to repurpose yet</p>
        <p className="text-xs mt-1">Draft at least one section in the Editor tab before generating derivative assets.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-stone-200 rounded-lg p-5 space-y-4">
        <h3 className="font-semibold text-stone-800">Generate Derivative Assets</h3>

        <div>
          <label className="text-xs font-medium text-stone-500 block mb-1.5">Source</label>
          <select value={documentSectionId} onChange={(e) => setDocumentSectionId(e.target.value)} className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm">
            <option value="">Whole document</option>
            {sections.filter((s: any) => s.content).map((s: any) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-stone-500 block mb-1.5">Channels</label>
          <div className="flex flex-wrap gap-2">
            {(channels ?? []).map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleChannel(c.key)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedChannels.includes(c.key) ? 'bg-[#C8102E] border-[#C8102E] text-white' : 'border-stone-200 text-stone-600 hover:border-stone-300'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {brandId && (
          <div>
            <label className="text-xs font-medium text-stone-500 block mb-1.5">Preset</label>
            <div className="flex items-center gap-2">
              <select
                value={selectedPresetId}
                onChange={(e) => applyPreset(e.target.value)}
                className="flex-1 border border-stone-200 rounded-md px-3 py-2 text-sm"
              >
                <option value="">No preset — enter values manually</option>
                {(presets ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedPresetId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 px-2 text-stone-400 hover:text-red-600"
                  title="Delete this preset"
                  onClick={() => handleDeletePreset(selectedPresetId)}
                  disabled={deletePreset.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Campaign name (optional)" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
          <Input placeholder="Tone override (optional)" value={tone} onChange={(e) => setTone(e.target.value)} />
          <Input placeholder="Audience override (optional)" value={audience} onChange={(e) => setAudience(e.target.value)} />
          <Input placeholder="Call to action (optional)" value={cta} onChange={(e) => setCta(e.target.value)} />
          <Input placeholder="Target length (optional)" value={targetLength} onChange={(e) => setTargetLength(e.target.value)} />
        </div>
        <Textarea placeholder="Additional instructions (optional)" value={additionalInstructions} onChange={(e) => setAdditionalInstructions(e.target.value)} rows={2} />

        {brandId && hasPresetValues && (
          <div className="border-t border-stone-100 pt-3">
            {!savingPreset ? (
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setSavingPreset(true)}>
                <Bookmark className="w-3 h-3" /> Save as preset
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  placeholder={'Preset name (e.g. "LinkedIn launch CTA")'}
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="h-8 text-xs flex-1"
                />
                <Button size="sm" className="h-8 text-xs bg-[#C8102E] hover:bg-[#a80d25] text-white" onClick={handleSavePreset} disabled={!presetName.trim() || createPreset.isPending}>
                  {createPreset.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setSavingPreset(false); setPresetName(''); }}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleGenerate}
            disabled={selectedChannels.length === 0 || createBatch.isPending}
            className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2"
          >
            {createBatch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate {selectedChannels.length > 0 ? `(${selectedChannels.length})` : ''}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading && <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />}
        {!isLoading && !batches?.length && (
          <div className="bg-white border border-dashed border-stone-200 rounded-lg p-10 text-center text-stone-400">
            <Share2 className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium text-stone-500">No repurposing batches yet</p>
            <p className="text-xs mt-1">Pick channels above and generate your first batch of derivative assets.</p>
          </div>
        )}
        {batches?.map((batch) => (
          <div key={batch.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
                {batch.campaignName || new Date(batch.createdAt as string).toLocaleString()}
              </p>
              <span className={`text-xs font-medium ${BATCH_STATUS_STYLES[batch.status] ?? 'text-stone-400'}`}>
                {batch.status === 'processing' && <Loader2 className="w-3 h-3 inline animate-spin mr-1" />}
                {batch.status}
              </span>
              {batch.errorMessage && <span className="text-xs text-red-500">{batch.errorMessage}</span>}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {((batch as any).assets ?? []).map((asset: any) => (
                // Keying on id+versionNumber forces a remount whenever the server produces a
                // new version (regenerate, retry, restore, or a saved edit increments it), so
                // the local draft always reflects the latest content instead of stale text
                // from a prior version. Between versions (e.g. background polling), an
                // in-progress unsaved edit is left untouched since the key doesn't change.
                <AssetCard key={`${asset.id}:${asset.versionNumber}`} asset={asset} channelLabel={channelMap[asset.channel] ?? asset.channel} projectId={projectId} batchId={batch.id} brandId={brandId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
