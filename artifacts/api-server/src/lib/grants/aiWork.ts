import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  grantApplicantsTable,
  grantApplicationsTable,
  grantApprovalsTable,
  grantFactsTable,
  grantOpportunitiesTable,
  grantRequirementsTable,
  grantSectionsTable,
  grantSnippetsTable,
  type GrantApplicant,
  type GrantApplication,
} from "@workspace/db";
import { APPLICANT_TYPES, type ApplicantType } from "./eligibility";
import { factLine, factsForSection } from "./facts";
import { htmlToText } from "./text";
import { draftSection, extractRequirements, reviewSection, type DraftContext } from "./ai";
import { PermanentJobError } from "../jobs/types";

/**
 * The AI work in Grant Studio: drafting and reviewing a section, and
 * extracting requirements from a notice. It runs as background jobs
 * (lib/jobs/definitions.ts), so a slow provider never holds a web request.
 * Each task re-checks that the record belongs to the job's workspace.
 */

/** Any edit after approval reopens the package for approval, until a submission is recorded: then the record stands. */
export async function invalidatePackage(applicationId: string): Promise<void> {
  const [app] = await db.select({ outcome: grantApplicationsTable.outcome }).from(grantApplicationsTable).where(eq(grantApplicationsTable.id, applicationId)).limit(1);
  if (app?.outcome) return;
  await db.delete(grantApprovalsTable).where(and(eq(grantApprovalsTable.applicationId, applicationId), eq(grantApprovalsTable.scope, "package")));
  await db.update(grantApplicationsTable).set({ status: "draft" }).where(and(eq(grantApplicationsTable.id, applicationId), inArray(grantApplicationsTable.status, ["approved", "exported"])));
}

async function ownedSection(sectionId: string, userId: string) {
  const [found] = await db
    .select({ section: grantSectionsTable, app: grantApplicationsTable, applicant: grantApplicantsTable })
    .from(grantSectionsTable)
    .innerJoin(grantApplicationsTable, eq(grantSectionsTable.applicationId, grantApplicationsTable.id))
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantSectionsTable.id, sectionId), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!found) throw new PermanentJobError("The section no longer exists.");
  return found;
}

export async function draftContext(sectionId: string, app: GrantApplication, applicant: GrantApplicant): Promise<DraftContext> {
  const [section] = await db.select().from(grantSectionsTable).where(eq(grantSectionsTable.id, sectionId)).limit(1);
  const [opp] = await db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, app.opportunityId)).limit(1);
  const reqs = await db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, app.id));
  const relevant = reqs.filter((r) => r.sectionKey === section.key || (r.kind === "criterion" && !r.sectionKey));
  const library = await db.select().from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id));
  // Up to two saved texts for the same section, newest first, as plain text (about 6,000 characters in all).
  const savedWriting = (await db.select().from(grantSnippetsTable).where(and(eq(grantSnippetsTable.applicantId, applicant.id), eq(grantSnippetsTable.sectionKey, section.key))).orderBy(desc(grantSnippetsTable.updatedAt)).limit(2))
    .map((w) => ({ title: w.title, text: htmlToText(w.content).slice(0, 3000) }));
  const facts = [
    applicant.annualBudget ? `Annual budget: $${applicant.annualBudget.toLocaleString("en-US")}` : null,
    applicant.ein ? `EIN on file: ${applicant.ein}` : null,
    app.requestedAmount ? `Amount requested: $${app.requestedAmount.toLocaleString("en-US")}` : null,
    ...factsForSection(library, section.key).map(factLine),
  ].filter((f): f is string => Boolean(f));
  return {
    applicant: {
      name: applicant.name,
      applicantTypeLabel: APPLICANT_TYPES[applicant.applicantType as ApplicantType]?.label ?? applicant.applicantType,
      mission: applicant.mission,
      serviceArea: applicant.serviceArea,
      state: applicant.state,
      focusAreas: applicant.focusAreas,
    },
    opportunity: { title: opp.title, agency: opp.agency, description: opp.description },
    section: { title: section.title, guidance: section.guidance, limitType: section.limitType, limitValue: section.limitValue, content: section.content },
    requirements: relevant.map((r) => ({ label: r.label, detail: r.detail, points: r.points })),
    facts,
    savedWriting,
  };
}

export interface AiResult extends Record<string, unknown> {
  demo: boolean;
  message: string | null;
}

/** Drafts (or improves) a section and saves it as a draft, clearing any approval and review. */
export async function runSectionDraft(sectionId: string, userId: string): Promise<AiResult & { provider: string }> {
  const { section, app, applicant } = await ownedSection(sectionId, userId);
  if (section.status === "approved") throw new PermanentJobError("The section was approved before the draft finished. Reopen it to draft again.");
  const outcome = await draftSection(await draftContext(section.id, app, applicant));
  await db
    .update(grantSectionsTable)
    .set({ content: outcome.value, demoContent: outcome.demo, status: "drafting", approvedBy: null, approvedAt: null, reviewScore: null, reviewNotes: [] })
    .where(eq(grantSectionsTable.id, section.id));
  await invalidatePackage(app.id);
  return { demo: outcome.demo, provider: outcome.provider, message: outcome.message ?? null };
}

/** Reviews a section against the notice's criteria and records the score and notes. */
export async function runSectionReview(sectionId: string, userId: string): Promise<AiResult & { score: number | null }> {
  const { section, app, applicant } = await ownedSection(sectionId, userId);
  const outcome = await reviewSection(await draftContext(section.id, app, applicant));
  await db.update(grantSectionsTable).set({ reviewScore: outcome.value.score, reviewNotes: outcome.value.notes }).where(eq(grantSectionsTable.id, section.id));
  return { demo: outcome.demo, message: outcome.message ?? null, score: outcome.value.score };
}

/** Extracts requirements from the application's stored notice text and adds them unconfirmed. */
export async function runRequirementsExtract(applicationId: string, userId: string): Promise<AiResult & { added: number }> {
  const [found] = await db
    .select({ app: grantApplicationsTable })
    .from(grantApplicationsTable)
    .innerJoin(grantApplicantsTable, eq(grantApplicationsTable.applicantId, grantApplicantsTable.id))
    .where(and(eq(grantApplicationsTable.id, applicationId), eq(grantApplicantsTable.userId, userId)))
    .limit(1);
  if (!found) throw new PermanentJobError("The application no longer exists.");
  const notice = found.app.noticeText;
  if (!notice || notice.length < 200) throw new PermanentJobError("The application has no notice text to read.");
  const outcome = await extractRequirements(notice);
  if (outcome.value.length) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${grantRequirementsTable.position}), 0)` }).from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, applicationId));
    await db.insert(grantRequirementsTable).values(outcome.value.map((r, i) => ({
      id: randomUUID(),
      applicationId,
      kind: r.kind,
      label: r.label,
      detail: r.detail,
      sourceRef: r.sourceRef,
      points: r.points,
      origin: "extracted",
      confirmed: false,
      position: Number(max) + 1 + i,
    })));
    await invalidatePackage(applicationId);
  }
  return { demo: outcome.demo, message: outcome.message ?? null, added: outcome.value.length };
}
