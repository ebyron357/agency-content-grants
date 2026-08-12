import { useListSources, useFetchSourceContent, useApproveSource, useRejectSource, getListSourcesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink, Check, X, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function SourcesTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data: sources, isLoading } = useListSources({ projectId }, {
    query: { queryKey: getListSourcesQueryKey({ projectId }) }
  });

  const fetchSource = useFetchSourceContent();
  const approveSource = useApproveSource();
  const rejectSource = useRejectSource();

  const handleAction = (mutation: any, id: string, extra?: any) => {
    mutation.mutate({ id, ...extra }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey({ projectId }) })
    });
  };

  if (isLoading) return <div className="p-12 text-center animate-pulse">Loading sources...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Manage and verify reference materials for this project.</p>
        <Button variant="outline">Add Source Manually</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {sources && sources.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Source Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map(source => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="font-medium text-sm mb-1">{source.title}</div>
                      {source.url && (
                        <a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" /> {new URL(source.url).hostname}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="capitalize text-xs text-muted-foreground">{source.sourceType}</TableCell>
                    <TableCell>
                      <Badge variant={source.status === 'approved' ? 'success' : source.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {source.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-mono">{source.authorityScore || "-"} / 100</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {source.status === 'pending' && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => handleAction(approveSource, source.id)} disabled={approveSource.isPending}>
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        {source.status === 'pending' && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => handleAction(rejectSource, source.id, { data: { reason: "Not relevant" }})} disabled={rejectSource.isPending}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                        {!source.extractedText && source.status === 'approved' && source.url && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600 hover:bg-blue-50" title="Extract Text"
                            onClick={() => handleAction(fetchSource, source.id)} disabled={fetchSource.isPending}>
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              No sources have been identified for this project yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
