/**
 * Scopes an API key can be granted. A session-authenticated human always has
 * full access regardless of scopes — these only gate what a *bearer-token*
 * caller (an external automation tool) may do. Keep this list narrow and
 * additive: a new automation action gets its own scope rather than being
 * folded into an existing one, so a key minted for one workflow can't reach
 * into another without the user explicitly re-granting it.
 */
export const AUTOMATION_SCOPES = [
  "read", // read-only status lookups (GET /automation/*)
  "projects:write", // create projects
  "repurposing:write", // request repurposing batches
  "publishing:write", // schedule publications
] as const;

export type AutomationScope = (typeof AUTOMATION_SCOPES)[number];

export function isValidScope(value: unknown): value is AutomationScope {
  return typeof value === "string" && (AUTOMATION_SCOPES as readonly string[]).includes(value);
}
