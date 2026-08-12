import { useGetResearchPlan, useGenerateResearchPlan, useApproveResearchPlan, getGetResearchPlanQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, CheckCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ResearchTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  
  const { data: plan, isLoading } = useGetResearchPlan(projectId, {
    query: { queryKey: getGetResearchPlanQueryKey(projectId) }
  });

  const generatePlan = useGenerateResearchPlan();
  const approvePlan = useApproveResearchPlan();

  const handleGenerate = () => {
    generatePlan.mutate({ id: projectId, data: {} }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetResearchPlanQueryKey(projectId) })
    });
  };

  const handleApprove = () => {
    approvePlan.mutate({ id: projectId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetResearchPlanQueryKey(projectId) })
    });
  };

  if (isLoading) return <div className="p-12 text-center animate-pulse">Loading research plan...</div>;

  if (!plan) {
    return (
      <Card className="text-center p-12 border-dashed">
        <CardContent className="space-y-4">
          <h3 className="text-xl font-serif">No Research Plan Yet</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            The AI will analyze your brief and brand guidelines to generate a structured research plan, including specific questions to answer and sources to find.
          </p>
          <Button onClick={handleGenerate} disabled={generatePlan.isPending}>
            {generatePlan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Generate Research Plan
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <Badge variant={plan.status === 'approved' ? 'success' : 'secondary'} className="uppercase">
            {plan.status}
          </Badge>
          <span className="text-sm font-medium text-muted-foreground">
            {plan.questions?.length || 0} Questions Identified
          </span>
        </div>
        <div className="flex gap-2">
          {plan.status !== 'approved' && (
            <>
              <Button variant="outline" onClick={handleGenerate} disabled={generatePlan.isPending}>
                Regenerate
              </Button>
              <Button onClick={handleApprove} disabled={approvePlan.isPending} className="bg-green-600 hover:bg-green-700 text-white">
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve Plan
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Research Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan.summary && <p className="text-sm">{plan.summary}</p>}
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div><span className="font-semibold text-xs uppercase text-muted-foreground block">Source Categories:</span> {plan.sourceCategories || "Any"}</div>
            <div><span className="font-semibold text-xs uppercase text-muted-foreground block">Timeframe:</span> {plan.timeframeStart || "Any"} - {plan.timeframeEnd || "Current"}</div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="text-lg font-serif font-semibold">Research Questions</h3>
        {plan.questions?.map((q, i) => (
          <Card key={q.id}>
            <CardHeader className="py-4">
              <div className="flex gap-4">
                <div className="text-xl font-serif text-muted-foreground">{(i + 1).toString().padStart(2, '0')}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <CardTitle className="text-base">{q.question}</CardTitle>
                    <Badge variant={q.status === 'answered' ? 'success' : 'secondary'} className="text-[10px]">
                      {q.status}
                    </Badge>
                  </div>
                  {q.answer && (
                    <div className="bg-muted/30 p-3 rounded text-sm mt-2">
                      <span className="font-semibold block text-xs text-muted-foreground uppercase mb-1">Synthesized Answer:</span>
                      {q.answer}
                    </div>
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
