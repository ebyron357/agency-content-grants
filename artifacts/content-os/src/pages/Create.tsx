import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useListBrands } from "@workspace/api-client-react";
import { apiPost } from "@/lib/api";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  BookMarked,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Layers3,
  ListChecks,
  Loader2,
  Mail,
  Newspaper,
  Sparkles,
  StickyNote,
  Target,
  WandSparkles,
  X,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CONTENT_TYPES = [
  { value: "blog", label: "Blog Post", description: "Fast, useful, discoverable", icon: FileText, mode: "Growth" },
  { value: "article", label: "Article", description: "A considered editorial piece", icon: Newspaper, mode: "Editorial" },
  { value: "guide", label: "Guide", description: "A clear path from A to B", icon: BookOpen, mode: "Education" },
  { value: "whitepaper", label: "White Paper", description: "Evidence-led perspective", icon: StickyNote, mode: "Authority" },
  { value: "newsletter", label: "Newsletter", description: "A signal worth opening", icon: Mail, mode: "Retention" },
  { value: "ebook", label: "Ebook", description: "A durable content asset", icon: BookMarked, mode: "Depth" },
  { value: "report", label: "Report", description: "Findings with a point of view", icon: BarChart3, mode: "Intelligence" },
  { value: "sop", label: "SOP / Process", description: "Repeatable operational clarity", icon: ListChecks, mode: "Operations" },
] as const;

type ContentTypeValue = (typeof CONTENT_TYPES)[number]["value"];

type ResearchDepth = "quick" | "balanced" | "deep";

function stageToLabel(stage: string): string {
  const map: Record<string, string> = {
    assignment: "Preparing your project…",
    research_plan: "Researching your topic…",
    sources: "Reviewing your brief…",
    claims: "Analyzing key points…",
    outline: "Building the outline…",
    drafting: "Outline complete — almost ready…",
  };
  return map[stage] ?? "Working on it…";
}

const workflowSteps = ["Brief", "Research", "Structure", "Draft"];

export default function Create() {
  const [, navigate] = useLocation();
  const { data: brands = [] } = useListBrands();
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState<ContentTypeValue>("blog");
  const [brandId, setBrandId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [targetLength, setTargetLength] = useState("");
  const [tone, setTone] = useState("");
  const [researchDepth, setResearchDepth] = useState<ResearchDepth>("balanced");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStageLabel, setGeneratingStageLabel] = useState("Preparing your project…");
  const [error, setError] = useState<string | null>(null);
  const generatingProjectIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (brands.length === 1 && !brandId) setBrandId(brands[0].id);
  }, [brands, brandId]);

  useEffect(() => () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  }, []);

  const startProgressPolling = useCallback((projectId: string) => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/api/projects/${projectId}/workflow-status`);
        if (res.ok) setGeneratingStageLabel(stageToLabel((await res.json()).currentStage ?? ""));
      } catch {
        // Polling is non-blocking; the generation request remains authoritative.
      }
    }, 1500);
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic || (!brandId && brands.length > 0) || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setGeneratingStageLabel("Preparing your project…");
    try {
      const projectBody: Record<string, string> = {
        brandId: brandId || (brands[0]?.id ?? ""),
        title: trimmedTopic.length > 100 ? `${trimmedTopic.slice(0, 97)}…` : trimmedTopic,
        topic: trimmedTopic,
        contentType,
        ...(audience ? { intendedAudience: audience } : {}),
        ...(purpose ? { purpose } : {}),
        ...(targetLength ? { targetLength } : {}),
        ...(tone ? { tone } : {}),
        researchFreshness: researchDepth,
        ...(additionalInstructions ? { additionalInstructions } : {}),
      };
      const project = await apiPost("/projects", projectBody);
      if (!project?.id) throw new Error("Failed to create project");
      const projectId: string = project.id;
      generatingProjectIdRef.current = projectId;
      startProgressPolling(projectId);
      await apiPost(`/projects/${projectId}/generate-brief`);
      navigate(`/projects/${projectId}?mode=quick`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed. Please try again.");
      setIsGenerating(false);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
  }, [topic, brandId, brands, contentType, audience, purpose, targetLength, tone, researchDepth, additionalInstructions, isGenerating, navigate, startProgressPolling]);

  const selected = CONTENT_TYPES.find((type) => type.value === contentType) ?? CONTENT_TYPES[0];
  const canGenerate = topic.trim().length > 0 && (!brands.length || brandId) && !isGenerating;

  if (isGenerating) {
    return (
      <div className="min-h-screen bg-[#080a0f] px-6 text-white flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-white/[0.09] bg-[#10131a] p-8 shadow-2xl shadow-black/40">
          <div className="mb-10 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e5484d] text-white"><Sparkles className="h-5 w-5" /></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">Content OS</p><p className="text-sm text-white/70">Workflow in progress</p></div></div>
          <div className="mb-8"><p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-[#ff7b7b]">Building your asset</p><h1 className="text-2xl font-semibold tracking-tight">Turning intent into a content system.</h1><p className="mt-2 text-sm leading-relaxed text-white/50">{generatingStageLabel}</p></div>
          <div className="space-y-3">
            {workflowSteps.map((step, index) => <div key={step} className="flex items-center gap-3 rounded-xl border border-white/[0.07] px-4 py-3"><div className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-[11px]", index < 1 ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-300" : index === 1 ? "border-[#e5484d]/70 bg-[#e5484d]/10 text-[#ff9b9b]" : "border-white/10 text-white/35")}>{index < 1 ? <Check className="h-3.5 w-3.5" /> : index === 1 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : index + 1}</div><span className={cn("text-sm", index <= 1 ? "text-white" : "text-white/35")}>{step}</span></div>)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080a0f] text-white">
      <header className="border-b border-white/[0.08] bg-[#080a0f]/95 px-5 py-4 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between"><Link href="/projects" className="group inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white"><ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-0.5" /> All projects</Link><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/35"><WandSparkles className="h-3.5 w-3.5 text-[#ff7979]" /> New workflow</div><div className="hidden w-24 sm:block" /></div>
      </header>

      <main className="mx-auto grid max-w-[1280px] gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-12 lg:py-12">
        <section>
          <div className="mb-10 max-w-2xl"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#e5484d]/25 bg-[#e5484d]/[0.08] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#ff9696]"><span className="h-1.5 w-1.5 rounded-full bg-[#ff7979]" /> Brief the system</div><h1 className="text-4xl font-semibold tracking-[-0.045em] text-white sm:text-5xl">What would you like to write?</h1><p className="mt-4 max-w-xl text-sm leading-7 text-white/48 sm:text-base">Give Content OS the intent. We’ll turn it into a brief, research path, structure, and first draft you can shape.</p></div>

          <div className="space-y-8">
            <div className="rounded-3xl border border-white/[0.09] bg-[#10131a] p-5 shadow-2xl shadow-black/20 sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35"><span className="text-[#ff7979]">01</span> Intent</div><h2 className="text-lg font-semibold tracking-tight">What should exist when we’re done?</h2></div><Target className="h-5 w-5 text-white/20" /></div><Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. How electric vehicles are reshaping the automotive industry in 2025" rows={5} disabled={isGenerating} className="min-h-[150px] resize-none rounded-2xl border-white/[0.1] bg-[#080a0f] px-4 py-4 text-base leading-7 text-white placeholder:text-white/25 focus:border-[#e5484d]/70 focus:ring-[#e5484d]/30" /><div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/30"><span>Specific intent creates a sharper first pass.</span><span>{topic.length}/500</span></div></div>

            <div className="rounded-3xl border border-white/[0.09] bg-[#10131a] p-5 sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35"><span className="text-[#ff7979]">02</span> Output shape</div><h2 className="text-lg font-semibold tracking-tight">Choose the shape of the work.</h2><p className="mt-1 text-sm text-white/42">Start with a mode. You can refine the brief before generation.</p></div><Layers3 className="h-5 w-5 text-white/20" /></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{CONTENT_TYPES.map((type) => { const Icon = type.icon; const active = contentType === type.value; return <button key={type.value} type="button" onClick={() => setContentType(type.value)} className={`${cn("group relative flex min-h-[88px] flex-col justify-between rounded-2xl border p-3 text-left transition-all", active ? "border-[#e5484d]/80 bg-[#e5484d]/[0.12] shadow-[0_0_0_1px_rgba(229,72,77,0.16)]" : "border-white/[0.07] bg-[#080a0f] hover:border-white/20 hover:bg-white/[0.03]")} ${active ? "border-[#C8102E]" : ""}`}><div className="flex items-center justify-between"><Icon className={cn("h-4 w-4", active ? "text-[#ff9696]" : "text-white/35 group-hover:text-white/65")} />{active && <Check className="h-3.5 w-3.5 text-[#ff9696]" />}</div><div><p className={cn("text-sm font-medium", active ? "text-white" : "text-white/70")}>{type.label}</p><p className="mt-1 hidden text-[10px] leading-4 text-white/35 sm:block">{type.description}</p></div></button>; })}</div></div>

            <div className="rounded-3xl border border-white/[0.09] bg-[#10131a] p-5 sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35"><span className="text-[#ff7979]">03</span> Context</div><h2 className="text-lg font-semibold tracking-tight">Set the operating context.</h2></div><Layers3 className="h-5 w-5 text-white/20" /></div><div className="grid gap-5 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-medium text-white/45">Brand workspace</label>{brands.length > 0 ? <select value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={isGenerating} className="h-11 w-full rounded-xl border border-white/[0.1] bg-[#080a0f] px-3 text-sm text-white focus:border-[#e5484d]/70 focus:outline-none">{brands.length > 1 && <option value="">Select a brand…</option>}{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}{brand.industry ? ` — ${brand.industry}` : ""}</option>)}</select> : <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-200">No brands yet. <Link href="/brands" className="underline">Create a brand</Link> first.</div>}</div><div><label className="mb-2 block text-xs font-medium text-white/45">Research depth</label><div className="flex rounded-xl border border-white/[0.1] bg-[#080a0f] p-1">{([['quick', 'Quick'], ['balanced', 'Balanced'], ['deep', 'Deep']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setResearchDepth(value)} className={cn("flex-1 rounded-lg px-2 py-2 text-xs font-medium transition", researchDepth === value ? "bg-white/[0.12] text-white" : "text-white/35 hover:text-white/70")}>{label}</button>)}</div></div></div><div className="mt-5 grid gap-5 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-medium text-white/45">Audience <span className="text-white/25">optional</span></label><Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Marketing managers" disabled={isGenerating} className="h-11 rounded-xl border-white/[0.1] bg-[#080a0f] text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/70 focus:ring-[#e5484d]/30" /></div><div><label className="mb-2 block text-xs font-medium text-white/45">Outcome <span className="text-white/25">optional</span></label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What should it change?" disabled={isGenerating} className="h-11 rounded-xl border-white/[0.1] bg-[#080a0f] text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/70 focus:ring-[#e5484d]/30" /></div></div></div>

            <div className="rounded-3xl border border-white/[0.09] bg-[#10131a] overflow-hidden"><button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex w-full items-center justify-between px-5 py-5 text-left transition hover:bg-white/[0.025] sm:px-7"><span><span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">04 · Optional precision</span><span className="text-sm font-semibold text-white">Advanced options</span><span className="ml-2 text-xs text-white/35">{showAdvanced ? "Open" : "Tune advanced settings"}</span></span>{showAdvanced ? <ChevronUp className="h-4 w-4 text-white/35" /> : <ChevronDown className="h-4 w-4 text-white/35" />}</button>{showAdvanced && <div className="grid gap-5 border-t border-white/[0.08] px-5 pb-6 pt-5 sm:grid-cols-2 sm:px-7"><div><label className="mb-2 block text-xs font-medium text-white/45">Target length</label><Input value={targetLength} onChange={(e) => setTargetLength(e.target.value)} placeholder="e.g. 1,500 words" className="h-11 rounded-xl border-white/[0.1] bg-[#080a0f] text-sm text-white placeholder:text-white/25" /></div><div><label className="mb-2 block text-xs font-medium text-white/45">Tone / point of view</label><Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. direct, optimistic" className="h-11 rounded-xl border-white/[0.1] bg-[#080a0f] text-sm text-white placeholder:text-white/25" /></div><div className="sm:col-span-2"><label className="mb-2 block text-xs font-medium text-white/45">Additional direction</label><Textarea value={additionalInstructions} onChange={(e) => setAdditionalInstructions(e.target.value)} placeholder="Specific requirements, structure preferences, or points to cover…" rows={4} className="resize-none rounded-xl border-white/[0.1] bg-[#080a0f] text-sm leading-6 text-white placeholder:text-white/25" /><p className="mt-2 text-xs text-white/30">You can add sources and refine claims after the first workflow pass.</p></div></div>}</div>

            {error && <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-sm text-red-200"><X className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

            <div className="flex flex-col gap-4 rounded-3xl border border-[#e5484d]/25 bg-[#e5484d]/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><div className="flex items-center gap-2 text-xs font-medium text-[#ffb0b0]"><WandSparkles className="h-4 w-4" /> Ready to brief the system</div><p className="mt-2 max-w-lg text-xs leading-5 text-white/42">Content OS will create the brief, research plan, outline, and first draft. You stay in control before anything ships.</p></div><button type="button" onClick={handleGenerate} disabled={!canGenerate} className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e5484d] px-5 text-sm font-semibold text-white shadow-lg shadow-[#e5484d]/20 transition hover:bg-[#f15b5f] disabled:cursor-not-allowed disabled:opacity-35"><Sparkles className="h-4 w-4" /> Generate Content <ArrowRight className="h-4 w-4" /></button></div>
          </div>
        </section>

        <aside className="lg:pt-16"><div className="sticky top-8 rounded-3xl border border-white/[0.09] bg-[#10131a] p-5 sm:p-6"><div className="mb-7 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">Workflow preview</span><span className="rounded-full border border-white/[0.1] px-2 py-1 text-[10px] text-white/40">Live brief</span></div><div className="mb-7"><div className="mb-3 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e5484d]/[0.12] text-[#ff9696]"><selected.icon className="h-5 w-5" /></div><div><p className="text-lg font-semibold text-white">{selected.mode} workflow</p><p className="text-xs text-white/38">{selected.mode} workflow</p></div></div><p className="text-sm leading-6 text-white/45">{selected.description}. Your brief will be shaped for clarity, momentum, and review.</p></div><div className="space-y-2 border-t border-white/[0.08] pt-5">{[["Intent", topic ? "Captured" : "Waiting"], ["Format", selected.mode], ["Brand", brands.find((brand) => brand.id === brandId)?.name ?? "Select one"], ["Research", researchDepth === "deep" ? "Deep" : researchDepth === "quick" ? "Quick" : "Balanced"]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 text-xs"><span className="text-white/35">{label}</span><span className={cn("truncate text-right", value === "Waiting" || value === "Select one" ? "text-white/25" : "text-white/75")}>{value}</span></div>)}</div><div className="mt-7 border-t border-white/[0.08] pt-5"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">What happens next</p><div className="space-y-3">{workflowSteps.map((step, index) => <div key={step} className="flex items-center gap-3"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.12] text-[10px] text-white/35">{index + 1}</span><span className="text-xs text-white/50">{step}</span></div>)}</div></div></div></aside>
      </main>
    </div>
  );
}
