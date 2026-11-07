import { eq } from "drizzle-orm";
import { db, grantFederalFormsTable, type GrantApplicant, type GrantApplication, type GrantFederalForm, type GrantOpportunity } from "@workspace/db";
import type { BudgetSummary } from "../budget";
import { buildFormViews, type FormView, type FormsContext, type StoredForm } from "./engine";

/**
 * Reads an application's federal forms. Only federal opportunities have them:
 * a state program's forms are on its own portal. The application row was
 * already loaded through the workspace that owns it.
 */

export function formsContext(app: GrantApplication, applicant: GrantApplicant, opp: GrantOpportunity, budget: BudgetSummary, hasBudgetLines: boolean): FormsContext {
  return {
    applicant: { name: applicant.name, applicantType: applicant.applicantType, ein: applicant.ein, uei: applicant.uei, state: applicant.state },
    opportunity: { title: opp.title, number: opp.number, agency: opp.agency, assistanceListings: opp.assistanceListings ?? [] },
    application: { title: app.title },
    budget,
    hasBudgetLines,
  };
}

export const storedForm = (row: GrantFederalForm): StoredForm => ({
  formKey: row.formKey,
  values: row.values ?? {},
  notApplicable: row.notApplicable,
  notApplicableReason: row.notApplicableReason,
  notApplicableBy: row.notApplicableBy,
  reviewedBy: row.reviewedBy,
  reviewedAt: row.reviewedAt,
  reviewedHash: row.reviewedHash,
  updatedBy: row.updatedBy,
  updatedAt: row.updatedAt,
});

export async function loadFormViews(app: GrantApplication, ctx: FormsContext, federal: boolean): Promise<FormView[]> {
  if (!federal) return [];
  const rows = await db.select().from(grantFederalFormsTable).where(eq(grantFederalFormsTable.applicationId, app.id));
  return buildFormViews(ctx, rows.map(storedForm));
}
