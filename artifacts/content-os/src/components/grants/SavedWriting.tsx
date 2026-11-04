import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/grants/GrantUi';
import { errorMessage, grantsApi, useInvalidateGrants, useSnippets, type Snippet } from '@/lib/grants';

function SavedItem({ item }: { item: Snippet }) {
  const invalidate = useInvalidateGrants();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
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
  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); void act(() => grantsApi.renameSnippet(item.id, title)); }} className="flex gap-2">
              <label className="sr-only" htmlFor={`title-${item.id}`}>Title</label>
              <Input id={`title-${item.id}`} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
              <Button type="submit" size="sm" disabled={!title.trim()}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setTitle(item.title); }}>Cancel</Button>
            </form>
          ) : (
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
          )}
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.preview}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{item.words} words · saved by {item.savedBy}{item.sourceLabel ? ` · from ${item.sourceLabel}` : ''}</p>
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Rename ${item.title}`} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete ${item.title}`} onClick={() => { if (window.confirm(`Delete “${item.title}”? Applications that used it keep their text.`)) void act(() => grantsApi.deleteSnippet(item.id)); }}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
          </div>
        )}
      </div>
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </li>
  );
}

export function SavedWriting({ applicantId }: { applicantId: string }) {
  const items = useSnippets(applicantId);
  if (items.isLoading) return <LoadingState label="Loading saved writing…" className="min-h-[20vh]" />;
  if (items.isError || !items.data) return <StateMessage tone="error" title="Saved writing could not load" description={errorMessage(items.error)} action={<Button onClick={() => items.refetch()}>Try again</Button>} />;
  return (
    <div className="space-y-5">
      <Notice tone="info" title="Write it well once">
        Approved sections saved here can be inserted into later applications from the Write step, and drafting uses them as a starting point for the same section. Edit each one for the new funder before approving it again.
      </Notice>
      <Panel>
        <PanelHeader title="Saved writing" description={`${items.data.length} saved text${items.data.length === 1 ? '' : 's'}.`} />
        {items.data.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing saved yet. Approve a section in an application, then choose Save to library.</p>
        ) : (
          <ul className="divide-y divide-border">{items.data.map((w) => <SavedItem key={w.id} item={w} />)}</ul>
        )}
      </Panel>
    </div>
  );
}
