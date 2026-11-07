import { createHash, randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  grantBudgetLinesTable,
  grantClaimFlagsTable,
  grantFactsTable,
  grantFederalFormsTable,
  grantOpportunitiesTable,
  grantRequirementsTable,
  grantSectionsTable,
  grantSupportLettersTable,
  type GrantApplicant,
  type GrantApplication,
  type GrantClaimFlag,
  type GrantSection,
} from "@workspace/db";
import { generateForStage } from "../ai/router";
import { parseJsonBlock } from "./aiJson";
import { lineTotal, summarizeBudget } from "./budget";
import { CLAIM_RULES_VERSION, acceptAiClaims, checkClaims, type ClaimFinding, type SupportSource } from "./claims";
import { placeStatements, type PlaceDesignations } from "./places";
import { htmlToText } from "./text";

/**
 * Runs the unsupported-claim check against an application's own records and
 * keeps its flags (grant_claim_flags). Every source comes from the same
 * application and its organization, reached through the workspace that owns
 * them; nothing from another workspace is ever read.
 */

export interface ClaimContext {
  sources: SupportSource[];
  ownNames: string[];
  confirmedFactIds: Set<string>;
  signature: string;
}

export async function claimContext(app: GrantApplication, applicant: GrantApplicant): Promise<ClaimContext> {
  const [facts, lines, letters, requirements, forms, [opp]] = await Promise.all([
    db.select().from(grantFactsTable).where(eq(grantFactsTable.applicantId, applicant.id)),
    db.select().from(grantBudgetLinesTable).where(eq(grantBudgetLinesTable.applicationId, app.id)),
    db.select().from(grantSupportLettersTable).where(eq(grantSupportLettersTable.applicationId, app.id)),
    db.select().from(grantRequirementsTable).where(eq(grantRequirementsTable.applicationId, app.id)),
    db.select().from(grantFederalFormsTable).where(and(eq(grantFederalFormsTable.applicationId, app.id), eq(grantFederalFormsTable.formKey, "sf424"))),
    db.select().from(grantOpportunitiesTable).where(eq(grantOpportunitiesTable.id, app.opportunityId)).limit(1),
  ]);
  const confirmed = facts.filter((f) => f.confirmedAt);
  const budget = summarizeBudget(lines, app.indirectRatePercent, opp?.awardCeiling ?? null);
  const sources: SupportSource[] = confirmed.map((f) => ({
    kind: "fact",
    label: `Confirmed fact: ${f.label}`,
    factId: f.id,
    text: [f.label, f.body, f.source ?? "", f.asOf ? `as of ${f.asOf}` : ""].join(" "),
  }));
  sources.push({
    kind: "budget",
    label: "This application's budget",
    text: lines.map((l) => `${l.description} ${l.justification ?? ""}`).join(" "),
    numbers: [
      budget.requested, budget.match, budget.total, budget.directTotal, budget.indirect, budget.indirectRatePercent,
      budget.directTotal - budget.match,
      ...budget.categories.flatMap((c) => [c.total, c.requested, c.match]),
      ...lines.flatMap((l) => [l.quantity, l.unitCost, lineTotal(l), l.matchPercent]),
      ...(app.requestedAmount != null ? [app.requestedAmount] : []),
    ].filter((n) => Number.isFinite(n) && n > 0),
  });
  if (opp) {
    sources.push({
      kind: "opportunity",
      label: "The opportunity's official record",
      text: [opp.title, opp.number ?? "", opp.agency ?? "", opp.openDate ?? "", opp.closeDate ?? "", opp.eligibilityText ?? ""].join(" "),
      numbers: [opp.awardCeiling, opp.awardFloor, opp.estimatedFunding, opp.costSharePercent].filter((n): n is number => typeof n === "number" && n > 0),
    });
  }
  sources.push({
    kind: "profile",
    label: "The organization profile",
    text: [applicant.name, applicant.serviceArea ?? "", applicant.mission ?? ""].join(" "),
    numbers: [applicant.annualBudget, applicant.maxCostSharePercent].filter((n): n is number => typeof n === "number" && n > 0),
  });
  for (const l of letters.filter((x) => x.status === "received")) {
    sources.push({ kind: "letter", label: `Received letter of support: ${l.organization ?? l.name}`, text: [l.name, l.organization ?? "", l.purpose ?? ""].join(" ") });
  }
  for (const r of requirements.filter((x) => x.confirmed && !x.rejectedAt)) {
    sources.push({ kind: "requirement", label: `Confirmed requirement: ${r.label}`, text: [r.label, r.detail ?? "", r.quote ?? ""].join(" "), numbers: r.points ? [r.points] : [] });
  }
  for (const statement of placeStatements(applicant.placeDesignations as PlaceDesignations)) sources.push({ kind: "place", label: "A recorded place designation", text: statement });
  const sf424 = (forms[0]?.values ?? {}) as Record<string, unknown>;
  const projectDates = ["project_start_date", "project_end_date"].map((k) => sf424[k]).filter((v): v is string => typeof v === "string");
  if (projectDates.length) sources.push({ kind: "form", label: "SF-424 project dates", text: projectDates.join(" ") });
  const signature = createHash("sha256")
    .update(CLAIM_RULES_VERSION)
    .update(JSON.stringify(sources.map((s) => [s.kind, s.label, s.text, s.numbers ?? []])))
    .digest("hex");
  return { sources, ownNames: [applicant.name, opp?.agency ?? ""], confirmedFactIds: new Set(confirmed.map((f) => f.id)), signature };
}

const sectionHash = (section: Pick<GrantSection, "content">, ctx: ClaimContext) => createHash("sha256").update(section.content).update(ctx.signature).digest("hex");

const textHasClaim = (html: string, claim: string) => htmlToText(html).toLowerCase().replace(/\s+/g, " ").includes(claim.toLowerCase().replace(/\s+/g, " "));

/**
 * Brings one section's flags up to date with its text and the records:
 * new findings open a flag; a flag whose claim left the text, or is now
 * backed, is closed with that reason; a flag linked to a fact that is no
 * longer confirmed opens again. A dismissal stands while the claim is unchanged.
 */
async function syncSection(section: GrantSection, applicationId: string, ctx: ClaimContext): Promise<void> {
  const { findings } = checkClaims({ html: section.content, sources: ctx.sources, ownNames: ctx.ownNames });
  const existing = await db.select().from(grantClaimFlagsTable).where(eq(grantClaimFlagsTable.sectionId, section.id));
  const now = new Date();
  const rules = new Map(existing.filter((f) => f.detectedBy === "rules").map((f) => [f.fingerprint, f]));
  const found = new Set<string>();
  for (const finding of findings) {
    found.add(finding.fingerprint);
    const ex = rules.get(finding.fingerprint);
    if (!ex) {
      await db.insert(grantClaimFlagsTable).values({ id: randomUUID(), applicationId, sectionId: section.id, detectedBy: "rules", status: "open", ...finding }).onConflictDoNothing();
    } else if (ex.status === "resolved" && (ex.resolution === "edited" || ex.resolution === "now_supported")) {
      await db.update(grantClaimFlagsTable).set({ status: "open", resolution: null, resolvedBy: null, resolvedAt: null, reason: finding.reason }).where(eq(grantClaimFlagsTable.id, ex.id));
    }
  }
  for (const ex of existing) {
    if (ex.status === "resolved" && ex.resolution === "linked" && (!ex.factId || !ctx.confirmedFactIds.has(ex.factId))) {
      await db.update(grantClaimFlagsTable).set({ status: "open", resolution: null, resolvedBy: null, resolvedAt: null, factId: null, reason: `${ex.reason} The fact it was linked to is no longer confirmed.` }).where(eq(grantClaimFlagsTable.id, ex.id));
      continue;
    }
    if (ex.status !== "open") continue;
    const gone = !textHasClaim(section.content, ex.claim);
    if (ex.detectedBy === "rules" && !found.has(ex.fingerprint)) {
      await db.update(grantClaimFlagsTable).set({ status: "resolved", resolution: gone ? "edited" : "now_supported", resolvedBy: "Claim check", resolvedAt: now }).where(eq(grantClaimFlagsTable.id, ex.id));
    } else if (ex.detectedBy !== "rules" && gone) {
      await db.update(grantClaimFlagsTable).set({ status: "resolved", resolution: "edited", resolvedBy: "Claim check", resolvedAt: now }).where(eq(grantClaimFlagsTable.id, ex.id));
    }
  }
  await db.update(grantSectionsTable).set({ claimsCheckedHash: sectionHash(section, ctx), claimsCheckedAt: now }).where(eq(grantSectionsTable.id, section.id));
}

/** Re-checks every section whose text or records changed since its last check. Returns the application's flags. */
export async function syncClaimChecks(app: GrantApplication, applicant: GrantApplicant, sections: GrantSection[], opts: { force?: string[] } = {}): Promise<GrantClaimFlag[]> {
  const ctx = await claimContext(app, applicant);
  for (const section of sections) {
    if (opts.force?.includes(section.id) || section.claimsCheckedHash !== sectionHash(section, ctx)) await syncSection(section, app.id, ctx);
  }
  return db.select().from(grantClaimFlagsTable).where(eq(grantClaimFlagsTable.applicationId, app.id));
}

export async function openFlagsFor(sectionIds: string[]): Promise<GrantClaimFlag[]> {
  if (!sectionIds.length) return [];
  return db.select().from(grantClaimFlagsTable).where(and(inArray(grantClaimFlagsTable.sectionId, sectionIds), eq(grantClaimFlagsTable.status, "open")));
}

/**
 * The AI pass (only when an AI provider is configured): asks the model for
 * factual claims the sources do not back. Each one must quote the section
 * word for word; anything else is dropped. Returns null in demo mode.
 */
export async function runAiClaimCheck(section: GrantSection, applicationId: string, ctx: ClaimContext): Promise<{ provider: string; added: number; dropped: number } | null> {
  const text = htmlToText(section.content);
  if (!text.trim()) return null;
  const sources = ctx.sources.map((s) => `- ${s.label}: ${s.text.slice(0, 600)}${s.numbers?.length ? ` (figures: ${s.numbers.slice(0, 40).join(", ")})` : ""}`).join("\n").slice(0, 20_000);
  const result = await generateForStage("evaluation", [
    {
      role: "system",
      content:
        "You check grant application text for factual claims that are not supported. A claim is a number, a date, a stated result or outcome, a named partner organization, or a credential or recognition. A claim is supported only if one of the listed sources states it, or the sentence itself cites a source. Plans and targets (what the project will do) are not claims. Output JSON only.",
    },
    {
      role: "user",
      content: `Return a JSON array. Each item: {"quote": the exact words of the claim copied from the text, "kind": one of number|date|outcome|partner|credential, "reason": one short sentence}. List only unsupported claims. Return [] if there are none.\n\nSOURCES:\n${sources || "- (none)"}\n\nTEXT:\n${text.slice(0, 20_000)}`,
    },
  ], { maxTokens: 1500, temperature: 0 });
  if (result.provider === "demo") return null;
  const { accepted, dropped } = acceptAiClaims(section.content, parseJsonBlock(result.content));
  const detectedBy = `ai:${result.provider}`;
  const rules = await db.select({ claim: grantClaimFlagsTable.claim }).from(grantClaimFlagsTable).where(and(eq(grantClaimFlagsTable.sectionId, section.id), eq(grantClaimFlagsTable.detectedBy, "rules")));
  const known = new Set(rules.map((r) => r.claim.toLowerCase()));
  let added = 0;
  for (const finding of accepted as ClaimFinding[]) {
    if (known.has(finding.claim.toLowerCase())) continue;
    const rows = await db.insert(grantClaimFlagsTable).values({ id: randomUUID(), applicationId, sectionId: section.id, detectedBy, status: "open", ...finding }).onConflictDoNothing().returning({ id: grantClaimFlagsTable.id });
    added += rows.length;
  }
  await db.update(grantSectionsTable).set({ claimsAiCheckedAt: new Date(), claimsAiProvider: result.provider, claimsAiHash: createHash("sha256").update(section.content).digest("hex") }).where(eq(grantSectionsTable.id, section.id));
  return { provider: result.provider, added, dropped };
}

export function flagView(f: GrantClaimFlag) {
  return {
    id: f.id,
    sectionId: f.sectionId,
    kind: f.kind,
    claim: f.claim,
    sentence: f.sentence,
    reason: f.reason,
    detectedBy: f.detectedBy,
    method: f.detectedBy === "rules" ? "Rule check (no AI)" : `AI check (${f.detectedBy.slice(3)})`,
    status: f.status,
    resolution: f.resolution,
    factId: f.factId,
    dismissReason: f.dismissReason,
    resolvedBy: f.resolvedBy,
    resolvedAt: f.resolvedAt,
    createdAt: f.createdAt,
  };
}
