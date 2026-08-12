/**
 * Create — "New Content" entry point.
 *
 * Implements the Quick generation flow (audit §5, milestone §14):
 *   1. User enters topic + content type (+ optional advanced settings)
 *   2. "Generate" creates the project and calls POST /generate-brief
 *   3. While in-flight, real progress is polled from /workflow-status
 *   4. On completion, navigate to /projects/:id?mode=quick for Phase 2
 *      (section-by-section drafting via useDraftAllSections)
 *
 * Duplicate-submission prevention: the Generate button is disabled while
 * isGenerating is true, and the projectId is locked after the first call.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useListBrands } from "@workspace/api-client-react";
import { apiPost } from "@/lib/api";
import {
  FileText,
  Newspaper,
  BookOpen,
  Mail,
  BookMarked,
  BarChart3,
  ListChecks,
  StickyNote,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Content types ────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  {
    value: "blog",
    label: "Blog Post",
    description: "Engaging, shareable article",
    icon: FileText,
  },
  {
    value: "article",
    label: "Article",
    description: "In-depth editorial piece",
    icon: Newspaper,
  },
  {
    value: "guide",
    label: "Guide",
    description: "Step-by-step instructional",
    icon: BookOpen,
  },
  {
    value: "whitepaper",
    label: "White Paper",
    description: "Research-backed analysis",
    icon: BookMarked,
  },
  {
    value: "newsletter",
    label: "Newsletter",
    description: "Subscriber update",
    icon: Mail,
  },
  {
    value: "ebook",
    label: "Ebook",
    description: "Long-form downloadable",
    icon: StickyNote,
  },
  {
    value: "report",
    label: "Report",
    description: "Data-driven findings",
    icon: BarChart3,
  },
  {
    value: "sop",
    label: "SOP / Process",
    description: "Operating procedure",
    icon: ListChecks,
  },
] as const;

type ContentTypeValue = (typeof CONTENT_TYPES)[number]["value"];

// ─── Progress labels (map workflowStage → user-friendly label) ─────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Create() {
  const [, navigate] = useLocation();
  const { data: brands = [] } = useListBrands();

  // ── Form state
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState<ContentTypeValue>("blog");
  const [brandId, setBrandId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [audience, setAudience] = useState("");
  const [purpose, setPurpose] = useState("");
  const [targetLength, setTargetLength] = useState("");
  const [tone, setTone] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  // ── Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStageLabel, setGeneratingStageLabel] = useState(
    "Preparing your project…"
  );
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate submissions after the first project is created
  const generatingProjectIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pre-select the first brand if only one exists
  useEffect(() => {
    if (brands.length === 1 && !brandId) {
      setBrandId(brands[0].id);
    }
  }, [brands, brandId]);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const startProgressPolling = useCallback((projectId: string) => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/api/projects/${projectId}/workflow-status`);
        if (res.ok) {
          const status = await res.json();
          setGeneratingStageLabel(stageToLabel(status.currentStage ?? ""));
        }
      } catch {
        // Non-fatal — polling continues
      }
    }, 1500);
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) return;
    if (!brandId && brands.length > 0) return; // brand required if brands exist

    // Duplicate-submission guard
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setGeneratingStageLabel("Preparing your project…");

    try {
      // Step 1: Create project
      const projectBody: Record<string, string> = {
        brandId: brandId || (brands[0]?.id ?? ""),
        title: trimmedTopic.length > 100
          ? trimmedTopic.slice(0, 97) + "…"
          : trimmedTopic,
        topic: trimmedTopic,
        contentType,
        ...(audience ? { intendedAudience: audience } : {}),
        ...(purpose ? { purpose } : {}),
        ...(targetLength ? { targetLength } : {}),
        ...(tone ? { tone } : {}),
        ...(additionalInstructions
          ? { additionalInstructions }
          : {}),
      };

      const project = await apiPost("/projects", projectBody);
      if (!project?.id) throw new Error("Failed to create project");

      const projectId: string = project.id;
      generatingProjectIdRef.current = projectId;

      // Step 2: Start progress polling
      startProgressPolling(projectId);

      // Step 3: Run Phase 1 orchestration (research + outline + doc-init)
      await apiPost(`/projects/${projectId}/generate-brief`);

      // Step 4: Navigate to project page with Quick mode flag
      // Phase 2 (section drafting) runs on the project page via useDraftAllSections
      navigate(`/projects/${projectId}?mode=quick`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Generation failed. Please try again."
      );
      setIsGenerating(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [
    topic,
    brandId,
    brands,
    contentType,
    audience,
    purpose,
    targetLength,
    tone,
    additionalInstructions,
    isGenerating,
    navigate,
    startProgressPolling,
  ]);

  const canGenerate =
    topic.trim().length > 0 &&
    (!brands.length || brandId) &&
    !isGenerating;

  // ── Generation loading screen
  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F9F8F6] px-6">
        <div className="w-full max-w-sm text-center space-y-8">
          <div className="space-y-2">
            <div className="w-10 h-10 bg-[#C8102E] rounded-lg flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-bold text-[#111] font-serif">
              Creating your content
            </h2>
            <p className="text-sm text-stone-500">
              {generatingStageLabel}
            </p>
          </div>

          <div className="space-y-3 text-left">
            {[
              "Preparing your project…",
              "Reviewing your brief…",
              "Building the outline…",
              "Outline complete — almost ready…",
            ].map((step, i) => {
              const currentStepIdx = [
                "Preparing your project…",
                "Researching your topic…",
                "Reviewing your brief…",
                "Analyzing key points…",
                "Building the outline…",
                "Outline complete — almost ready…",
              ].indexOf(generatingStageLabel);

              const stepMap = [0, 2, 4, 5]; // indices in the full stage array
              const stepIdx = stepMap[i];
              const isDone = stepIdx < currentStepIdx;
              const isActive = stepIdx === currentStepIdx || (i === 0 && currentStepIdx <= 1);

              return (
                <div key={step} className="flex items-center gap-3">
                  {isDone ? (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : isActive ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#C8102E] flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-stone-200 flex-shrink-0" />
                  )}
                  <span
                    className={cn(
                      "text-sm",
                      isDone && "text-stone-400 line-through decoration-stone-300",
                      isActive && "text-stone-800 font-medium",
                      !isDone && !isActive && "text-stone-400"
                    )}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Creation form
  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      {/* Header */}
      <div className="border-b border-stone-200 bg-white px-8 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link
            href="/projects"
            className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <span className="text-xs text-stone-400 font-medium tracking-widest uppercase">
            New Content
          </span>
          <div className="w-16" />
        </div>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-8 py-10 space-y-8">
        {/* Hero */}
        <div>
          <h1 className="text-3xl font-bold text-[#111] font-serif leading-tight">
            What would you like to write?
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Describe your topic and the AI will research, outline, and draft
            the full document.
          </p>
        </div>

        {/* Topic */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-stone-700">
            Topic <span className="text-[#C8102E]">*</span>
          </label>
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. How electric vehicles are reshaping the automotive industry in 2025"
            rows={3}
            className="resize-none text-base placeholder:text-stone-400 focus:ring-[#C8102E] focus:border-[#C8102E]"
            disabled={isGenerating}
          />
          <p className="text-xs text-stone-400">
            Be as specific as you like — more detail produces more focused
            content.
          </p>
        </div>

        {/* Content type */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-stone-700">
            Content type <span className="text-[#C8102E]">*</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {CONTENT_TYPES.map((ct) => {
              const Icon = ct.icon;
              const active = contentType === ct.value;
              return (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => setContentType(ct.value)}
                  disabled={isGenerating}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-lg border text-center transition-all",
                    active
                      ? "border-[#C8102E] bg-red-50 text-[#C8102E]"
                      : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium leading-tight">
                    {ct.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Brand selector */}
        {brands.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-semibold text-stone-700">
              Brand {brands.length > 1 && <span className="text-[#C8102E]">*</span>}
            </label>
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              disabled={isGenerating}
              className="w-full border border-stone-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#C8102E] focus:border-[#C8102E]"
            >
              {brands.length > 1 && (
                <option value="">Select a brand…</option>
              )}
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.industry ? ` — ${b.industry}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No brands warning */}
        {brands.length === 0 && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">No brands set up yet</p>
              <p className="text-amber-700 mt-0.5">
                <Link
                  href="/brands"
                  className="underline hover:no-underline"
                >
                  Create a brand
                </Link>{" "}
                to apply voice rules and content guidelines to your writing.
              </p>
            </div>
          </div>
        )}

        {/* Advanced options */}
        <div className="border border-stone-200 rounded-lg bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            disabled={isGenerating}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
          >
            <span>Advanced options</span>
            {showAdvanced ? (
              <ChevronUp className="w-4 h-4 text-stone-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-stone-400" />
            )}
          </button>

          {showAdvanced && (
            <div className="px-4 pb-4 pt-1 space-y-4 border-t border-stone-100">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-stone-600">
                    Intended audience
                  </label>
                  <Input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="e.g. Marketing managers"
                    disabled={isGenerating}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-stone-600">
                    Purpose
                  </label>
                  <Input
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="e.g. Lead generation"
                    disabled={isGenerating}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-stone-600">
                    Target length
                  </label>
                  <Input
                    value={targetLength}
                    onChange={(e) => setTargetLength(e.target.value)}
                    placeholder="e.g. 1,500 words"
                    disabled={isGenerating}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-stone-600">
                    Tone
                  </label>
                  <Input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    placeholder="e.g. Professional, conversational"
                    disabled={isGenerating}
                    className="text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-stone-600">
                  Additional instructions
                </label>
                <Textarea
                  value={additionalInstructions}
                  onChange={(e) => setAdditionalInstructions(e.target.value)}
                  placeholder="Any specific requirements, structure preferences, or points to cover…"
                  rows={3}
                  disabled={isGenerating}
                  className="resize-none text-sm"
                />
              </div>
              <p className="text-xs text-stone-400">
                Sources can be added to the project after generation for
                re-drafting with grounded content.
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Generate */}
        <Button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="w-full h-12 text-base font-semibold bg-[#C8102E] hover:bg-[#a80d25] text-white gap-2"
        >
          <Sparkles className="w-5 h-5" />
          Generate Content
        </Button>

        <p className="text-xs text-center text-stone-400">
          Generation takes 15–30 seconds. You can edit the result before
          exporting.
        </p>
      </div>
    </div>
  );
}
