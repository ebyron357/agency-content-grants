/**
 * Per-role permissions (docs/SECURITY_AND_ACCESS_HANDOFF.md §2).
 *
 * Three tables, all data: what each permission means, which roles hold which
 * permissions, and which permission each API route needs. The middleware
 * reads them on every request; `permissions.coverage.test.ts` walks every
 * route the router registers and fails if one is not classified here, so a
 * new route cannot ship without a decision about who may call it.
 *
 * Pure module: no database import, so it is safe in unit tests and the UI
 * contract test.
 */

export const ROLES = {
  owner: { label: "Owner", description: "Everything, including members, roles and the workspace itself." },
  admin: { label: "Admin", description: "Everything except removing owners." },
  writer: { label: "Writer", description: "Creates and edits content and applications, including budgets. Cannot approve sections or packages." },
  reviewer: { label: "Reviewer", description: "Reads everything; reviews, approves and reopens sections." },
  representative: { label: "Authorized representative", description: "Reads everything; approves sections and the final package, records submissions and outcomes." },
  finance: { label: "Finance", description: "Reads everything; edits budgets and records award amounts." },
  viewer: { label: "Viewer", description: "Read only." },
} as const;

export const PERMISSIONS = {
  "workspace.read": "See the workspace's data",
  "content.write": "Create and edit brands, projects, research, documents, media and exports",
  "content.publish": "Connect publishing destinations and schedule publications",
  "grants.write": "Edit organizations, facts, applications, requirements and drafts",
  "grants.review": "Review, approve and reopen application sections",
  "grants.approve": "Approve the final package and record submissions and outcomes",
  "grants.finance": "Edit budgets, budget justification and award amounts",
  "automation.manage": "Create API keys and webhooks",
  "members.manage": "Invite people, change roles and remove members",
  "workspace.configure": "Change AI providers, models, blueprints and dependencies",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

/** Which permissions each role holds. Owners and admins hold everything; the route handlers keep the owner-only rules for members. */
export const ROLE_PERMISSIONS: Record<keyof typeof ROLES, readonly Permission[]> = {
  owner: ALL,
  admin: ALL,
  writer: ["workspace.read", "content.write", "content.publish", "grants.write", "grants.finance"],
  reviewer: ["workspace.read", "grants.review"],
  representative: ["workspace.read", "grants.review", "grants.approve"],
  finance: ["workspace.read", "grants.finance"],
  viewer: ["workspace.read"],
};

export function permissionsOf(role: string | null | undefined): readonly Permission[] {
  return (role && (ROLE_PERMISSIONS as Record<string, readonly Permission[]>)[role]) || [];
}

export function hasPermission(role: string | null | undefined, needed: Permission | readonly Permission[]): boolean {
  const held = permissionsOf(role);
  const anyOf = typeof needed === "string" ? [needed] : needed;
  return anyOf.some((p) => held.includes(p));
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "*";

export interface RouteRule {
  /** HTTP method, or "*" for every method. */
  method: Method;
  /** Express-style path: literal segments, `:param` for one segment, a trailing `/*` for any deeper path. */
  path: string;
  /** Any one of these permissions is enough. */
  needs: Permission | readonly Permission[];
}

/** Rules for every method that changes data at `path`; reads stay on the default. */
function writes(path: string, needs: Permission | readonly Permission[]): RouteRule[] {
  return (["POST", "PUT", "PATCH", "DELETE"] as const).map((method) => ({ method, path, needs }));
}

/**
 * First matching rule wins, so specific rules come before the broad ones.
 * Reads (GET) that are not listed need `workspace.read`. A write that matches
 * no rule needs `workspace.configure`, which only owners and admins hold, so
 * an unclassified route fails closed; the coverage test keeps that list empty.
 */
export const ROUTE_RULES: readonly RouteRule[] = [
  // Grant Studio: the separation of duties the plan calls for.
  // Writers check their own drafts; reviewers run the same check before approving.
  { method: "POST", path: "/grants/sections/:sid/review", needs: ["grants.write", "grants.review"] },
  { method: "POST", path: "/grants/sections/:sid/approve", needs: "grants.review" },
  { method: "POST", path: "/grants/sections/:sid/reopen", needs: "grants.review" },
  { method: "POST", path: "/grants/applications/:id/approve-package", needs: "grants.approve" },
  ...writes("/grants/applications/:id/outcome", ["grants.approve", "grants.finance"]),
  ...writes("/grants/applications/:id/budget-lines", "grants.finance"),
  ...writes("/grants/applications/:id/budget-justification", "grants.finance"),
  ...writes("/grants/budget-lines/:lid", "grants.finance"),
  { method: "POST", path: "/grants/applicants/:id/matches/seen", needs: "workspace.read" },
  ...writes("/grants/*", "grants.write"),

  // Publishing and scheduling.
  ...writes("/brands/:id/publishing-destinations", "content.publish"),
  ...writes("/publishing-destinations/*", "content.publish"),
  ...writes("/scheduled-publications", "content.publish"),
  ...writes("/scheduled-publications/*", "content.publish"),
  { method: "POST", path: "/automation/scheduled-publications", needs: "content.publish" },

  // Automation credentials are readable only by the people who can manage them.
  { method: "*", path: "/api-keys", needs: "automation.manage" },
  { method: "*", path: "/api-keys/*", needs: "automation.manage" },
  { method: "*", path: "/webhooks/*", needs: "automation.manage" },

  // Background jobs: retry and cancel (the handlers also require an admin unlock).
  ...writes("/jobs/*", "workspace.configure"),

  // Workspace configuration (the handlers also require an admin unlock).
  { method: "POST", path: "/providers", needs: "workspace.configure" },
  { method: "POST", path: "/providers/*", needs: "workspace.configure" },
  { method: "PATCH", path: "/model-config", needs: "workspace.configure" },
  ...writes("/blueprints", "workspace.configure"),
  ...writes("/blueprints/*", "workspace.configure"),
  { method: "PATCH", path: "/dependencies/*", needs: "workspace.configure" },

  // A person's own account and security: every role manages its own.
  ...writes("/account/*", "workspace.read"),

  // The audit log is for the people who manage the workspace.
  { method: "GET", path: "/workspace/audit", needs: "members.manage" },
  { method: "GET", path: "/workspace/audit.csv", needs: "members.manage" },

  // Members and workspaces (the handlers keep the owner-only and last-owner rules).
  { method: "PATCH", path: "/workspace", needs: "members.manage" },
  ...writes("/workspace/*", "members.manage"),
  { method: "POST", path: "/workspaces", needs: "members.manage" },

  // Content: everything else that writes.
  ...writes("/brands", "content.write"),
  ...writes("/projects", "content.write"),
  ...writes("/automation/projects", "content.write"),
  ...[
    "/brands", "/audience-profiles", "/brand-facts", "/brain-entries", "/projects", "/research-plans", "/sources", "/claims",
    "/outlines", "/outline-sections", "/document-sections", "/repurposing-presets", "/repurposed-assets", "/quality-evaluations",
    "/media", "/performance", "/automation/projects",
  ].flatMap((root) => writes(`${root}/*`, "content.write")),
];

const compiled = ROUTE_RULES.map((rule) => ({ rule, re: compile(rule.path) }));

function compile(path: string): RegExp {
  const deep = path.endsWith("/*");
  const body = (deep ? path.slice(0, -2) : path)
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}${deep ? "/.+" : ""}/?$`);
}

export interface Requirement {
  needs: Permission | readonly Permission[];
  rule: RouteRule | null;
}

/** The permission a request needs. `rule` is null when the default applied. */
export function requirementFor(method: string, path: string): Requirement {
  const m = method.toUpperCase();
  for (const { rule, re } of compiled) {
    if ((rule.method === "*" || rule.method === m || (rule.method === "GET" && m === "HEAD")) && re.test(path)) return { needs: rule.needs, rule };
  }
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return { needs: "workspace.read", rule: null };
  return { needs: "workspace.configure", rule: null };
}

/** The roles that hold a requirement, for error messages and the UI. */
export function rolesWith(needs: Permission | readonly Permission[]): string[] {
  return Object.keys(ROLE_PERMISSIONS).filter((role) => hasPermission(role, needs));
}
