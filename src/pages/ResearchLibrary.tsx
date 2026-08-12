import { useListSources, getListSourcesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { format } from "date-fns";

export default function ResearchLibrary() {
  const { data: sources, isLoading } = useListSources({}, {
    query: { queryKey: getListSourcesQueryKey() }
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-serif tracking-tight mb-2">Research Library</h1>
        <p className="text-muted-foreground">Global repository of all extracted sources across projects.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center animate-pulse">Loading sources...</div>
          ) : sources && sources.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Authority</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map(source => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="font-medium">{source.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                        {source.publisher || "Unknown Publisher"}
                        {source.url && (
                          <a href={source.url} target="_blank" rel="noreferrer" className="hover:text-primary flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" /> Link
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {source.sourceType}
                    </TableCell>
                    <TableCell>
                      <Badge variant={source.status === 'approved' ? 'success' : source.status === 'rejected' ? 'destructive' : 'secondary'}>
                        {source.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {source.authorityScore ? (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${source.authorityScore}%` }} />
                          </div>
                          <span className="text-xs font-mono">{source.authorityScore}</span>
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {format(new Date(source.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg m-6">
              No sources in the library yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
