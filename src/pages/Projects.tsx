import { useListProjects, getListProjectsQueryKey, useListBrands, getListBrandsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, Search, Filter } from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

export default function Projects() {
  const { data: projects, isLoading } = useListProjects({}, {
    query: { queryKey: getListProjectsQueryKey() }
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-serif tracking-tight mb-2">Projects</h1>
          <p className="text-muted-foreground">Manage active content pipelines and archives.</p>
        </div>
        <Link href="/projects/new">
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="p-4 border-b">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search projects..." className="pl-9" />
            </div>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground animate-pulse">Loading projects...</div>
          ) : projects && projects.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Project</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <Link href={`/projects/${project.id}`}>
                        <div className="block w-full">
                          <span className="font-medium text-foreground text-base block">{project.title}</span>
                          {project.topic && <span className="text-sm text-muted-foreground truncate max-w-md block">{project.topic}</span>}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-background">{project.brandName || "No Brand"}</Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {project.contentType.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      <Badge className={
                        project.workflowStage === 'published' ? 'bg-green-100 text-green-800' :
                        project.workflowStage === 'drafting' ? 'bg-blue-100 text-blue-800' :
                        project.workflowStage === 'quality_review' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }>
                        {project.workflowStage.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {format(new Date(project.updatedAt), 'MMM d, yyyy')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-16">
              <FolderKanban className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-serif mb-2">No projects yet</h3>
              <p className="text-muted-foreground mb-6">Start a new content piece to see it here.</p>
              <Link href="/projects/new">
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Temporary for fallback icon
import { FolderKanban } from "lucide-react";
