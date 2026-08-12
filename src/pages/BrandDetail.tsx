import { useGetBrand, useUpdateBrand, useDeleteBrand, useListAudienceProfiles, useListBrandFacts, getGetBrandQueryKey, getListAudienceProfilesQueryKey, getListBrandFactsQueryKey, useCreateAudienceProfile, useCreateBrandFact } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useParams, Link, useLocation } from "wouter";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function BrandDetail() {
  const params = useParams();
  const id = params.id as string;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: brand, isLoading } = useGetBrand(id, {
    query: { enabled: !!id, queryKey: getGetBrandQueryKey(id) }
  });

  const { data: profiles } = useListAudienceProfiles(id, {
    query: { enabled: !!id, queryKey: getListAudienceProfilesQueryKey(id) }
  });

  const { data: facts } = useListBrandFacts(id, {
    query: { enabled: !!id, queryKey: getListBrandFactsQueryKey(id) }
  });

  const updateBrand = useUpdateBrand();
  const deleteBrand = useDeleteBrand();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    voiceDescription: "",
    preferredVocabulary: "",
    prohibitedVocabulary: "",
    industry: "",
  });

  const initialized = useRef(false);

  useEffect(() => {
    if (brand && !initialized.current) {
      setFormData({
        name: brand.name || "",
        description: brand.description || "",
        voiceDescription: brand.voiceDescription || "",
        preferredVocabulary: brand.preferredVocabulary || "",
        prohibitedVocabulary: brand.prohibitedVocabulary || "",
        industry: brand.industry || "",
      });
      initialized.current = true;
    }
  }, [brand]);

  const handleSave = () => {
    updateBrand.mutate({ id, data: formData }, {
      onSuccess: () => {
        alert("Brand saved");
      }
    });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this brand?")) {
      deleteBrand.mutate({ id }, {
        onSuccess: () => {
          setLocation("/brands");
        }
      });
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center animate-pulse">Loading brand details...</div>;
  }

  if (!brand) return <div className="p-8 text-center">Brand not found</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/brands">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-serif tracking-tight">{brand.name}</h1>
          <p className="text-muted-foreground text-sm flex items-center gap-2">
            <span>Brand Profile</span>
            <Badge variant={brand.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
              {brand.status}
            </Badge>
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="destructive" onClick={handleDelete} disabled={deleteBrand.isPending}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
          <Button onClick={handleSave} disabled={updateBrand.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateBrand.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="identity" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="identity">Identity & Voice</TabsTrigger>
          <TabsTrigger value="audience">Audience Profiles</TabsTrigger>
          <TabsTrigger value="facts">Brand Facts</TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Core Identity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Brand Name</label>
                  <Input 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Industry</label>
                  <Input 
                    value={formData.industry} 
                    onChange={e => setFormData({...formData, industry: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Mission / Description</label>
                  <Textarea 
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})} 
                    className="min-h-[120px]"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Voice & Tone</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Voice Description</label>
                  <Textarea 
                    value={formData.voiceDescription} 
                    onChange={e => setFormData({...formData, voiceDescription: e.target.value})}
                    placeholder="e.g. Authoritative but accessible, professional but not stuffy..."
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Preferred Vocabulary</label>
                  <Textarea 
                    value={formData.preferredVocabulary} 
                    onChange={e => setFormData({...formData, preferredVocabulary: e.target.value})}
                    placeholder="Comma separated words/phrases to use"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Prohibited Vocabulary</label>
                  <Textarea 
                    value={formData.prohibitedVocabulary} 
                    onChange={e => setFormData({...formData, prohibitedVocabulary: e.target.value})}
                    placeholder="Comma separated words/phrases to avoid"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="audience">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Audience Profiles</CardTitle>
                <CardDescription>Target demographics and their needs.</CardDescription>
              </div>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" /> Add Profile
              </Button>
            </CardHeader>
            <CardContent>
              {profiles && profiles.length > 0 ? (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {profiles.map(profile => (
                    <Card key={profile.id} className="bg-muted/20 border-dashed">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{profile.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm space-y-2">
                        {profile.demographics && <p><span className="font-medium">Demographics:</span> {profile.demographics}</p>}
                        {profile.painPoints && <p><span className="font-medium">Pain Points:</span> {profile.painPoints}</p>}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded-md">
                  No audience profiles defined.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="facts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Approved Brand Facts</CardTitle>
                <CardDescription>Claims that AI can safely use across content.</CardDescription>
              </div>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" /> Add Fact
              </Button>
            </CardHeader>
            <CardContent>
              {facts && facts.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {facts.map(fact => (
                      <TableRow key={fact.id}>
                        <TableCell className="font-medium">{fact.claim}</TableCell>
                        <TableCell className="text-muted-foreground">{fact.source || "N/A"}</TableCell>
                        <TableCell><Badge variant="outline">{fact.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-muted-foreground border border-dashed rounded-md">
                  No brand facts documented.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
