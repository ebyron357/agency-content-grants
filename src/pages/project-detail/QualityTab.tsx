import { useGetQualityEvaluation, useRunQualityEvaluation, getGetQualityEvaluationQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function QualityTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: evaluation, isLoading } = useGetQualityEvaluation(projectId, {
    query: { queryKey: getGetQualityEvaluationQueryKey(projectId) }
  });

  const runEval = useRunQualityEvaluation();

  const handleRun = () => {
    // Requires documentId ideally, but API takes id as project or evaluation id? 
    // We assume projectId works if it's the only param.
    runEval.mutate({ id: projectId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetQualityEvaluationQueryKey(projectId) })
    });
  };

  if (isLoading) return <div className="p-12 text-center animate-pulse">Loading quality evaluation...</div>;

  if (!evaluation) {
    return (
      <Card className="text-center p-12 border-dashed">
        <CardContent className="space-y-4">
          <Activity className="h-12 w-12 text-muted-foreground mx-auto opacity-50" />
          <h3 className="text-xl font-serif">No Evaluation Run</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Run a full multidimensional quality check against brand guidelines, accuracy, and tone.
          </p>
          <Button onClick={handleRun} disabled={runEval.isPending}>
            {runEval.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run Quality Evaluation
          </Button>
        </CardContent>
      </Card>
    );
  }

  const scores = [
    { label: "Fact Accuracy", score: evaluation.accuracyScore },
    { label: "Brand Fit", score: evaluation.brandFitScore },
    { label: "Naturalness", score: evaluation.naturalnessScore },
    { label: "Coherence", score: evaluation.coherenceScore },
    { label: "Citations", score: evaluation.citationScore }
  ].filter(s => s.score !== null && s.score !== undefined);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <Badge variant={evaluation.overallPass ? 'success' : 'destructive'} className="uppercase text-sm px-3 py-1">
            {evaluation.overallPass ? 'Ready for Publication' : 'Needs Revision'}
          </Badge>
        </div>
        <Button variant="outline" onClick={handleRun} disabled={runEval.isPending}>
          Re-run Evaluation
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Multidimensional Scores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {scores.map(s => (
              <div key={s.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">{s.label}</span>
                  <span className="font-mono">{s.score}/100</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${s.score! > 85 ? 'bg-green-500' : s.score! > 60 ? 'bg-amber-500' : 'bg-red-500'}`} 
                    style={{ width: `${s.score}%` }} 
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identified Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {evaluation.issues && evaluation.issues.length > 0 ? (
              <div className="space-y-4">
                {evaluation.issues.map(issue => (
                  <div key={issue.id} className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 rounded-md">
                    <div className="flex items-start justify-between mb-1">
                      <Badge variant="destructive" className="text-[10px] uppercase">{issue.severity}</Badge>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{issue.category}</span>
                    </div>
                    <p className="text-sm font-medium mt-2">{issue.description}</p>
                    {issue.suggestedFix && (
                      <p className="text-xs text-muted-foreground mt-2 border-l-2 border-red-200 pl-2">
                        Fix: {issue.suggestedFix}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-8 text-green-600">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No issues identified.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
// fallback CheckCircle import
import { CheckCircle } from "lucide-react";