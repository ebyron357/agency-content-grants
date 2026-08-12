import { db } from "@workspace/db";
import {
  projectsTable,
  brandsTable,
  brandFactsTable,
  researchPlansTable,
  researchQuestionsTable,
  sourcesTable,
  claimsTable,
  outlinesTable,
  outlineSectionsTable,
  documentsTable,
  documentSectionsTable,
  sectionRevisionsTable,
  qualityEvaluationsTable,
  qualityIssuesTable,
  generationRunsTable,
  activityLogTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateForStage } from "../ai/router";
import { getBrandBrainBlock } from "../brand-brain";
import type { ChatMessage } from "../ai/types";
import { randomUUID } from "crypto";
import { logActivity as logActivityEvent } from "../activity";
import { emitEvent } from "../webhooks/events";

// Best-effort: an audit failure must never fail the generation pipeline
async function logActivity(type: string, description: string, projectId: string, projectTitle?: string, brandName?: string) {
  await logActivityEvent(type, description, { projectId, projectTitle, brandName })
    .catch((e: unknown) => console.warn("[activity] log failed:", (e as Error).message));
}

async function logGeneration(run: {
  projectId: string;
  documentSectionId?: string;
  pipelineStage: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: string;
  errorMessage?: string;
}) {
  await db.insert(generationRunsTable).values({ id: randomUUID(), retryCount: 0, ...run });
}

export async function generateResearchPlan(projectId: string, additionalContext?: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);
  const brainBlock = brand ? await getBrandBrainBlock(brand.id, `${project.title} ${project.topic ?? ""}`) : "";

  const messages: ChatMessage[] = [
    { role: "system", content: "You are a professional research planner for a content creation team. Create thorough research plans that guide factual, high-quality content production." },
    {
      role: "user",
      content: `Create a detailed research plan for the following content project.

Project: ${project.title}
Topic: ${project.topic ?? "Not specified"}
Content Type: ${project.contentType}
Intended Audience: ${project.intendedAudience ?? "General"}
Audience Knowledge Level: ${project.audienceKnowledgeLevel ?? "Intermediate"}
Geographic Focus: ${project.geographicFocus ?? "Global"}
Purpose: ${project.purpose ?? "Not specified"}
Brand Voice: ${brand?.voiceDescription ?? "Professional and clear"}
${brainBlock ? `${brainBlock}\n` : ""}${additionalContext ? `Additional Context: ${additionalContext}` : ""}

Return a JSON object with exactly this structure:
{
  "summary": "Brief overview of the research approach",
  "timeframeStart": "YYYY-MM-DD",
  "timeframeEnd": "YYYY-MM-DD",
  "geographicBoundaries": "Geographic scope for sources",
  "sourceCategories": "Comma-separated source types to prioritize",
  "potentialConflicts": "Known areas of conflicting information",
  "missingInformation": "Gaps that may be hard to fill",
  "questions": [
    { "question": "Specific research question", "priority": 1 }
  ]
}`,
    },
  ];

  const result = await generateForStage("research", messages);
  await logGeneration({ projectId, pipelineStage: "research_plan", provider: result.provider, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: result.estimatedCostUsd, latencyMs: result.latencyMs, status: "completed" });

  let parsed: any;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {
    parsed = { summary: result.content, questions: [] };
  }

  const existing = await db.select().from(researchPlansTable).where(eq(researchPlansTable.projectId, projectId)).limit(1);
  if (existing[0]) {
    await db.delete(researchQuestionsTable).where(eq(researchQuestionsTable.researchPlanId, existing[0].id));
    await db.delete(researchPlansTable).where(eq(researchPlansTable.id, existing[0].id));
  }

  const [plan] = await db.insert(researchPlansTable).values({
    id: randomUUID(), projectId,
    summary: parsed.summary, timeframeStart: parsed.timeframeStart, timeframeEnd: parsed.timeframeEnd,
    geographicBoundaries: parsed.geographicBoundaries, sourceCategories: parsed.sourceCategories,
    potentialConflicts: parsed.potentialConflicts, missingInformation: parsed.missingInformation,
    status: "draft",
  }).returning();

  if (parsed.questions?.length) {
    await db.insert(researchQuestionsTable).values(
      parsed.questions.slice(0, 10).map((q: any, i: number) => ({
        id: randomUUID(), researchPlanId: plan.id,
        question: q.question ?? String(q), priority: q.priority ?? i + 1, status: "pending",
      }))
    );
  }

  await db.update(projectsTable).set({ workflowStage: "sources" }).where(eq(projectsTable.id, projectId));
  await logActivity("research_plan_generated", `Research plan generated for "${project.title}"`, projectId, project.title, brand?.name);
  if (project.userId) {
    await emitEvent({
      type: "project.workflow_stage_changed", userId: project.userId, brandId: project.brandId, projectId,
      data: { projectId, projectTitle: project.title, fromStage: project.workflowStage, toStage: "sources" },
    });
  }
  return plan;
}

export async function generateOutline(projectId: string, additionalContext?: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);
  const sources = await db.select().from(sourcesTable).where(eq(sourcesTable.projectId, projectId));
  const claims = await db.select().from(claimsTable).where(eq(claimsTable.projectId, projectId));

  const sourcesSummary = sources.filter(s => s.status === "approved").slice(0, 5)
    .map(s => `- ${s.title}: ${s.relevantExcerpts?.slice(0, 200) ?? ""}`).join("\n");
  const claimsSummary = claims.slice(0, 10).map(c => `- ${c.claimText} [${c.verificationStatus}]`).join("\n");
  const brainBlock = brand ? await getBrandBrainBlock(brand.id, `${project.title} ${project.topic ?? ""}`) : "";

  const messages: ChatMessage[] = [
    { role: "system", content: "You are a professional content strategist. Create logical, well-structured outlines for long-form content." },
    {
      role: "user",
      content: `Create a detailed outline for this ${project.contentType}.

Project: ${project.title}
Topic: ${project.topic ?? "Not specified"}
Target Length: ${project.targetLength ?? "2000-3000 words"}
Audience: ${project.intendedAudience ?? "General"}
Tone: ${project.tone ?? "Professional"}
Brand Voice: ${brand?.voiceDescription ?? "Professional"}
${brainBlock ? `${brainBlock}\n` : ""}${additionalContext ? `Additional Context: ${additionalContext}` : ""}

Approved Sources:\n${sourcesSummary || "None yet"}
Key Claims:\n${claimsSummary || "None yet"}

Return JSON:
{
  "sections": [
    { "title": "Section title", "purpose": "What this accomplishes", "questionsAnswered": "Questions answered", "targetWordCount": 400, "readerOutcome": "Reader takeaway", "examples": "Example types", "notes": "Special instructions", "sortOrder": 0 }
  ]
}
Include 5-10 sections.`,
    },
  ];

  const result = await generateForStage("outline", messages);
  await logGeneration({ projectId, pipelineStage: "outline", provider: result.provider, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: result.estimatedCostUsd, latencyMs: result.latencyMs, status: "completed" });

  let parsed: any;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch { parsed = { sections: [] }; }

  const existing = await db.select().from(outlinesTable).where(eq(outlinesTable.projectId, projectId)).limit(1);
  if (existing[0]) {
    await db.delete(outlineSectionsTable).where(eq(outlineSectionsTable.outlineId, existing[0].id));
    await db.delete(outlinesTable).where(eq(outlinesTable.id, existing[0].id));
  }

  const [outline] = await db.insert(outlinesTable).values({ id: randomUUID(), projectId, status: "draft" }).returning();

  if (parsed.sections?.length) {
    await db.insert(outlineSectionsTable).values(
      parsed.sections.slice(0, 20).map((s: any, i: number) => ({
        id: randomUUID(), outlineId: outline.id,
        title: s.title ?? `Section ${i + 1}`, purpose: s.purpose, questionsAnswered: s.questionsAnswered,
        targetWordCount: typeof s.targetWordCount === "number" ? s.targetWordCount : null,
        readerOutcome: s.readerOutcome, examples: s.examples, notes: s.notes,
        sortOrder: s.sortOrder ?? i, status: "draft",
      }))
    );
  }

  await db.update(projectsTable).set({ workflowStage: "outline" }).where(eq(projectsTable.id, projectId));
  await logActivity("outline_generated", `Outline generated for "${project.title}"`, projectId, project.title, brand?.name);
  if (project.userId) {
    await emitEvent({
      type: "project.workflow_stage_changed", userId: project.userId, brandId: project.brandId, projectId,
      data: { projectId, projectTitle: project.title, fromStage: project.workflowStage, toStage: "outline" },
    });
  }
  return outline;
}

export async function draftSection(sectionId: string) {
  const [section] = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.id, sectionId)).limit(1);
  if (!section) throw new Error("Section not found");
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, section.documentId)).limit(1);
  if (!doc) throw new Error("Document not found");
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, doc.projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);

  const approvedSources = await db.select().from(sourcesTable).where(eq(sourcesTable.projectId, project.id));
  const approvedClaims = await db.select().from(claimsTable).where(eq(claimsTable.projectId, project.id));
  const brandFacts = brand
    ? await db.select().from(brandFactsTable).where(eq(brandFactsTable.brandId, brand.id))
    : [];
  const brainBlock = brand ? await getBrandBrainBlock(brand.id, `${project.topic ?? project.title} ${section.title}`) : "";

  let outlineSectionContext = "";
  if (section.outlineSectionId) {
    const [os] = await db.select().from(outlineSectionsTable).where(eq(outlineSectionsTable.id, section.outlineSectionId)).limit(1);
    if (os) {
      outlineSectionContext = `Section Purpose: ${os.purpose ?? ""}\nQuestions to Answer: ${os.questionsAnswered ?? ""}\nReader Outcome: ${os.readerOutcome ?? ""}\nTarget Word Count: ${os.targetWordCount ?? 400}`;
    }
  }

  const allSections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, doc.id));
  const previousSections = allSections.filter(s => s.sortOrder < section.sortOrder && s.isApproved && s.content)
    .slice(-2).map(s => `[${s.title}]: ${s.content?.slice(0, 300)}...`).join("\n\n");

  const sourceContext = approvedSources.filter(s => s.status === "approved").slice(0, 5)
    .map(s => `Source: ${s.title}\n${s.relevantExcerpts?.slice(0, 400) ?? s.extractedText?.slice(0, 400) ?? ""}`).join("\n\n");

  const claimsContext = approvedClaims.filter(c => c.verificationStatus === "supported").slice(0, 8)
    .map(c => `- ${c.claimText}`).join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a professional writer creating high-quality, naturally written content. Write clearly, specifically, and in a way that serves the reader. Avoid formulaic phrases, excessive bullet lists, corporate filler, and repetition. Use evidence from provided sources. Maintain brand voice.

Brand: ${brand?.name ?? ""}
Voice: ${brand?.voiceDescription ?? "Professional, clear, and helpful"}
Tone: ${project.tone ?? "Professional"}
Reading Level: ${project.readingLevel ?? "General"}
Point of View: ${project.pointOfView ?? "Third person"}
Audience: ${project.intendedAudience ?? "General readers"}${brandFacts.filter(f => f.status === "active").length > 0 ? `\nEstablished brand facts (use accurately, never contradict):\n${brandFacts.filter(f => f.status === "active").map(f => `- ${f.claim}`).join("\n")}` : ""}${brand?.prohibitedVocabulary ? `\nProhibited vocabulary — never use any of these terms: ${brand.prohibitedVocabulary}` : ""}${brand?.complianceNotes ? `\nCompliance requirements — must follow: ${brand.complianceNotes}` : ""}${brainBlock ? `\n\n${brainBlock}` : ""}`,
    },
    {
      role: "user",
      content: `Write the "${section.title}" section for this ${project.contentType}.

Topic: ${project.topic ?? project.title}
${outlineSectionContext}
${previousSections ? `\nContext from previous sections:\n${previousSections}\n` : ""}
Research Sources:\n${sourceContext || "Use your general knowledge"}
Verified Claims:\n${claimsContext || "None specified"}
${project.wordsToAvoid ? `Words to avoid: ${project.wordsToAvoid}` : ""}
${project.subjectsToAvoid ? `Subjects to avoid: ${project.subjectsToAvoid}` : ""}

Write the section content only — no preamble, no meta-commentary.`,
    },
  ];

  const result = await generateForStage("writing", messages);
  await logGeneration({ projectId: project.id, documentSectionId: sectionId, pipelineStage: "writing", provider: result.provider, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: result.estimatedCostUsd, latencyMs: result.latencyMs, status: "completed" });

  if (section.content) {
    await db.insert(sectionRevisionsTable).values({ id: randomUUID(), documentSectionId: sectionId, content: section.content, revisionNumber: section.revisionCount, editType: "pre_draft", notes: "Saved before new draft" });
  }

  const wordCount = result.content.split(/\s+/).length;
  const [updated] = await db.update(documentSectionsTable).set({ content: result.content, wordCount, status: "drafted", revisionCount: section.revisionCount + 1 }).where(eq(documentSectionsTable.id, sectionId)).returning();

  const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, doc.id));
  await db.update(documentsTable).set({ wordCount: sections.reduce((sum, s) => sum + (s.wordCount ?? 0), 0) }).where(eq(documentsTable.id, doc.id));

  await logActivity("section_drafted", `Section "${section.title}" drafted`, project.id, project.title, brand?.name);
  return updated;
}

export async function editSection(sectionId: string, editType: string, instructions?: string) {
  const [section] = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.id, sectionId)).limit(1);
  if (!section) throw new Error("Section not found");
  if (section.isLocked) throw new Error("Section is locked and cannot be edited");
  if (!section.content) throw new Error("Section has no content to edit");

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, section.documentId)).limit(1);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, doc.projectId)).limit(1);
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);

  const editInstructions: Record<string, string> = {
    natural_tone: `Edit this section for natural, human writing. Fix: robotic introductions, repeated sentence openings, predictable paragraph structures, uniform sentence lengths, corporate filler phrases ("In today's world", "It is important to note", "delve into"), empty transitions, unnecessary restatements, fake enthusiasm, excessive bullet points. Preserve all facts and meaning. Return only the edited content.`,
    developmental: `Review for structure and logic. Ensure clear topic sentences, logical idea flow, evidence supports claims, no missing context. Return improved content only.`,
    continuity: `Check for consistency with the document. Ensure consistent terminology, no contradictions, tone matches document. Return corrected content only.`,
    proofread: `Proofread for grammar, spelling, punctuation, and formatting. Return corrected content only.`,
    shorten: `Shorten while preserving all key information. Remove redundancy, tighten sentences. Target 70% of current length. Return shortened content only.`,
    expand: `Expand with more specific detail, examples, and explanation. Do not add unsupported claims. Return expanded content only.`,
    simplify: `Simplify language for general audience without losing accuracy. Use shorter sentences and clearer vocabulary. Return simplified content only.`,
  };

  const instruction = editInstructions[editType] ?? instructions ?? "Improve the writing quality of this section.";

  const messages: ChatMessage[] = [
    { role: "system", content: `You are a professional editor. ${brand ? `Brand voice: ${brand.voiceDescription ?? "Professional"}` : ""}` },
    { role: "user", content: `${instruction}${instructions ? `\n\nAdditional instructions: ${instructions}` : ""}\n\nOriginal section:\n---\n${section.content}\n---` },
  ];

  const result = await generateForStage("editing", messages);
  await logGeneration({ projectId: project.id, documentSectionId: sectionId, pipelineStage: `editing_${editType}`, provider: result.provider, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: result.estimatedCostUsd, latencyMs: result.latencyMs, status: "completed" });

  await db.insert(sectionRevisionsTable).values({ id: randomUUID(), documentSectionId: sectionId, content: section.content, revisionNumber: section.revisionCount, editType: "pre_" + editType, notes: `Saved before ${editType} edit` });

  const wordCount = result.content.split(/\s+/).length;
  const [updated] = await db.update(documentSectionsTable).set({ content: result.content, wordCount, status: "editing", revisionCount: section.revisionCount + 1 }).where(eq(documentSectionsTable.id, sectionId)).returning();
  return updated;
}

export async function runQualityEvaluation(projectId: string) {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) throw new Error("Project not found");

  const docs = await db.select().from(documentsTable).where(eq(documentsTable.projectId, projectId));
  const document = docs[0];
  if (!document) throw new Error("No document found for this project");

  const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, document.id));
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1);
  const claims = await db.select().from(claimsTable).where(eq(claimsTable.projectId, projectId));
  const brainBlock = brand ? await getBrandBrainBlock(brand.id, `${project.title} ${project.topic ?? ""}`) : "";

  const contentSample = sections.sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 5)
    .map(s => `## ${s.title}\n${s.content?.slice(0, 600) ?? "[No content yet]"}`).join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: "You are a professional content quality evaluator. Provide honest, specific quality assessments." },
    {
      role: "user",
      content: `Evaluate this ${project.contentType} for publication readiness.

Title: ${project.title}
Audience: ${project.intendedAudience ?? "General"}
Brand: ${brand?.name ?? "Unknown"}
Brand Voice: ${brand?.voiceDescription ?? "Professional"}
${brainBlock ? `${brainBlock}\n` : ""}Sections with Content: ${sections.filter(s => s.content).length}/${sections.length}
Approved Claims: ${claims.filter(c => c.verificationStatus === "supported").length}
Unsupported Claims: ${claims.filter(c => c.verificationStatus === "unsupported").length}

Content Sample:\n${contentSample}

Return JSON:
{
  "accuracyScore": 0-100, "citationScore": 0-100, "sourceQualityScore": 0-100,
  "coverageScore": 0-100, "coherenceScore": 0-100, "continuityScore": 0-100,
  "naturalnessScore": 0-100, "usefulnessScore": 0-100, "audienceFitScore": 0-100,
  "brandFitScore": 0-100, "readabilityScore": 0-100, "repetitionScore": 0-100,
  "overallPass": true/false, "isPublicationReady": true/false,
  "summary": "Overall assessment",
  "issues": [{ "category": "naturalness|citations|accuracy|coherence|coverage|readability", "severity": "critical|warning|info", "description": "Issue", "suggestedFix": "Fix" }]
}`,
    },
  ];

  const result = await generateForStage("evaluation", messages);
  await logGeneration({ projectId, pipelineStage: "quality_evaluation", provider: result.provider, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: result.estimatedCostUsd, latencyMs: result.latencyMs, status: "completed" });

  let parsed: any;
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch { parsed = { overallPass: false, isPublicationReady: false, summary: result.content, issues: [] }; }

  const [evaluation] = await db.insert(qualityEvaluationsTable).values({
    id: randomUUID(), projectId, documentId: document.id,
    accuracyScore: parsed.accuracyScore, citationScore: parsed.citationScore, sourceQualityScore: parsed.sourceQualityScore,
    coverageScore: parsed.coverageScore, coherenceScore: parsed.coherenceScore, continuityScore: parsed.continuityScore,
    naturalnessScore: parsed.naturalnessScore, usefulnessScore: parsed.usefulnessScore, audienceFitScore: parsed.audienceFitScore,
    brandFitScore: parsed.brandFitScore, readabilityScore: parsed.readabilityScore, repetitionScore: parsed.repetitionScore,
    overallPass: parsed.overallPass ?? false, isPublicationReady: parsed.isPublicationReady ?? false, summary: parsed.summary,
  }).returning();

  if (parsed.issues?.length) {
    await db.insert(qualityIssuesTable).values(
      parsed.issues.slice(0, 20).map((issue: any) => ({
        id: randomUUID(), evaluationId: evaluation.id, category: issue.category ?? "general",
        severity: issue.severity ?? "warning", description: issue.description ?? "", suggestedFix: issue.suggestedFix, status: "open",
      }))
    );
  }

  if (parsed.isPublicationReady) {
    await db.update(documentsTable).set({ isPublicationReady: true }).where(eq(documentsTable.id, document.id));
  }

  await db.update(projectsTable).set({ workflowStage: "quality" }).where(eq(projectsTable.id, projectId));
  await logActivity("quality_evaluated", `Quality evaluation completed for "${project.title}"`, projectId, project.title, brand?.name);
  if (project.userId) {
    await emitEvent({
      type: "project.workflow_stage_changed", userId: project.userId, brandId: project.brandId, projectId,
      data: { projectId, projectTitle: project.title, fromStage: project.workflowStage, toStage: "quality" },
    });
    await emitEvent({
      type: "document.quality_evaluated", userId: project.userId, brandId: project.brandId, projectId,
      data: {
        projectId, documentId: document.id, evaluationId: evaluation.id,
        overallPass: evaluation.overallPass, isPublicationReady: evaluation.isPublicationReady,
        summary: evaluation.summary,
      },
    });
  }
  return evaluation;
}

export async function verifyClaim(claimId: string) {
  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId)).limit(1);
  if (!claim) throw new Error("Claim not found");

  let sourceContext = "";
  if (claim.sourceId) {
    const [source] = await db.select().from(sourcesTable).where(eq(sourcesTable.id, claim.sourceId)).limit(1);
    if (source) sourceContext = `Supporting Source: ${source.title}\nExcerpt: ${source.relevantExcerpts ?? source.extractedText?.slice(0, 500) ?? "No excerpt"}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: "You are a fact-checker. Evaluate whether a claim is supported by its source." },
    { role: "user", content: `Verify this claim:\nClaim: ${claim.claimText}\nType: ${claim.claimType}\n${sourceContext}\n\nReturn JSON: { "verificationStatus": "supported|weakly_supported|unsupported|conflicting|outdated", "confidence": 0.0-1.0, "notes": "brief explanation" }` },
  ];

  const result = await generateForStage("verification", messages);

  let parsed: any = {};
  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.content);
  } catch {}

  const [updated] = await db.update(claimsTable).set({
    verificationStatus: parsed.verificationStatus ?? "weakly_supported",
    confidence: parsed.confidence ?? 0.5,
    reviewerNotes: parsed.notes,
  }).where(eq(claimsTable.id, claimId)).returning();

  return updated;
}
