import { useGetDocument, useInitDocument, useDraftDocumentSection, getGetDocumentQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, PenTool, CheckCircle, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function EditorTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: document, isLoading } = useGetDocument(projectId, {
    query: { queryKey: getGetDocumentQueryKey(projectId) }
  });

  const initDoc = useInitDocument();
  const draftSection = useDraftDocumentSection();

  const handleInit = () => {
    initDoc.mutate({ id: projectId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(projectId) })
    });
  };

  const handleDraft = (sectionId: string) => {
    draftSection.mutate({ id: sectionId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDocumentQueryKey(projectId) })
    });
  };

  if (isLoading) return <div className="p-12 text-center animate-pulse">Loading editor...</div>;

  if (!document) {
    return (
      <Card className="text-center p-12 border-dashed">
        <CardContent className="space-y-4">
          <PenTool className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
          <h3 className="text-xl font-serif">Ready to Draft</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Initialize the document from the approved outline to begin section-by-section drafting.
          </p>
          <Button onClick={handleInit} disabled={initDoc.isPending}>
            {initDoc.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Initialize Document
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <Badge variant={document.status === 'published' ? 'success' : 'secondary'} className="uppercase">
            {document.status}
          </Badge>
          <span className="text-sm font-medium text-muted-foreground">
            {document.wordCount || 0} Words Total
          </span>
        </div>
        <Button>Export Document</Button>
      </div>

      <div className="space-y-6">
        {document.sections?.sort((a, b) => a.sortOrder - b.sortOrder).map((sec) => (
          <Card key={sec.id} className={sec.isLocked ? "border-primary/20 bg-muted/10" : ""}>
            <CardHeader className="py-4 border-b bg-muted/10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {sec.isLocked ? <Lock className="h-4 w-4 text-primary" /> : <PenTool className="h-4 w-4 text-muted-foreground" />}
                  <CardTitle className="text-lg">{sec.title}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{sec.status}</Badge>
                  {sec.wordCount && <span className="text-xs text-muted-foreground">{sec.wordCount} words</span>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {sec.content ? (
                <div className="p-6 prose dark:prose-invert max-w-none font-serif leading-relaxed text-foreground">
                  <div dangerouslySetInnerHTML={{ __html: sec.content }} />
                </div>
              ) : (
                <div className="p-12 text-center">
                  <Button variant="outline" onClick={() => handleDraft(sec.id)} disabled={draftSection.isPending}>
                    {draftSection.isPending && draftSection.variables?.id === sec.id ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Drafting Section...</>
                    ) : (
                      "AI Draft Section"
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
            {sec.content && !sec.isLocked && (
              <div className="p-3 bg-muted/20 border-t flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => handleDraft(sec.id)} disabled={draftSection.isPending}>
                  Rewrite
                </Button>
                <Button size="sm" variant="secondary">
                  Edit Manually
                </Button>
                <Button size="sm" className="bg-primary">
                  <CheckCircle className="mr-2 h-4 w-4" /> Approve & Lock
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
