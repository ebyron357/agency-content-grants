import { useListProviders, useUpsertProvider, useTestProvider, getListProvidersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export default function SettingsProviders() {
  const queryClient = useQueryClient();
  const { data: providers, isLoading } = useListProviders({
    query: { queryKey: getListProvidersQueryKey() }
  });

  const testProvider = useTestProvider();

  const handleTest = (providerName: string) => {
    testProvider.mutate({ data: { provider: providerName } }, {
      onSuccess: (res) => {
        alert(res.success ? `Success: ${res.message}` : `Failed: ${res.message}`);
        queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-serif tracking-tight mb-2">AI Providers</h1>
        <p className="text-muted-foreground">Configure connections to LLM providers for generation pipelines.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3].map(i => <Card key={i} className="h-48 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {providers?.map((provider) => (
            <Card key={provider.name} className={`flex flex-col ${!provider.isConfigured ? 'opacity-70' : ''}`}>
              <CardHeader>
                <div className="flex justify-between items-start mb-2">
                  <CardTitle>{provider.displayName}</CardTitle>
                  <Badge variant={provider.isConfigured ? 'success' : 'secondary'}>
                    {provider.isConfigured ? 'Configured' : 'Not Configured'}
                  </Badge>
                </div>
                <CardDescription>{provider.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                {!provider.isConfigured && (
                  <div className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-md border border-amber-200 dark:border-amber-900">
                    Add API key to environment variables to enable this provider.
                  </div>
                )}
                {provider.isConfigured && provider.lastTestedAt && (
                  <div className="text-xs text-muted-foreground mt-4 flex items-center gap-1">
                    {provider.status === 'ok' ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                    Last tested: {new Date(provider.lastTestedAt).toLocaleString()}
                  </div>
                )}
              </CardContent>
              <CardFooter className="border-t bg-muted/20 p-4">
                <Button 
                  variant="outline" 
                  className="w-full" 
                  disabled={!provider.isConfigured || testProvider.isPending}
                  onClick={() => handleTest(provider.name)}
                >
                  {testProvider.isPending && testProvider.variables?.data.provider === provider.name ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing...</>
                  ) : (
                    "Test Connection"
                  )}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
