import { useListBrands, getListBrandsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, ArrowRight, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function Brands() {
  const { data: brands, isLoading } = useListBrands({
    query: { queryKey: getListBrandsQueryKey() }
  });

  return (
    <div className="space-y-8 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-serif tracking-tight mb-2">Brand Portfolio</h1>
          <p className="text-muted-foreground">Manage brand voices, vocabularies, and audience profiles.</p>
        </div>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Create Brand
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse h-[300px]" />
          ))}
        </div>
      ) : brands && brands.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <Card key={brand.id} className="flex flex-col hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start mb-2">
                  <Badge variant={brand.status === 'active' ? 'default' : 'secondary'} className="uppercase text-[10px]">
                    {brand.status}
                  </Badge>
                  {brand.website && (
                    <a href={brand.website} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
                <CardTitle className="text-2xl">{brand.name}</CardTitle>
                <CardDescription className="line-clamp-2 min-h-[40px]">
                  {brand.description || "No description provided."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                {brand.industry && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Industry</span>
                    <span className="text-sm font-medium">{brand.industry}</span>
                  </div>
                )}
                {brand.voiceDescription && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">Voice</span>
                    <span className="text-sm line-clamp-2">{brand.voiceDescription}</span>
                  </div>
                )}
              </CardContent>
              <CardFooter className="border-t bg-muted/20 pt-4 pb-4">
                <Link href={`/brands/${brand.id}`} className="w-full">
                  <Button variant="ghost" className="w-full justify-between">
                    Manage Brand
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-24 border border-dashed rounded-lg bg-card">
          <Library className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-serif mb-2">No brands found</h3>
          <p className="text-muted-foreground mb-6">Create your first brand to start generating content.</p>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Create Brand
          </Button>
        </div>
      )}
    </div>
  );
}

// Temporary to avoid import error
import { Library } from "lucide-react";
