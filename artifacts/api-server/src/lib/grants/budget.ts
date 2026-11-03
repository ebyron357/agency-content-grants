import { BUDGET_CATEGORIES, type BudgetCategory } from "./eligibility";

/**
 * Budget arithmetic in SF-424A object-class categories.
 *
 * Indirect costs are computed on the total direct cost. Many federal rate
 * agreements use a modified total direct cost base that excludes some items
 * (for example equipment); the applicant must check the base their agreement or
 * the notice requires. That limitation is shown in the UI next to the indirect line.
 */

export interface BudgetLineInput {
  id?: string;
  category: string;
  description: string;
  quantity: number;
  unitCost: number;
  matchPercent: number;
  justification: string | null;
}

export interface CategoryTotal {
  category: BudgetCategory;
  label: string;
  total: number;
  requested: number;
  match: number;
}

export interface BudgetSummary {
  categories: CategoryTotal[];
  directTotal: number;
  indirectRatePercent: number;
  indirect: number;
  total: number;
  requested: number;
  match: number;
  issues: string[];
}

const round = (value: number) => Math.round(value * 100) / 100;

export function lineTotal(line: Pick<BudgetLineInput, "quantity" | "unitCost">): number {
  return round(Math.max(0, line.quantity) * Math.max(0, line.unitCost));
}

export function summarizeBudget(
  lines: BudgetLineInput[],
  indirectRatePercent: number,
  awardCeiling: number | null,
): BudgetSummary {
  const issues: string[] = [];
  const categories: CategoryTotal[] = (Object.keys(BUDGET_CATEGORIES) as BudgetCategory[]).map((category) => ({
    category,
    label: BUDGET_CATEGORIES[category],
    total: 0,
    requested: 0,
    match: 0,
  }));
  const byCategory = new Map(categories.map((c) => [c.category, c]));

  for (const line of lines) {
    const entry = byCategory.get(line.category as BudgetCategory);
    if (!entry) {
      issues.push(`"${line.description}" has an unknown category.`);
      continue;
    }
    const total = lineTotal(line);
    const share = Math.min(100, Math.max(0, line.matchPercent)) / 100;
    entry.total = round(entry.total + total);
    entry.match = round(entry.match + total * share);
    entry.requested = round(entry.requested + total * (1 - share));
    if (!line.justification?.trim()) issues.push(`"${line.description}" needs a justification.`);
    if (total <= 0) issues.push(`"${line.description}" has no cost.`);
  }

  const directTotal = round(categories.reduce((sum, c) => sum + c.total, 0));
  const directRequested = round(categories.reduce((sum, c) => sum + c.requested, 0));
  const match = round(categories.reduce((sum, c) => sum + c.match, 0));
  const rate = Math.max(0, indirectRatePercent);
  const indirect = round(directRequested * (rate / 100));
  const requested = round(directRequested + indirect);
  const total = round(directTotal + indirect);

  if (lines.length === 0) issues.push("Add at least one budget line.");
  if (awardCeiling && requested > awardCeiling) {
    issues.push(`The request ($${requested.toLocaleString("en-US")}) is above the award ceiling ($${awardCeiling.toLocaleString("en-US")}).`);
  }

  return { categories, directTotal, indirectRatePercent: rate, indirect, total, requested, match, issues };
}
