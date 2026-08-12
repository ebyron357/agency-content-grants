import { useGetOutline, useGenerateOutline, getGetOutlineQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlignLeft, GripVertical } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function OutlineTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: outline, isLoading } = useGetOutline(projectId, {
    query: { queryKey: getGetOutlineQueryKey(projectId) }
  });

  const generateOutline = useGenerateOutline();

  const handleGenerate = () => {
    generateOutline.mutate({ id: projectId, data: {} }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOutlineQueryKey(projectId) })
    });
  };

  if (isLoading) return <div className="p-12 text-center animate-pulse">Loading outline...</div>;

  if (!outline) {
    return (
      <Card className="text-center p-12 border-dashed">
        <CardContent className="space-y-4">
          <AlignLeft className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
          <h3 className="text-xl font-serif">No Outline Generated</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            The AI will use the approved research and verified claims to construct a logical outline.
          </p>
          <Button onClick={handleGenerate} disabled={generateOutline.isPending}>
            {generateOutline.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Generate Outline
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <Badge variant={outline.status === 'approved' ? 'success' : 'secondary'} className="uppercase">
            {outline.status}
          </Badge>
          <span className="text-sm font-medium text-muted-foreground">
            {outline.sections?.length || 0} Sections
          </span>
        </div>
        <Button variant="outline" onClick={handleGenerate} disabled={generateOutline.isPending}>
          Regenerate Outline
        </Button>
      </div>

      <div className="space-y-3">
        {outline.sections?.sort((a, b) => a.sortOrder - b.sortOrder).map((section, idx) => (
          <Card key={section.id} className="hover:border-primary/50 transition-colors">
            <CardHeader className="py-4 px-6 flex flex-row items-start gap-4">
              <div className="cursor-grab pt-1 text-muted">
                <GripVertical className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono font-bold text-muted-foreground">SEC {idx + 1}</span>
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                </div>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground mt-2">
                  {section.purpose && (
                    <div><span className="font-semibold text-foreground uppercase text-[10px] tracking-wider block mb-1">Purpose</span> {section.purpose}</div>
                  )}
                  {section.readerOutcome && (
                    <div><span className="font-semibold text-foreground uppercase text-[10px] tracking-wider block mb-1">Reader Outcome</span> {section.readerOutcome}</div>
                  )}
                  {section.targetWordCount && (
                    <div><span className="font-semibold text-foreground uppercase text-[10px] tracking-wider block mb-1">Target Length</span> ~{section.targetWordCount} words</div>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
