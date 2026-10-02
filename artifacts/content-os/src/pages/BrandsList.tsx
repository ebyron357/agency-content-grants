import { useState } from 'react';
import { useListBrands, useCreateBrand } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Plus, Building2, ArrowRight } from 'lucide-react';
import { PageHeader, PageShell, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { getListBrandsQueryKey } from '@workspace/api-client-react';

export default function BrandsList() {
  const { data: brands, isLoading, isError, refetch } = useListBrands();
  const createBrand = useCreateBrand();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', industry: '' });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await createBrand.mutateAsync({ data: { name: form.name, description: form.description, industry: form.industry } });
    qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
    setOpen(false);
    setForm({ name: '', description: '', industry: '' });
  }

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Brands"
        title="Brands"
        description={`${brands?.length ?? 0} brand${brands?.length === 1 ? '' : 's'}. Each brand carries the voice, audience and context every document inherits.`}
        actions={
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New brand
          </Button>
        }
      />

      {isError && (
        <StateMessage
          tone="error"
          title="Brands could not be loaded."
          description="Nothing has been lost. Check the connection and try again."
          action={<Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>}
        />
      )}

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2" role="status" aria-label="Loading brands">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 animate-pulse rounded-2xl border border-border bg-card" />)}
        </div>
      )}

      {!isLoading && !isError && !brands?.length && (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">No brands yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Add a brand to give your content a consistent voice, audience and point of view.</p>
          <Button onClick={() => setOpen(true)} className="mt-5 gap-2">
            <Plus className="h-4 w-4" /> Add your first brand
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {brands?.map(brand => (
          <Link key={brand.id} href={`/brands/${brand.id}`} className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-foreground/25">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-sm font-semibold text-brand" aria-hidden="true">
                {brand.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-foreground">{brand.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{brand.industry || 'Industry not set'}</p>
              </div>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {brand.projectCount ?? 0} project{brand.projectCount === 1 ? '' : 's'}
              </span>
            </div>
            <dl className="mt-4 grid gap-2 text-xs">
              <div>
                <dt className="font-medium text-muted-foreground">Voice</dt>
                <dd className="mt-0.5 line-clamp-1 text-foreground/85">{brand.voiceDescription || 'Not defined yet'}</dd>
              </div>
              {brand.description && (
                <div>
                  <dt className="font-medium text-muted-foreground">About</dt>
                  <dd className="mt-0.5 line-clamp-2 text-foreground/85">{brand.description}</dd>
                </div>
              )}
            </dl>
            <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
              Open brand <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">New brand</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div>
              <label htmlFor="nb-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">Brand Name *</label>
              <Input id="nb-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. FirstHome Financial" required />
            </div>
            <div>
              <label htmlFor="nb-industry" className="mb-1.5 block text-xs font-medium text-muted-foreground">Industry</label>
              <Input id="nb-industry" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. Personal Finance" />
            </div>
            <div>
              <label htmlFor="nb-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">Description</label>
              <Textarea id="nb-description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief overview of the brand and what it does" rows={3} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createBrand.isPending}>
                {createBrand.isPending ? 'Creating…' : 'Create brand'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
