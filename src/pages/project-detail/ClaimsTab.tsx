import { useListClaims, useVerifyClaim, getListClaimsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldAlert, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function ClaimsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: claims, isLoading } = useListClaims({ projectId }, {
    query: { queryKey: getListClaimsQueryKey({ projectId }) }
  });

  const verifyClaim = useVerifyClaim();

  const handleVerify = (id: string) => {
    verifyClaim.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey({ projectId }) })
    });
  };

  if (isLoading) return <div className="p-12 text-center animate-pulse">Loading claims...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Factual claims extracted from sources that require verification before use.</p>
        <Button variant="outline">Run Verification Sweep</Button>
      </div>

      {claims && claims.length > 0 ? (
        <div className="grid gap-4">
          {claims.map(claim => (
            <Card key={claim.id} className="overflow-hidden">
              <div className="flex border-l-4" style={{ borderColor: claim.verificationStatus === 'verified' ? '#16a34a' : claim.verificationStatus === 'refuted' ? '#dc2626' : '#d97706' }}>
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {claim.verificationStatus === 'verified' ? <Shield className="h-4 w-4 text-green-600" /> : <ShieldAlert className="h-4 w-4 text-amber-500" />}
                      <span className="font-semibold text-sm">Fact</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{claim.claimType}</Badge>
                    </div>
                    <Badge variant={claim.verificationStatus === 'verified' ? 'success' : 'secondary'} className="text-[10px] uppercase">
                      {claim.verificationStatus}
                    </Badge>
                  </div>
                  <p className="text-lg font-serif my-2">{claim.claimText}</p>
                  
                  {claim.supportingExcerpt && (
                    <div className="mt-3 bg-muted/30 p-3 rounded-md text-sm border-l-2 border-muted-foreground">
                      <p className="italic text-muted-foreground">"{claim.supportingExcerpt}"</p>
                      {claim.sourceTitle && <p className="text-xs font-semibold mt-2">— {claim.sourceTitle}</p>}
                    </div>
                  )}
                </div>
                <div className="w-48 bg-muted/10 border-l p-4 flex flex-col items-center justify-center gap-2">
                  <div className="text-center mb-2">
                    <span className="block text-3xl font-bold text-primary">{claim.confidence ? `${claim.confidence}%` : '-'}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</span>
                  </div>
                  {claim.verificationStatus !== 'verified' && (
                    <Button size="sm" onClick={() => handleVerify(claim.id)} disabled={verifyClaim.isPending} className="w-full">
                      Verify
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="text-center p-12 border-dashed">
          <CardContent>
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-serif mb-2">No Claims Extracted</h3>
            <p className="text-muted-foreground">Claims will appear here once sources are processed.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
