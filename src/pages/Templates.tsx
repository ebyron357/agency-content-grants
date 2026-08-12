import { useListBlueprints, getListBlueprintsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, PlusCircle } from "lucide-react";

export default function Templates() {
  const { data: blueprints, isLoading } = useListBlueprints({
    query: { queryKey: getListBlueprintsQueryKey() }
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-serif tracking-tight mb-2">Content Blueprints</h1>
          <p className="text-muted-foreground">Pre-defined structures and rules for different types of content.</p>
        </div>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Blueprint
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map(i => <Card key={i} className="h-40 animate-pulse" />)}
        </div>
      ) : blueprints && blueprints.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {blueprints.map(bp => (
            <Card key={bp.id} className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardHeader>
                <div className="flex justify-between items-start mb-2">
                  <Badge className="bg-primary/10 text-primary border-primary/20 uppercase tracking-wider text-[10px]">
                    {bp.contentType}
                  </Badge>
                  {bp.isDefault && <Badge variant="secondary">Default</Badge>}
                </div>
                <CardTitle>{bp.name}</CardTitle>
                <CardDescription className="line-clamp-2">{bp.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-24 border border-dashed rounded-lg bg-card">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-serif mb-2">No blueprints found</h3>
          <p className="text-muted-foreground mb-6">Create structural templates for your AI to follow.</p>
        </div>
      )}
    </div>
  );
}
