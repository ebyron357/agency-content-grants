import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPublishingDestinations,
  useCreateScheduledPublication,
  getListPublishingDestinationsQueryKey,
  getListScheduledPublicationsQueryKey,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Send, CalendarClock } from 'lucide-react';

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  sourceType: 'document' | 'repurposed_asset';
  documentId?: string;
  repurposedAssetId?: string;
  itemLabel?: string;
}

/** Reusable schedule/publish flow, opened from an approved document (Quality tab) or an approved repurposed asset. */
export function PublishDialog({ open, onOpenChange, brandId, sourceType, documentId, repurposedAssetId, itemLabel }: PublishDialogProps) {
  const qc = useQueryClient();
  const { data: destinations, isLoading } = useListPublishingDestinations(brandId, { query: { queryKey: getListPublishingDestinationsQueryKey(brandId), enabled: open && !!brandId } });
  const createPublication = useCreateScheduledPublication();
  const [destinationId, setDestinationId] = useState('');
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [scheduledFor, setScheduledFor] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeDestinations = (destinations ?? []).filter((d) => d.isActive);

  const reset = () => { setDestinationId(''); setMode('now'); setScheduledFor(''); setError(null); };

  const handleSubmit = async () => {
    setError(null);
    if (!destinationId) { setError('Choose a destination'); return; }
    if (mode === 'schedule' && !scheduledFor) { setError('Pick a date and time'); return; }
    try {
      await createPublication.mutateAsync({
        data: {
          destinationId,
          sourceType,
          documentId,
          repurposedAssetId,
          scheduledFor: mode === 'schedule' ? new Date(scheduledFor).toISOString() : undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getListScheduledPublicationsQueryKey(brandId) });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message?.replace(/^POST .*?failed: \d+\s*/, '') ?? 'Failed to schedule publication');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish{itemLabel ? ` — ${itemLabel}` : ''}</DialogTitle>
          <DialogDescription>Send this content to a connected destination, now or on a schedule.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-stone-500">Destination</Label>
            {isLoading ? (
              <div className="h-9 bg-stone-100 rounded animate-pulse" />
            ) : activeDestinations.length === 0 ? (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded px-3 py-2">
                No active destinations yet. Add one from Distribution → Destinations first.
              </p>
            ) : (
              <Select value={destinationId} onValueChange={setDestinationId}>
                <SelectTrigger><SelectValue placeholder="Choose a destination" /></SelectTrigger>
                <SelectContent>
                  {activeDestinations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.label} ({d.platform})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-stone-500">When</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'now' ? 'default' : 'outline'} className={mode === 'now' ? 'bg-[#C8102E] hover:bg-[#a80d25] text-white' : ''} onClick={() => setMode('now')}>
                <Send className="w-3.5 h-3.5 mr-1.5" /> Publish now
              </Button>
              <Button type="button" size="sm" variant={mode === 'schedule' ? 'default' : 'outline'} className={mode === 'schedule' ? 'bg-[#C8102E] hover:bg-[#a80d25] text-white' : ''} onClick={() => setMode('schedule')}>
                <CalendarClock className="w-3.5 h-3.5 mr-1.5" /> Schedule
              </Button>
            </div>
            {mode === 'schedule' && (
              <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className="mt-2" />
            )}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={createPublication.isPending || activeDestinations.length === 0}
            className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-1.5"
          >
            {createPublication.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {mode === 'now' ? 'Publish' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
