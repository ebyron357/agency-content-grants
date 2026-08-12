import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListBrands,
  useListPublishingDestinations,
  useCreatePublishingDestination,
  useUpdatePublishingDestination,
  useDeletePublishingDestination,
  useListScheduledPublications,
  useCancelScheduledPublication,
  useRescheduleScheduledPublication,
  useListPublicationAttempts,
  useListPublishProviders,
  getListPublishingDestinationsQueryKey,
  getListScheduledPublicationsQueryKey,
  getListPublishProvidersQueryKey,
} from '@workspace/api-client-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, addMonths, subMonths, isToday,
} from 'date-fns';
import {
  Plus, Trash2, ChevronLeft, ChevronRight, Send, CalendarClock, Loader2,
  CheckCircle2, XCircle, Clock, History, X, Radio,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const PLATFORMS = ['x', 'linkedin', 'threads', 'bluesky', 'mastodon', 'demo'];

// "publishing"/"confirming"/"cancelling" are short-lived states while a
// provider call is actually in flight (see ScheduledPublication.status in the
// API spec) — displayed the same as their parent state (pending/queued).
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-stone-100 text-stone-500',
  publishing: 'bg-stone-100 text-stone-500',
  queued: 'bg-blue-50 text-blue-600',
  confirming: 'bg-blue-50 text-blue-600',
  cancelling: 'bg-blue-50 text-blue-600',
  published: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-600',
  cancelled: 'bg-stone-100 text-stone-400',
};

const STATUS_ICONS: Record<string, any> = {
  pending: Clock,
  publishing: Loader2,
  queued: Loader2,
  confirming: Loader2,
  cancelling: Loader2,
  published: CheckCircle2,
  failed: XCircle,
  cancelled: X,
};

// ─── Destinations ───────────────────────────────────────────────────────────────

function AddDestinationDialog({ open, onOpenChange, brandId }: { open: boolean; onOpenChange: (o: boolean) => void; brandId: string }) {
  const qc = useQueryClient();
  const { data: providers } = useListPublishProviders({ query: { queryKey: getListPublishProvidersQueryKey(), enabled: open } });
  const create = useCreatePublishingDestination();
  const [provider, setProvider] = useState('demo');
  const [platform, setPlatform] = useState('demo');
  const [label, setLabel] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setProvider('demo'); setPlatform('demo'); setLabel(''); setExternalAccountId(''); setError(null); };

  const handleSubmit = async () => {
    if (!label.trim()) { setError('Give this destination a name'); return; }
    setError(null);
    try {
      await create.mutateAsync({ id: brandId, data: { provider, platform, label: label.trim(), externalAccountId: externalAccountId || undefined } });
      qc.invalidateQueries({ queryKey: getListPublishingDestinationsQueryKey(brandId) });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to add destination');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Connect a destination</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-stone-500">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(providers ?? [{ name: 'demo', isConfigured: true }, { name: 'typefully', isConfigured: false }]).map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} {!p.isConfigured && '(not configured)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {provider === 'typefully' && (
              <p className="text-[11px] text-stone-400">Requires TYPEFULLY_API_KEY to be set on the server before publishing will succeed.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-stone-500">Platform</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-stone-500">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Company LinkedIn" />
          </div>
          {provider === 'typefully' && (
            <div className="space-y-1.5">
              <Label className="text-xs text-stone-500">Typefully social-set ID</Label>
              <Input value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} placeholder="From Typefully → Settings → API" />
            </div>
          )}
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={create.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DestinationsPanel({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const { data: destinations, isLoading } = useListPublishingDestinations(brandId, { query: { queryKey: getListPublishingDestinationsQueryKey(brandId), enabled: !!brandId } });
  const update = useUpdatePublishingDestination();
  const del = useDeletePublishingDestination();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});

  const refresh = () => qc.invalidateQueries({ queryKey: getListPublishingDestinationsQueryKey(brandId) });

  // Deleting is refused (409) once any publication — pending, queued, or long
  // since published/failed/cancelled — still references this destination, so
  // that history can never be silently erased. The server is the source of
  // truth for this; deactivating (isActive: false) is always safe instead.
  const handleDelete = async (id: string) => {
    setDeleteError((prev) => { const next = { ...prev }; delete next[id]; return next; });
    try {
      await del.mutateAsync({ id });
      refresh();
    } catch (err: any) {
      setDeleteError((prev) => ({ ...prev, [id]: err?.data?.error ?? err?.message ?? 'Could not delete this destination.' }));
    }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">Destinations</h3>
        <Button size="sm" onClick={() => setAddOpen(true)} className="h-7 text-xs bg-[#C8102E] hover:bg-[#a80d25] text-white gap-1">
          <Plus className="w-3.5 h-3.5" /> Connect
        </Button>
      </div>
      <div className="p-4 space-y-2">
        {isLoading && <div className="h-16 bg-stone-100 animate-pulse rounded" />}
        {!isLoading && !destinations?.length && (
          <p className="text-xs text-stone-400 py-4 text-center">No destinations connected yet.</p>
        )}
        {destinations?.map((d) => (
          <div key={d.id} className="border border-stone-100 rounded-md px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-800 truncate">{d.label}</span>
                  <Badge className="bg-stone-100 text-stone-500 text-[10px]">{d.platform}</Badge>
                  <Badge className="bg-stone-50 text-stone-400 text-[10px]">{d.provider}</Badge>
                </div>
                {!d.isActive && <span className="text-[11px] text-amber-600">inactive</span>}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Button
                  size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                  onClick={async () => { await update.mutateAsync({ id: d.id, data: { isActive: !d.isActive } }); refresh(); }}
                >
                  {d.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-stone-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  }
                  title="Remove destination?"
                  description="Only allowed if nothing has ever been scheduled or published here. If it has history, this will be refused — use Deactivate instead to keep that history intact and stop new publishes."
                  onConfirm={() => handleDelete(d.id)}
                  disabled={del.isPending}
                />
              </div>
            </div>
            {deleteError[d.id] && <p className="text-[11px] text-red-500 mt-1">{deleteError[d.id]}</p>}
          </div>
        ))}
      </div>
      <AddDestinationDialog open={addOpen} onOpenChange={setAddOpen} brandId={brandId} />
    </div>
  );
}

// ─── Publication detail (attempt history) ───────────────────────────────────────

function AttemptHistory({ publicationId }: { publicationId: string }) {
  const { data: attempts, isLoading } = useListPublicationAttempts(publicationId);
  if (isLoading) return <p className="text-xs text-stone-400 py-2">Loading attempts…</p>;
  const sorted = [...(attempts ?? [])].sort((a, b) => a.attemptNumber - b.attemptNumber);
  if (!sorted.length) return <p className="text-xs text-stone-400 py-2">No attempts recorded yet.</p>;
  return (
    <div className="space-y-1.5 py-2">
      {sorted.map((a) => (
        <div key={a.id} className="flex items-start gap-2 text-xs">
          <span className="text-stone-400 w-14 flex-shrink-0">#{a.attemptNumber}</span>
          <Badge className={a.outcome === 'failure' ? 'bg-red-50 text-red-600' : a.outcome === 'confirmed' ? 'bg-green-50 text-green-700' : 'bg-stone-100 text-stone-500'}>
            {a.outcome}
          </Badge>
          <span className="text-stone-500">{format(new Date(a.createdAt), 'MMM d, HH:mm:ss')}</span>
          {a.errorMessage && <span className="text-red-500">{a.errorMessage}</span>}
        </div>
      ))}
    </div>
  );
}

function PublicationRow({ publication, destinationsById, brandId }: { publication: any; destinationsById: Record<string, any>; brandId: string }) {
  const qc = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const cancel = useCancelScheduledPublication();
  const reschedule = useRescheduleScheduledPublication();
  const dest = destinationsById[publication.destinationId];
  const Icon = STATUS_ICONS[publication.status] ?? Radio;

  const refresh = () => qc.invalidateQueries({ queryKey: getListScheduledPublicationsQueryKey(brandId) });

  // Cancelling already-submitted ("queued") content asks the provider to pull
  // it back, not just our own database — the outcome isn't always a clean
  // 200: the provider may confirm cancellation too late (409, already
  // published) or be unable to confirm right now (202, best-effort, will
  // retry). Both still need `refresh()` since the row's true status may have
  // changed even though the request itself "failed".
  const handleCancel = async () => {
    setCancelNote(null);
    try {
      await cancel.mutateAsync({ id: publication.id });
    } catch (err: any) {
      setCancelNote(err?.data?.message ?? err?.message ?? 'Could not cancel this publication.');
    } finally {
      refresh();
    }
  };

  return (
    <div className="border border-stone-100 rounded-md px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${publication.status === 'queued' ? 'animate-spin' : ''} ${publication.status === 'published' ? 'text-green-600' : publication.status === 'failed' ? 'text-red-500' : 'text-stone-400'}`} />
            <span className="text-sm font-medium text-stone-800 truncate">{publication.title ?? 'Untitled'}</span>
            <Badge className={STATUS_STYLES[publication.status] ?? 'bg-stone-100'}>{publication.status}</Badge>
          </div>
          <p className="text-[11px] text-stone-400 mt-0.5">
            {dest ? `${dest.label} (${dest.platform})` : publication.destinationId} · {format(new Date(publication.scheduledFor), 'MMM d, yyyy HH:mm')}
            {publication.attemptCount > 0 && ` · ${publication.attemptCount} attempt${publication.attemptCount === 1 ? '' : 's'}`}
          </p>
          {publication.lastError && <p className="text-[11px] text-red-500 mt-0.5">{publication.lastError}</p>}
          {cancelNote && <p className="text-[11px] text-amber-600 mt-0.5">{cancelNote}</p>}
          {publication.externalUrl && (
            <a href={publication.externalUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">View published post</a>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setShowHistory((s) => !s)}>
            <History className="w-3 h-3" />
          </Button>
          {publication.status === 'pending' && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setRescheduling((s) => !s)}>
              <CalendarClock className="w-3 h-3" />
            </Button>
          )}
          {(publication.status === 'pending' || publication.status === 'queued') && (
            <Button
              size="sm" variant="outline" className="h-7 px-2 text-[11px] text-stone-500"
              disabled={cancel.isPending}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
      {rescheduling && (
        <div className="flex items-center gap-2 mt-2">
          <Input type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 text-xs w-56" />
          <Button
            size="sm" className="h-8 text-xs bg-[#C8102E] hover:bg-[#a80d25] text-white"
            disabled={!newTime || reschedule.isPending}
            onClick={async () => { await reschedule.mutateAsync({ id: publication.id, data: { scheduledFor: new Date(newTime).toISOString() } }); setRescheduling(false); refresh(); }}
          >
            Save
          </Button>
        </div>
      )}
      {showHistory && <AttemptHistory publicationId={publication.id} />}
    </div>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────────

function CalendarView({ publications, destinationsById }: { publications: any[]; destinationsById: Record<string, any> }) {
  const [month, setMonth] = useState(new Date());
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of publications) {
      const key = format(new Date(p.scheduledFor), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [publications]);

  return (
    <div className="bg-white border border-stone-200 rounded-lg">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-800">{format(month, 'MMMM yyyy')}</h3>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setMonth((m) => subMonths(m, 1))}><ChevronLeft className="w-3.5 h-3.5" /></Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setMonth(new Date())}>Today</Button>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-stone-100 text-[10px] uppercase tracking-wide text-stone-400 font-medium">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const items = byDay.get(key) ?? [];
          return (
            <div key={key} className={`min-h-[86px] border-b border-r border-stone-100 p-1.5 ${!isSameMonth(day, month) ? 'bg-stone-50/50' : ''}`}>
              <span className={`text-[11px] inline-flex items-center justify-center w-5 h-5 rounded-full ${isToday(day) ? 'bg-[#C8102E] text-white font-semibold' : isSameMonth(day, month) ? 'text-stone-600' : 'text-stone-300'}`}>
                {format(day, 'd')}
              </span>
              <div className="mt-1 space-y-1">
                {items.slice(0, 3).map((p) => {
                  const dest = destinationsById[p.destinationId];
                  return (
                    <div
                      key={p.id}
                      title={`${p.title ?? 'Untitled'} — ${p.status}`}
                      className={`text-[9.5px] leading-tight px-1 py-0.5 rounded truncate ${STATUS_STYLES[p.status] ?? 'bg-stone-100 text-stone-500'}`}
                    >
                      {dest?.platform ?? '?'} · {p.title ?? 'Untitled'}
                    </div>
                  );
                })}
                {items.length > 3 && <p className="text-[9px] text-stone-400 pl-1">+{items.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function Distribution() {
  const { data: brands, isLoading: brandsLoading } = useListBrands();
  const [brandId, setBrandId] = useState<string>('');
  const activeBrandId = brandId || brands?.[0]?.id || '';

  const { data: destinations } = useListPublishingDestinations(activeBrandId, { query: { queryKey: getListPublishingDestinationsQueryKey(activeBrandId), enabled: !!activeBrandId } });
  const { data: publications, isLoading: pubsLoading } = useListScheduledPublications(activeBrandId, { query: { queryKey: getListScheduledPublicationsQueryKey(activeBrandId), enabled: !!activeBrandId } });

  const destinationsById = useMemo(() => Object.fromEntries((destinations ?? []).map((d) => [d.id, d])), [destinations]);
  const active = (publications ?? []).filter((p) => p.status !== 'cancelled');
  const upcoming = active.filter((p) => p.status === 'pending' || p.status === 'queued').sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  const history = active.filter((p) => p.status === 'published' || p.status === 'failed').sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime());

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#111] font-serif">Distribution</h1>
          <p className="text-stone-500 mt-1 text-sm">Connect destinations and schedule approved content across channels</p>
        </div>
        {!brandsLoading && (brands?.length ?? 0) > 1 && (
          <Select value={activeBrandId} onValueChange={setBrandId}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Choose a brand" /></SelectTrigger>
            <SelectContent>
              {brands!.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {!brandsLoading && !brands?.length && (
        <div className="text-center py-16 text-stone-400 bg-white border border-dashed border-stone-200 rounded-lg">
          <p className="font-medium text-stone-600">No brands yet</p>
          <p className="text-sm mt-1">Create a brand first, then connect a destination to publish to.</p>
        </div>
      )}

      {activeBrandId && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            <CalendarView publications={active} destinationsById={destinationsById} />

            <div className="bg-white border border-stone-200 rounded-lg">
              <div className="px-5 py-4 border-b border-stone-100">
                <h3 className="text-sm font-semibold text-stone-800">Upcoming</h3>
              </div>
              <div className="p-4 space-y-2">
                {pubsLoading && <div className="h-16 bg-stone-100 animate-pulse rounded" />}
                {!pubsLoading && !upcoming.length && <p className="text-xs text-stone-400 py-4 text-center">Nothing scheduled. Publish an approved document or asset to see it here.</p>}
                {upcoming.map((p) => <PublicationRow key={p.id} publication={p} destinationsById={destinationsById} brandId={activeBrandId} />)}
              </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-lg">
              <div className="px-5 py-4 border-b border-stone-100">
                <h3 className="text-sm font-semibold text-stone-800">History</h3>
              </div>
              <div className="p-4 space-y-2">
                {!pubsLoading && !history.length && <p className="text-xs text-stone-400 py-4 text-center">No published or failed items yet.</p>}
                {history.map((p) => <PublicationRow key={p.id} publication={p} destinationsById={destinationsById} brandId={activeBrandId} />)}
              </div>
            </div>
          </div>

          <div>
            <DestinationsPanel brandId={activeBrandId} />
          </div>
        </div>
      )}
    </div>
  );
}
