import { Project } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function OverviewTab({ project }: { project: Project }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Content Brief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Target Audience</span>
                <p className="text-sm">{project.intendedAudience || "Not specified"}</p>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Knowledge Level</span>
                <p className="text-sm">{project.audienceKnowledgeLevel || "Not specified"}</p>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Desired Outcome</span>
                <p className="text-sm">{project.desiredReaderOutcome || "Not specified"}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Tone & Voice</span>
                <p className="text-sm">{project.tone || "Default brand voice"}</p>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Target Length</span>
                <p className="text-sm">{project.targetLength || "Standard"}</p>
              </div>
              <div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Point of View</span>
                <p className="text-sm capitalize">{project.pointOfView || "Not specified"}</p>
              </div>
            </div>
          </div>
          
          {project.additionalInstructions && (
            <div className="pt-4 border-t mt-6">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">Additional AI Instructions</span>
              <div className="bg-muted/30 p-4 rounded-md text-sm font-mono whitespace-pre-wrap">
                {project.additionalInstructions}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
