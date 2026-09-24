export const WORKFLOW_STEPS = [
  "Brief",
  "Research",
  "Structure",
  "Draft",
] as const;

export function workflowStepIndex(stage: string): number {
  if (stage === "assignment") return 0;
  if (["research_plan", "sources", "claims"].includes(stage)) return 1;
  if (stage === "outline") return 2;
  if (["drafting", "editing", "quality", "export"].includes(stage)) return 3;
  return 0;
}

export function stageToLabel(stage: string): string {
  const map: Record<string, string> = {
    assignment: "Preparing your project…",
    research_plan: "Researching your topic…",
    sources: "Collecting source material…",
    claims: "Analyzing key points…",
    outline: "Building the outline…",
    drafting: "Drafting your content…",
    editing: "Preparing the editor…",
    quality: "Checking content quality…",
    export: "Preparing export options…",
  };
  return map[stage] ?? "Working on it…";
}
