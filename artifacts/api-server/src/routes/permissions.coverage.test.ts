/**
 * Every route the API registers is classified by lib/permissions.ts.
 *
 * Walks the real router, so a route added anywhere is checked without being
 * listed here: each write must match an explicit rule (an unmatched write
 * would fall back to owners and admins only), and each rule must match at
 * least one real route, so a typo cannot leave a route unprotected while the
 * rule looks right.
 */
import { describe, expect, it } from "vitest";
import { router } from "./index";
import { ROUTE_RULES, requirementFor } from "../lib/permissions";

/**
 * Routes reachable without a session, or handled entirely by their own checks.
 * `/watch-events/changedetection` is called by changedetection.io and checks a
 * shared secret itself (routes/watch-events.ts, tested in grant-sources.integration.test.ts).
 */
const PUBLIC = [/^\/auth\//, /^\/healthz$/, /^\/readyz$/, /^\/watch-events\/changedetection$/];

function registeredRoutes(): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) out.push({ method: method.toUpperCase(), path: String(layer.route.path) });
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((router as any).stack);
  return out;
}

const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, "x1");

describe("route permission coverage", () => {
  const routes = registeredRoutes().filter((r) => !PUBLIC.some((p) => p.test(r.path)));

  it("finds the application's routes", () => {
    expect(routes.length).toBeGreaterThan(180);
  });

  it("classifies every write explicitly", () => {
    const unclassified = routes.filter((r) => r.method !== "GET" && requirementFor(r.method, concrete(r.path)).rule === null);
    expect(unclassified).toEqual([]);
  });

  it("has no rule that matches no route", () => {
    const used = new Set<string>();
    for (const r of routes) {
      const { rule } = requirementFor(r.method, concrete(r.path));
      if (rule) used.add(`${rule.method} ${rule.path}`);
    }
    const unusedPaths = [...new Set(ROUTE_RULES.map((r) => r.path))].filter((p) => ![...used].some((u) => u.endsWith(` ${p}`)));
    expect(unusedPaths).toEqual([]);
  });

  it("keeps approvals with the roles that may approve", () => {
    const needs = (m: string, p: string) => requirementFor(m, concrete(p)).needs;
    expect(needs("POST", "/grants/sections/:sid/approve")).toBe("grants.review");
    expect(needs("POST", "/grants/applications/:id/approve-package")).toBe("grants.approve");
    expect(needs("POST", "/grants/sections/:sid/draft")).toBe("grants.write");
  });

  it("keeps the source registry, reads included, with owners and admins", () => {
    for (const [m, p] of [["GET", "/grant-sources"], ["GET", "/grant-sources/:id"], ["POST", "/grant-sources"], ["PATCH", "/grant-sources/:id"], ["POST", "/grant-sources/:id/check"], ["GET", "/grant-source-drafts"], ["POST", "/grant-source-drafts/:id/approve"]]) {
      expect(requirementFor(m, concrete(p)).needs).toBe("workspace.configure");
    }
  });
});
