import { useListDependencies, getListDependenciesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function SettingsDependencies() {
  const { data: dependencies, isLoading } = useListDependencies({}, {
    query: { queryKey: getListDependenciesQueryKey() }
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-serif tracking-tight mb-2">Dependency Registry</h1>
        <p className="text-muted-foreground">Track installed tools, libraries, and their security status.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center animate-pulse">Loading dependencies...</div>
          ) : dependencies && dependencies.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Security</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dependencies.map((dep) => (
                  <TableRow key={dep.id}>
                    <TableCell>
                      <div className="font-medium">{dep.componentName}</div>
                      <div className="text-xs text-muted-foreground">{dep.repositorySlug}</div>
                    </TableCell>
                    <TableCell className="uppercase text-[10px] tracking-wider font-semibold">
                      {dep.category}
                    </TableCell>
                    <TableCell>
                      <Badge variant={dep.installStatus === 'installed' ? 'default' : 'outline'}>
                        {dep.installStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {dep.installedVersion || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        dep.securityReviewStatus === 'approved' ? 'success' : 
                        dep.securityReviewStatus === 'flagged' ? 'destructive' : 'secondary'
                      }>
                        {dep.securityReviewStatus || "pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">No dependencies registered.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
