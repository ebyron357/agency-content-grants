import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, hasPermission, requirementFor, rolesWith } from "./permissions";

describe("role permissions", () => {
  it("gives every role a known set of permissions", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.keys(ROLES).sort());
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toHaveProperty(p);
    for (const role of Object.keys(ROLES)) expect(hasPermission(role, "workspace.read")).toBe(true);
  });

  it("separates writing from approving", () => {
    expect(hasPermission("writer", "grants.write")).toBe(true);
    expect(hasPermission("writer", "grants.review")).toBe(false);
    expect(hasPermission("writer", "grants.approve")).toBe(false);
    expect(hasPermission("reviewer", "grants.write")).toBe(false);
    expect(rolesWith("grants.approve")).toEqual(["owner", "admin", "representative"]);
    expect(hasPermission("viewer", ["grants.write", "content.write"])).toBe(false);
    expect(hasPermission(undefined, "workspace.read")).toBe(false);
    expect(hasPermission("intruder", "workspace.read")).toBe(false);
  });

  it("maps requests to the permission they need", () => {
    expect(requirementFor("GET", "/grants/applications/a1").needs).toBe("workspace.read");
    expect(requirementFor("PATCH", "/grants/applications/a1").needs).toBe("grants.write");
    expect(requirementFor("POST", "/grants/sections/s1/approve").needs).toBe("grants.review");
    expect(requirementFor("POST", "/grants/applications/a1/approve-package").needs).toBe("grants.approve");
    expect(requirementFor("PATCH", "/grants/budget-lines/l1").needs).toBe("grants.finance");
    expect(requirementFor("POST", "/grants/applications/a1/outcome").needs).toEqual(["grants.approve", "grants.finance"]);
    expect(requirementFor("POST", "/brands/b1/publishing-destinations").needs).toBe("content.publish");
    expect(requirementFor("POST", "/brands/b1/audience-profiles").needs).toBe("content.write");
    expect(requirementFor("GET", "/api-keys").needs).toBe("automation.manage");
    expect(requirementFor("HEAD", "/brands").needs).toBe("workspace.read");
  });

  it("keeps billing with owners", () => {
    expect(rolesWith("billing.manage")).toEqual(["owner"]);
    expect(hasPermission("admin", "members.manage")).toBe(true);
    expect(requirementFor("GET", "/billing").needs).toBe("billing.manage");
    expect(requirementFor("POST", "/billing/checkout").needs).toBe("billing.manage");
    expect(requirementFor("PUT", "/workspaces/w1/billing").needs).toBe("members.manage");
  });

  it("fails closed for a write nobody classified", () => {
    const r = requirementFor("POST", "/something-new");
    expect(r.rule).toBeNull();
    expect(rolesWith(r.needs)).toEqual(["owner", "admin"]);
  });
});
