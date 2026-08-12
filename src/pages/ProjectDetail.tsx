import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { 
  useGetProject, useGetProjectWorkflowStatus, 
  getGetProjectQueryKey, getGetProjectWorkflowStatusQueryKey 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, CheckCircle2, Circle, AlertCircle } from "lucide-react";

import OverviewTab from "./project-detail/OverviewTab";
import ResearchTab from "./project-detail/ResearchTab";
import SourcesTab from "./project-detail/SourcesTab";
import ClaimsTab from "./project-detail/ClaimsTab";
import OutlineTab from "./project-detail/OutlineTab";
import EditorTab from "./project-detail/EditorTab";
import QualityTab from "./project-detail/QualityTab";

export default function ProjectDetail() {
  const params = useParams();
  const id = params.id as string;
  const tab = params.tab || "overview";
  const [, setLocation] = useLocation();

  const { data: project, isLoading: projectLoading } = useGetProject(id, {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) }
  });

  const { data: workflow } = useGetProjectWorkflowStatus(id, {
    query: { enabled: !!id, queryKey: getGetProjectWorkflowStatusQueryKey(id) }
  });

  if (projectLoading) return <div className="p-12 text-center animate-pulse">Loading project...</div>;
  if (!project) return <div className="p-12 text-center">Project not found.</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] space-y-6">
      <div className="flex items-start justify-between shrink-0">
        <div className="flex items-start gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="mt-1 rounded-full shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Badge variant="outline" className="uppercase text-[10px] tracking-wider">{project.brandName}</Badge>
              <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 uppercase text-[10px] tracking-wider">
                {project.contentType.replace('_', ' ')}
              </Badge>
            </div>
            <h1 className="text-3xl font-serif tracking-tight">{project.title}</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">{project.topic}</p>
          </div>
        </div>
        
        {/* Workflow Stepper Miniature */}
        {workflow && (
          <div className="flex items-center gap-2 bg-card border rounded-full px-4 py-2 shadow-sm">
            {workflow.stages.map((stage, i) => {
              const isActive = stage.stage === workflow.currentStage;
              const isCompleted = stage.status === 'completed';
              
              return (
                <div key={stage.stage} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 ${isActive ? 'text-primary font-medium' : isCompleted ? 'text-muted-foreground' : 'text-muted'}`}>
                    {isCompleted ? <CheckCircle2 className="h-4 w-4 text-green-600" /> :
                     isActive ? <Circle className="h-4 w-4 fill-primary/20 text-primary" /> :
                     <Circle className="h-4 w-4" />}
                    <span className="text-xs uppercase tracking-wider hidden md:inline-block">{stage.label}</span>
                  </div>
                  {i < workflow.stages.length - 1 && <div className="w-4 h-[1px] bg-border mx-1" />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <Tabs value={tab} onValueChange={v => setLocation(`/projects/${id}/${v}`)} className="flex flex-col h-full w-full">
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 mb-6 shrink-0 h-auto overflow-x-auto">
            {['overview', 'research', 'sources', 'claims', 'outline', 'editor', 'quality'].map(t => (
              <TabsTrigger 
                key={t} 
                value={t} 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3 text-sm uppercase tracking-wider font-semibold"
              >
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
          
          <div className="flex-1 overflow-y-auto pb-12">
            <TabsContent value="overview" className="m-0 h-full">
              <OverviewTab project={project} />
            </TabsContent>
            
            <TabsContent value="research" className="m-0 h-full">
               <ResearchTab projectId={id} />
            </TabsContent>
            
            <TabsContent value="sources" className="m-0 h-full">
               <SourcesTab projectId={id} />
            </TabsContent>
            
            <TabsContent value="claims" className="m-0 h-full">
               <ClaimsTab projectId={id} />
            </TabsContent>

            <TabsContent value="outline" className="m-0 h-full">
               <OutlineTab projectId={id} />
            </TabsContent>

            <TabsContent value="editor" className="m-0 h-full">
               <EditorTab projectId={id} />
            </TabsContent>

            <TabsContent value="quality" className="m-0 h-full">
               <QualityTab projectId={id} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
