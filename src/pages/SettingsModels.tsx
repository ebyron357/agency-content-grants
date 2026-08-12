import { useGetModelConfig, useUpdateModelConfig, getGetModelConfigQueryKey, useListProviders, getListProvidersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select } from "@/components/ui/modal";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";

const ROLES = [
  { key: "planningModel", label: "Planning", desc: "Used for research plan generation and strategy" },
  { key: "researchModel", label: "Research", desc: "Used for information retrieval and source extraction" },
  { key: "outlineModel", label: "Outline", desc: "Used for structuring and outlining documents" },
  { key: "writingModel", label: "Writing", desc: "Used for drafting full document sections" },
  { key: "editingModel", label: "Editing", desc: "Used for tone adjustment and proofreading" },
  { key: "verificationModel", label: "Verification", desc: "Used for claim extraction and fact-checking" },
  { key: "evaluationModel", label: "Evaluation", desc: "Used for quality scoring and critique" },
  { key: "utilityModel", label: "Utility", desc: "Used for small tasks like title generation" },
];

export default function SettingsModels() {
  const { data: config, isLoading: configLoading } = useGetModelConfig({
    query: { queryKey: getGetModelConfigQueryKey() }
  });

  const { data: providers } = useListProviders({
    query: { queryKey: getListProvidersQueryKey() }
  });

  const updateConfig = useUpdateModelConfig();
  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (config) {
      const init: Record<string, string> = {};
      ROLES.forEach(r => {
        init[r.key] = (config as any)[r.key] || "";
      });
      setFormData(init);
    }
  }, [config]);

  // Flatten all available models from configured providers
  const availableModels = providers
    ?.filter(p => p.isConfigured)
    .flatMap(p => (p.availableModels || []).map(m => ({ label: `${m} (${p.displayName})`, value: m }))) || [];

  const handleSave = () => {
    updateConfig.mutate({ data: formData }, {
      onSuccess: () => alert("Model assignments saved")
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-serif tracking-tight mb-2">Model Roles</h1>
          <p className="text-muted-foreground">Assign specific AI models to different stages of the content pipeline.</p>
        </div>
        <Button onClick={handleSave} disabled={updateConfig.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {updateConfig.isPending ? "Saving..." : "Save Assignments"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {configLoading ? (
            <div className="p-12 text-center animate-pulse">Loading configurations...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Pipeline Role</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[300px]">Assigned Model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLES.map(role => (
                  <TableRow key={role.key}>
                    <TableCell className="font-medium">{role.label}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{role.desc}</TableCell>
                    <TableCell>
                      <Select 
                        value={formData[role.key] || ""}
                        onChange={(v) => setFormData(prev => ({ ...prev, [role.key]: v }))}
                        options={availableModels}
                        placeholder="Select a model..."
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
