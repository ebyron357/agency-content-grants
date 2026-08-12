import { db } from "@workspace/db";
import {
  projectsTable,
  brandsTable,
  brandFactsTable,
  brandKnowledgeEntriesTable,
  documentsTable,
  documentSectionsTable,
  repurposingBatchesTable,
  repurposedAssetsTable,
  repurposedAssetRevisionsTable,
  generationRunsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { generateForStage } from "../ai/router";
import { getBrandBrainBlock, validateDeterministic, overallScore } from "../brand-brain";
import { buildRepurposePrompt, isValidChannel, REPURPOSE_CHANNELS } from "../repurposing";
import { logActivity as logActivityEvent } from "../activity";
import { emitEvent } from "../webhooks/events";

async function logActivity(type: string, description: string, projectId: string, projectTitle?: string, brandName?: string) {
  await logActivityEvent(type, description, { projectId, projectTitle, brandName })
    .catch((e: unknown) => console.warn("[activity] log failed:", (e as Error).message));
}

/** Resolve the source text (and title) a batch/asset should be generated from. */
async function resolveSource(documentId: string, documentSectionId?: string | null) {
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
  if (!doc) throw new Error("Document not found");

  if (documentSectionId) {
    const [section] = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.id, documentSectionId)).limit(1);
    if (!section) throw new Error("Document section not found");
    if (!section.content) throw new Error(`Section "${section.title}" has no content to repurpose yet`);
    return { title: `${doc.title} — ${section.title}`, content: section.content };
  }

  const sections = await db.select().from(documentSectionsTable).where(eq(documentSectionsTable.documentId, documentId));
  const approved = sections.filter((s) => s.content).sort((a, b) => a.sortOrder - b.sortOrder);
  if (approved.length === 0) throw new Error("Document has no drafted content to repurpose yet");
  return { title: doc.title, content: approved.map((s) => `## ${s.title}\n${s.content}`).join("\n\n") };
}

interface GenerateOneOptions {
  batchId: string;
  projectId: string;
  documentId: string;
  documentSectionId: string | null;
  channel: string;
  sourceTitle: string;
  sourceContent: string;
  brand: { name: string; voiceDescription: string | null; prohibitedVocabulary: string | null; complianceNotes: string | null } | null;
  brainBlock: string;
  tone?: string | null;
  audience?: string | null;
  cta?: string | null;
  targetLength?: string | null;
  additionalInstructions?: string | null;
  previousContent?: string | null;
}

async function generateOne(opts: GenerateOneOptions): Promise<{ content: string; brandCheckScore: number; brandCheckPassed: boolean }> {
  const messages = buildRepurposePrompt({
    channel: opts.channel,
    sourceTitle: opts.sourceTitle,
    sourceContent: opts.sourceContent,
    brandName: opts.brand?.name,
    brandVoice: opts.brand?.voiceDescription ?? undefined,
    tone: opts.tone,
    audience: opts.audience,
    cta: opts.cta,
    targetLength: opts.targetLength,
    additionalInstructions: opts.additionalInstructions,
    brainBlock: opts.brainBlock,
    prohibitedVocabulary: opts.brand?.prohibitedVocabulary,
    complianceNotes: opts.brand?.complianceNotes,
    previousContent: opts.previousContent,
  });

  const result = await generateForStage("writing", messages);

  await db.insert(generationRunsTable).values({
    id: randomUUID(),
    projectId: opts.projectId,
    documentSectionId: opts.documentSectionId ?? undefined,
    pipelineStage: `repurposing_${opts.channel}`,
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estimatedCostUsd: result.estimatedCostUsd,
    latencyMs: result.latencyMs,
    retryCount: 0,
    status: "completed",
  });

  let brandCheckScore = 100;
  let brandCheckPassed = true;
  if (opts.brand) {
    const brandRow = opts.brand as unknown as { id: string };
    const [facts, entries] = brandRow.id
      ? await Promise.all([
          db.select().from(brandFactsTable).where(eq(brandFactsTable.brandId, brandRow.id)),
          db.select().from(brandKnowledgeEntriesTable).where(eq(brandKnowledgeEntriesTable.brandId, brandRow.id)),
        ])
      : [[], []];
    const checks = validateDeterministic(opts.brand as any, facts, entries, result.content);
    brandCheckScore = overallScore(checks);
    brandCheckPassed = checks.every((c) => c.passed);
  }

  return { content: result.content, brandCheckScore, brandCheckPassed };
}

/**
 * Kick off a repurposing batch: generate one derivative asset per requested
 * channel. Best-effort per channel — one channel's failure does not abort
 * the others; the batch ends up "completed" (all succeeded), "partial"
 * (some failed) or "failed" (all failed).
 */
export async function runRepurposingBatch(batchId: string): Promise<void> {
  const [batch] = await db.select().from(repurposingBatchesTable).where(eq(repurposingBatchesTable.id, batchId)).limit(1);
  if (!batch) throw new Error("Batch not found");

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, batch.projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const [brand] = project.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1) : [];

  let source: { title: string; content: string };
  try {
    source = await resolveSource(batch.documentId, batch.documentSectionId);
  } catch (err) {
    await db.update(repurposingBatchesTable).set({ status: "failed", errorMessage: (err as Error).message }).where(eq(repurposingBatchesTable.id, batchId));
    return;
  }

  const brainBlock = brand ? await getBrandBrainBlock(brand.id, `${project.title} ${project.topic ?? ""}`) : "";
  const channels = (batch.channels as unknown as string[]).filter(isValidChannel);

  let succeeded = 0;
  let failed = 0;

  for (const channel of channels) {
    const assetId = randomUUID();
    try {
      const { content, brandCheckScore, brandCheckPassed } = await generateOne({
        batchId,
        projectId: batch.projectId,
        documentId: batch.documentId,
        documentSectionId: batch.documentSectionId,
        channel,
        sourceTitle: source.title,
        sourceContent: source.content,
        brand: brand ?? null,
        brainBlock,
        tone: batch.tone,
        audience: batch.audience,
        cta: batch.cta,
        targetLength: batch.targetLength,
        additionalInstructions: batch.additionalInstructions,
      });

      await db.insert(repurposedAssetsTable).values({
        id: assetId,
        projectId: batch.projectId,
        batchId,
        documentId: batch.documentId,
        documentSectionId: batch.documentSectionId,
        channel,
        title: `${REPURPOSE_CHANNELS[channel]?.label ?? channel} — ${source.title}`,
        content,
        tone: batch.tone,
        audience: batch.audience,
        cta: batch.cta,
        targetLength: batch.targetLength,
        status: "draft",
        isApproved: false,
        versionNumber: 1,
        brandCheckScore,
        brandCheckPassed,
      });
      succeeded++;
    } catch (err) {
      await db.insert(repurposedAssetsTable).values({
        id: assetId,
        projectId: batch.projectId,
        batchId,
        documentId: batch.documentId,
        documentSectionId: batch.documentSectionId,
        channel,
        content: "",
        status: "draft",
        isApproved: false,
        versionNumber: 1,
        errorMessage: (err as Error).message,
      });
      failed++;
    }
  }

  const status = failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial";
  await db.update(repurposingBatchesTable).set({ status }).where(eq(repurposingBatchesTable.id, batchId));
  await logActivity(
    "repurposing_batch_completed",
    `Repurposing batch generated ${succeeded}/${channels.length} derivative asset(s) for "${project.title}"`,
    project.id,
    project.title,
    brand?.name,
  );
  if (project.userId) {
    await emitEvent({
      type: "repurposing.batch_completed", userId: project.userId, brandId: project.brandId, projectId: project.id,
      data: { batchId, projectId: project.id, status, channels, succeeded, failed },
    });
  }
}

/**
 * Regenerate a single derivative asset. The existing content (and its
 * approval state) is preserved in the revisions table before being replaced,
 * and the asset is reset to unapproved draft status — an approved version is
 * never silently overwritten in place.
 */
export async function regenerateRepurposedAsset(assetId: string): Promise<void> {
  const [asset] = await db.select().from(repurposedAssetsTable).where(eq(repurposedAssetsTable.id, assetId)).limit(1);
  if (!asset) throw new Error("Asset not found");

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, asset.projectId)).limit(1);
  if (!project) throw new Error("Project not found");
  const [brand] = project.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, project.brandId)).limit(1) : [];
  const [batch] = await db.select().from(repurposingBatchesTable).where(eq(repurposingBatchesTable.id, asset.batchId)).limit(1);

  const source = await resolveSource(asset.documentId, asset.documentSectionId);
  const brainBlock = brand ? await getBrandBrainBlock(brand.id, `${project.title} ${project.topic ?? ""}`) : "";

  const { content, brandCheckScore, brandCheckPassed } = await generateOne({
    batchId: asset.batchId,
    projectId: asset.projectId,
    documentId: asset.documentId,
    documentSectionId: asset.documentSectionId,
    channel: asset.channel,
    sourceTitle: source.title,
    sourceContent: source.content,
    brand: brand ?? null,
    brainBlock,
    tone: asset.tone ?? batch?.tone,
    audience: asset.audience ?? batch?.audience,
    cta: asset.cta ?? batch?.cta,
    targetLength: asset.targetLength ?? batch?.targetLength,
    additionalInstructions: batch?.additionalInstructions,
    previousContent: asset.content || undefined,
  });

  if (asset.content) {
    await db.insert(repurposedAssetRevisionsTable).values({
      id: randomUUID(),
      repurposedAssetId: asset.id,
      title: asset.title,
      content: asset.content,
      versionNumber: asset.versionNumber,
      wasApproved: asset.isApproved,
      editType: "regenerate",
      notes: "Saved before regeneration",
    });
  }

  await db.update(repurposedAssetsTable).set({
    content,
    status: "draft",
    isApproved: false,
    versionNumber: asset.versionNumber + 1,
    brandCheckScore,
    brandCheckPassed,
    errorMessage: null,
  }).where(eq(repurposedAssetsTable.id, asset.id));
}
