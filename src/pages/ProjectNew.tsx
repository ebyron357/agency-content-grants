import { useState } from "react";
import { useCreateProject, useListBrands, getListBrandsQueryKey, useListBlueprints, getListBlueprintsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/modal";
import { useLocation, Link } from "wouter";
import { ArrowLeft, ArrowRight, Loader2, Wand2 } from "lucide-react";

export default function ProjectNew() {
  const [, setLocation] = useLocation();
  const createProject = useCreateProject();

  const { data: brands, isLoading: brandsLoading } = useListBrands({
    query: { queryKey: getListBrandsQueryKey() }
  });

  const { data: blueprints } = useListBlueprints({
    query: { queryKey: getListBlueprintsQueryKey() }
  });

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    title: "",
    brandId: "",
    contentType: "",
    topic: "",
    purpose: "",
    targetLength: "",
    blueprintId: "",
    additionalInstructions: ""
  });

  const handleNext = () => setStep(s => s + 1);
  const handlePrev = () => setStep(s => s - 1);

  const handleSubmit = () => {
    if (!formData.title || !formData.brandId || !formData.contentType) {
      alert("Please fill required fields (Title, Brand, Type)");
      return;
    }

    createProject.mutate({ data: formData }, {
      onSuccess: (res) => {
        setLocation(`/projects/${res.id}`);
      }
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-300 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/projects">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-serif tracking-tight">New Content Project</h1>
          <p className="text-muted-foreground text-sm mt-1">Step {step} of 3</p>
        </div>
      </div>

      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map(i => (
          <div key={i} className={`h-2 flex-1 rounded-full ${step >= i ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>

      <Card className="shadow-lg">
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Working Title <span className="text-destructive">*</span></label>
                <Input 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})} 
                  placeholder="e.g. Q3 Industry Analysis Report"
                  className="text-lg py-6"
                />
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Brand <span className="text-destructive">*</span></label>
                  {brandsLoading ? (
                    <div className="h-10 bg-muted animate-pulse rounded-md" />
                  ) : (
                    <Select 
                      value={formData.brandId}
                      onChange={v => setFormData({...formData, brandId: v})}
                      placeholder="Select a Brand"
                      options={(brands || []).map(b => ({ label: b.name, value: b.id }))}
                    />
                  )}
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Content Type <span className="text-destructive">*</span></label>
                  <Select 
                    value={formData.contentType}
                    onChange={v => setFormData({...formData, contentType: v})}
                    placeholder="Select Type"
                    options={[
                      {label: "Blog Post", value: "blog"},
                      {label: "Manual/Guide", value: "manual"},
                      {label: "Ebook", value: "ebook"},
                      {label: "SOP", value: "sop"},
                      {label: "Whitepaper", value: "whitepaper"},
                    ]}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t bg-muted/20 p-4">
              <Button onClick={handleNext} disabled={!formData.title || !formData.brandId || !formData.contentType}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </>
        )}

        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle>Content Brief</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Topic / Angle</label>
                <Textarea 
                  value={formData.topic} 
                  onChange={e => setFormData({...formData, topic: e.target.value})} 
                  placeholder="What is this piece about? What's the main argument?"
                  className="min-h-[100px]"
                />
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Target Length</label>
                  <Input 
                    value={formData.targetLength} 
                    onChange={e => setFormData({...formData, targetLength: e.target.value})} 
                    placeholder="e.g. 1500 words, 5 pages"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Primary Purpose</label>
                  <Input 
                    value={formData.purpose} 
                    onChange={e => setFormData({...formData, purpose: e.target.value})} 
                    placeholder="e.g. Lead generation, SEO, Thought leadership"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-between border-t bg-muted/20 p-4">
              <Button variant="outline" onClick={handlePrev}>Back</Button>
              <Button onClick={handleNext}>Next <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </CardFooter>
          </>
        )}

        {step === 3 && (
          <>
            <CardHeader>
              <CardTitle>AI Instructions & Blueprint</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Starting Blueprint</label>
                <Select 
                  value={formData.blueprintId}
                  onChange={v => setFormData({...formData, blueprintId: v})}
                  placeholder="Start from scratch (No Blueprint)"
                  options={(blueprints || []).map(b => ({ label: `${b.name} (${b.contentType})`, value: b.id }))}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Custom AI Instructions</label>
                <Textarea 
                  value={formData.additionalInstructions} 
                  onChange={e => setFormData({...formData, additionalInstructions: e.target.value})} 
                  placeholder="Any specific rules for the AI during the drafting process? E.g., 'Always use British English spelling', 'Avoid mentioning competitor X'."
                  className="min-h-[150px]"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-between border-t bg-muted/20 p-4">
              <Button variant="outline" onClick={handlePrev}>Back</Button>
              <Button onClick={handleSubmit} disabled={createProject.isPending} className="bg-primary text-primary-foreground">
                {createProject.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {createProject.isPending ? "Initializing Pipeline..." : "Create & Initialize Pipeline"}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
