import { useState } from 'react';
import { useListBrands, useCreateBrand } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { Plus, Building2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import { getListBrandsQueryKey } from '@workspace/api-client-react';

export default function BrandsList() {
  const { data: brands, isLoading } = useListBrands();
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
    <div className="max-w-5xl mx-auto px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#111] font-serif">Brand Portfolio</h1>
          <p className="text-stone-500 mt-1 text-sm">{brands?.length ?? 0} brands in your content system</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2">
          <Plus className="w-4 h-4" /> New Brand
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-stone-100 animate-pulse rounded-lg" />)}
        </div>
      )}

      {!isLoading && !brands?.length && (
        <div className="text-center py-16 text-stone-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-stone-600">No brands yet</p>
          <p className="text-sm mt-1">Create your first brand to get started</p>
        </div>
      )}

      <div className="space-y-3">
        {brands?.map(brand => (
          <Link key={brand.id} href={`/brands/${brand.id}`} className="flex items-center gap-4 bg-white border border-stone-200 hover:border-stone-300 rounded-lg p-5 transition-colors group">
              <div className="w-10 h-10 bg-stone-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-stone-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#111] font-serif text-lg leading-snug">{brand.name}</p>
                {brand.industry && <p className="text-xs text-stone-400 mt-0.5">{brand.industry}</p>}
                {brand.description && (
                  <p className="text-sm text-stone-500 mt-1 line-clamp-1">{brand.description}</p>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xs text-stone-400">{(brand as any).projectCount ?? 0} projects</span>
                <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-500 transition-colors" />
              </div>
          </Link>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">New Brand</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">Brand Name *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. FirstHome Financial" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">Industry</label>
              <Input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. Personal Finance" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">Description</label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief overview of the brand and what it does" rows={3} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createBrand.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
                {createBrand.isPending ? 'Creating…' : 'Create Brand'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
