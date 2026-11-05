/**
 * Billing end to end against the real test database, through the real router
 * (auth, requireAuth, requirePermission and the application routes) and the
 * webhook mounted before the JSON parser exactly as app.ts mounts it.
 *
 * Stripe's API is replaced by a recording fake; webhooks are signed with a test
 * secret by the official library, so signature verification is the real one.
 * No network call is made and no key is used.
 *
 * 1. Billing OFF changes nothing: no limits, the webhook is not there, actions refuse.
 * 2. Billing ON: owners only; fail closed with no plan; trial; Checkout; webhook
 *    updates; limits follow the plan; the agency workspace is never limited.
 * 3. Tenants: an event cannot move billing between workspaces; a purchase is
 *    only for the workspace's own application.
 * 4. AI-drafted applications per month, and agency-managed workspaces.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import session from "express-session";
import Stripe from "stripe";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { billingEventsTable, db, grantOpportunitiesTable, membersTable, usersTable, workspaceSubscriptionsTable, workspacesTable } from "@workspace/db";
import { router } from "./index";
import { billingWebhook } from "./billing";
import { claimAiDraftedApplication, setStripeApiForTests, type StripeApi } from "../lib/billing/service";

const PASSWORD = "Correct horse battery staple 42";
const STAMP = Date.now();
const EMAIL = (who: string) => `billing-${who}-${STAMP}@client.example`;
const CLIENT_ADDRESS = "198.51.100.15";
const WEBHOOK_SECRET = "whsec_integration_test_secret_not_real";
const BILLING_ENV = { STRIPE_SECRET_KEY: "sk_test_-fake-", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, APP_BASE_URL: "https://app.example.test" };

let server: Server;
let base = "";
const opportunities: string[] = [];
const calls: { method: string; params: any }[] = [];

const fakeStripe: StripeApi = {
  prices: {
    async list(params) {
      calls.push({ method: "prices.list", params });
      return { data: params.lookup_keys.map((k) => ({ id: `price_${k}`, lookup_key: k })) };
    },
  },
  customers: {
    async create(params) {
      calls.push({ method: "customers.create", params });
      return { id: `cus_${params.metadata?.workspaceId?.slice(0, 8)}` };
    },
  },
  checkout: {
    sessions: {
      async create(params) {
        calls.push({ method: "checkout.sessions.create", params });
        return { id: `cs_${calls.length}`, url: `https://checkout.stripe.test/c/${calls.length}` };
      },
    },
  },
  billingPortal: {
    sessions: {
      async create(params) {
        calls.push({ method: "billingPortal.sessions.create", params });
        return { url: `https://billing.stripe.test/p/${params.customer}` };
      },
    },
  },
};

function buildApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.post("/api/billing/webhook", ...billingWebhook);
  app.use(express.json({ limit: "2mb" }));
  app.use(session({ secret: "billing-test-secret", resave: false, saveUninitialized: false, name: "sid" }));
  app.use("/api", router);
  return app;
}

function person() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "X-Forwarded-For": CLIENT_ADDRESS, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, data: (type.includes("json") ? await res.json() : await res.text()) as any };
  };
}
type Person = ReturnType<typeof person>;

async function webhook(event: object, opts: { secret?: string; tamper?: boolean } = {}) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WEBHOOK_SECRET });
  const res = await fetch(`${base}/api/billing/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": header },
    body: opts.tamper ? payload.replace("active", "trialing") : payload,
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as any };
}

let created = Math.floor(Date.now() / 1000);
function subscriptionEvent(workspaceId: string, customer: string, over: Record<string, unknown> = {}, items: { lookup: string; quantity: number; interval: string }[] = [{ lookup: "agency_monthly", quantity: 1, interval: "month" }]) {
  created += 10;
  return {
    id: `evt_${randomUUID()}`,
    object: "event",
    type: "customer.subscription.updated",
    created,
    livemode: false,
    data: {
      object: {
        id: `sub_${workspaceId.slice(0, 8)}`,
        object: "subscription",
        customer,
        status: "active",
        cancel_at_period_end: false,
        trial_end: null,
        metadata: { workspaceId },
        items: { object: "list", data: items.map((i, n) => ({ id: `si_${n}`, quantity: i.quantity, current_period_end: created + 30 * 86_400, price: { id: `price_${i.lookup}`, lookup_key: i.lookup, recurring: { interval: i.interval } } })) },
        ...over,
      },
    },
  };
}

function setBilling(on: boolean) {
  for (const [k, v] of Object.entries(BILLING_ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

const operator = person();
const owner = person();
const admin = person();
const writer = person();
const ownerB = person();
let wsA = "";
let wsB = "";

async function newWorkspace(name: string, ownerEmail: string, who: Person): Promise<string> {
  const made = await operator("POST", "/workspaces", { name, ownerEmail });
  expect(made.status).toBe(201);
  const token = made.data.invitePath.replace("/invite/", "");
  expect((await who("POST", `/auth/invites/${token}/accept`, { name: `Owner of ${name}`, password: PASSWORD })).status).toBe(201);
  return made.data.workspace.id;
}

async function join(inviter: Person, email: string, role: string, who: Person) {
  const inv = await inviter("POST", "/workspace/invites", { email, role });
  expect(inv.status).toBe(201);
  expect((await who("POST", `/auth/invites/${inv.data.invitePath.replace("/invite/", "")}/accept`, { name: role, password: PASSWORD })).status).toBe(201);
}

async function freshOpportunity(): Promise<string> {
  const id = randomUUID();
  opportunities.push(id);
  await db.insert(grantOpportunitiesTable).values({
    id, source: "grants_gov", sourceRef: `billing-test-${id}`, title: "Billing test opportunity", agency: "Test Agency", status: "posted",
    closeDate: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10), officialUrl: `https://www.grants.gov/search-results-detail/${id}`,
    fetchedAt: new Date(), detailFetchedAt: new Date(), checksum: "seed", connectorVersion: "test", publishable: true, gateMissing: [],
    eligibilityCodes: ["12"], categories: [], assistanceListings: [], costSharing: false,
  });
  return id;
}

const org = (who: Person, name: string) => who("POST", "/grants/applicants", { name: `${name} ${randomUUID().slice(0, 6)}`, applicantType: "nonprofit_501c3" });

beforeAll(async () => {
  setBilling(false);
  setStripeApiForTests(fakeStripe);
  server = buildApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect((await operator("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD })).status).toBe(200);
  expect((await operator("POST", "/auth/admin-unlock", { password: process.env.ADMIN_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  setBilling(false);
  setStripeApiForTests(null);
  server?.close();
  const ws = await db.select().from(workspacesTable).where(inArray(workspacesTable.id, [wsA, wsB].filter(Boolean)));
  await db.delete(membersTable).where(inArray(membersTable.email, ["owner", "admin", "writer", "ownerb", "extra1", "extra2"].map(EMAIL)));
  if (ws.length) {
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, ws.map((w) => w.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, ws.map((w) => w.principalUserId)));
    await db.delete(billingEventsTable).where(inArray(billingEventsTable.workspaceId, ws.map((w) => w.id)));
  }
  if (opportunities.length) await db.delete(grantOpportunitiesTable).where(inArray(grantOpportunitiesTable.id, opportunities));
});

describe("billing", () => {
  it("changes nothing while billing is off", async () => {
    wsA = await newWorkspace("Billing A (test)", EMAIL("owner"), owner);
    await join(owner, EMAIL("admin"), "admin", admin);
    await join(owner, EMAIL("writer"), "writer", writer);
    // No plan and no limits: more organizations than any plan's minimum.
    for (const n of [1, 2]) expect((await org(owner, `A org ${n}`)).status).toBe(201);
    const view = await owner("GET", "/billing");
    expect(view.status).toBe(200);
    expect(view.data).toMatchObject({ enabled: false, missingSettings: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "APP_BASE_URL"], entitlement: { mode: "unlimited", reason: "billing_off" } });
    expect(JSON.stringify(view.data)).not.toContain("sk_");
    expect((await owner("POST", "/billing/trial", { planKey: "starter" })).data.code).toBe("billing_off");
    expect((await owner("POST", "/billing/checkout", { planKey: "starter" })).status).toBe(409);
    expect((await webhook(subscriptionEvent(wsA, "cus_x"))).status).toBe(404);
    expect(calls).toEqual([]);
    // The operator's agency workspace too.
    expect((await operator("GET", "/billing")).data.entitlement.reason).toBe("billing_off");
    expect((await org(operator, "Agency org")).status).toBe(201);
  });

  it("is for owners only", async () => {
    for (const who of [admin, writer]) {
      const r = await who("GET", "/billing");
      expect(r.status).toBe(403);
      expect(r.data.code).toBe("forbidden_by_role");
      expect((await who("POST", "/billing/checkout", { planKey: "pro" })).status).toBe(403);
      expect((await who("POST", "/billing/portal")).status).toBe(403);
    }
    expect((await person()("GET", "/billing")).status).toBe(401);
  });

  it("fails closed without a plan, and never limits the agency workspace", async () => {
    setBilling(true);
    const create = await org(owner, "A org 3");
    expect(create.status).toBe(402);
    expect(create.data.code).toBe("plan_required");
    expect(create.data.error).toContain("Settings, Billing");
    expect((await owner("POST", "/workspace/invites", { email: EMAIL("extra1"), role: "viewer" })).status).toBe(402);
    // Reading and editing existing work is not affected.
    expect((await owner("GET", "/grants/applicants")).status).toBe(200);
    // The operator's own workspace and the team password keep full access.
    expect((await org(operator, "Agency org")).status).toBe(201);
    expect((await operator("GET", "/billing")).data).toMatchObject({ enabled: true, mode: "test", entitlement: { mode: "unlimited", reason: "agency_workspace" } });
    expect((await operator("POST", "/billing/checkout", { planKey: "pro" })).status).toBe(409);
  });

  it("starts one free trial without a card and applies the plan's limits", async () => {
    expect((await owner("POST", "/billing/trial", { planKey: "expert_review" })).status).toBe(400);
    const trial = await owner("POST", "/billing/trial", { planKey: "pro" });
    expect(trial.status).toBe(201);
    expect(new Date(trial.data.trialEndsAt).getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    expect((await owner("POST", "/billing/trial", { planKey: "starter" })).status).toBe(409);
    const view = (await owner("GET", "/billing")).data;
    expect(view).toMatchObject({ entitlement: { mode: "plan", reason: "trial", planKey: "pro", trialDaysLeft: 14, limits: { users: 5, organizations: 1, aiDraftedApplications: 10 } }, usage: { users: 3, organizations: 2 }, trialAvailable: false, pricesPublished: false });
    // Pro includes 1 organization; this workspace has 2 from before.
    const over = await org(owner, "A org 3");
    expect(over.status).toBe(402);
    expect(over.data).toMatchObject({ code: "plan_limit_reached", limit: 1, used: 2 });
    expect(over.data.error).toContain("Your Pro plan includes 1 organization");
    // Users: 3 members of 5; invitations count.
    expect((await owner("POST", "/workspace/invites", { email: EMAIL("extra1"), role: "viewer" })).status).toBe(201);
    expect((await owner("POST", "/workspace/invites", { email: EMAIL("extra2"), role: "viewer" })).status).toBe(201);
    const full = await owner("POST", "/workspace/invites", { email: `third-${STAMP}@client.example`, role: "viewer" });
    expect(full.status).toBe(402);
    expect(full.data.error).toContain("5 users");
    // Re-inviting the same email replaces its invitation, so it is not refused.
    expect((await owner("POST", "/workspace/invites", { email: EMAIL("extra2"), role: "writer" })).status).toBe(201);
  });

  it("sends the owner to Stripe Checkout and the customer portal", async () => {
    expect((await owner("POST", "/billing/checkout", { planKey: "managed" })).status).toBe(400);
    expect((await owner("POST", "/billing/checkout", { planKey: "agency", interval: "weekly" })).status).toBe(400);
    const r = await owner("POST", "/billing/checkout", { planKey: "agency", interval: "year", extraOrganizations: 2 });
    expect(r.status).toBe(200);
    expect(r.data.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const session = calls.filter((c) => c.method === "checkout.sessions.create").at(-1)!.params;
    expect(session).toMatchObject({
      mode: "subscription",
      client_reference_id: wsA,
      line_items: [{ price: "price_agency_annual", quantity: 1 }, { price: "price_agency_extra_organization_annual", quantity: 2 }],
      metadata: { workspaceId: wsA, planKey: "agency" },
      success_url: "https://app.example.test/settings?tab=billing&checkout=success",
    });
    // The trial's remaining days carry over to the subscription.
    expect(session.subscription_data.trial_end).toBeGreaterThan(Date.now() / 1000 + 13 * 86_400);
    expect(calls.find((c) => c.method === "customers.create")!.params).toMatchObject({ email: EMAIL("owner"), metadata: { workspaceId: wsA } });
    const portal = await owner("POST", "/billing/portal");
    expect(portal.data.url).toBe(`https://billing.stripe.test/p/cus_${wsA.slice(0, 8)}`);
  });

  it("updates the subscription from signed webhooks, once each, in order", async () => {
    const customer = `cus_${wsA.slice(0, 8)}`;
    expect((await webhook({ id: `evt_${randomUUID()}`, type: "checkout.session.completed", created: created + 1, data: { object: { id: "cs_1", mode: "subscription", client_reference_id: wsA, customer, subscription: `sub_${wsA.slice(0, 8)}`, payment_status: "paid" } } })).data).toMatchObject({ applied: true, reason: "linked" });
    const event = subscriptionEvent(wsA, customer, {}, [{ lookup: "agency_annual", quantity: 1, interval: "year" }, { lookup: "agency_extra_organization_annual", quantity: 2, interval: "year" }]);
    expect((await webhook(event, { tamper: true })).status).toBe(400);
    expect((await webhook(event, { secret: "whsec_wrong" })).status).toBe(400);
    const unsigned = await fetch(`${base}/api/billing/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
    expect(unsigned.status).toBe(400);
    expect((await webhook(event)).data).toMatchObject({ applied: true, reason: "subscription active", workspaceId: wsA });
    expect((await webhook(event)).data).toMatchObject({ applied: false, reason: "duplicate" });
    const [row] = await db.select().from(workspaceSubscriptionsTable).where(eq(workspaceSubscriptionsTable.workspaceId, wsA));
    expect(row).toMatchObject({ planKey: "agency", status: "active", billingInterval: "year", extraOrganizations: 2, seats: 1, stripeCustomerId: customer, trialEndsAt: null });
    expect(row.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    // An older event delivered late does not undo the newer state.
    const stale = subscriptionEvent(wsA, customer, { status: "canceled" });
    stale.created = event.created - 100;
    expect((await webhook(stale)).data.reason).toBe("older than the state already recorded");
    // Agency: 10 + 2 organizations, 15 users.
    const view = (await owner("GET", "/billing")).data;
    expect(view.entitlement).toMatchObject({ mode: "plan", reason: "active", planKey: "agency", limits: { users: 15, organizations: 12, aiDraftedApplications: null } });
    expect((await org(owner, "A org 3")).status).toBe(201);
    // A price the plans do not know grants nothing (fail closed), and the owner is told.
    expect((await webhook(subscriptionEvent(wsA, customer, {}, [{ lookup: "gold_monthly", quantity: 1, interval: "month" }]))).data.applied).toBe(true);
    expect((await owner("GET", "/billing")).data.entitlement).toMatchObject({ mode: "none", reason: "unknown_plan" });
    expect((await org(owner, "A org 4")).status).toBe(402);
    expect((await webhook(subscriptionEvent(wsA, customer, {}, [{ lookup: "agency_monthly", quantity: 1, interval: "month" }]))).data.applied).toBe(true);
    // Cancellation ends the plan's grant.
    const ended = subscriptionEvent(wsA, customer, { status: "canceled" });
    ended.type = "customer.subscription.deleted";
    expect((await webhook(ended)).data.reason).toBe("subscription canceled");
    expect((await org(owner, "A org 4")).data.code).toBe("plan_required");
    expect((await webhook(subscriptionEvent(wsA, customer))).data.applied).toBe(true);
  });

  it("keeps each workspace's billing to itself", async () => {
    wsB = await newWorkspace("Billing B (test)", EMAIL("ownerb"), ownerB);
    // An event naming B but carrying A's customer is refused, so billing never moves between workspaces.
    const crossed = await webhook(subscriptionEvent(wsB, `cus_${wsA.slice(0, 8)}`));
    expect(crossed.data).toMatchObject({ applied: false, reason: "customer belongs to another workspace" });
    expect((await ownerB("GET", "/billing")).data.entitlement.reason).toBe("no_plan");
    // A's application is not B's to buy a review for.
    const aOrg = (await owner("GET", "/grants/applicants")).data[0];
    const aApp = await owner("POST", "/grants/applications", { applicantId: aOrg.id, opportunityId: await freshOpportunity(), eligibilityConfirmed: true });
    expect(aApp.status).toBe(201);
    expect((await ownerB("POST", "/billing/expert-review", { applicationId: aApp.data.id })).status).toBe(404);
    const review = await owner("POST", "/billing/expert-review", { applicationId: aApp.data.id });
    expect(review.status).toBe(200);
    expect(calls.filter((c) => c.method === "checkout.sessions.create").at(-1)!.params).toMatchObject({ mode: "payment", line_items: [{ price: "price_expert_review", quantity: 1 }], metadata: { workspaceId: wsA, planKey: "expert_review", applicationId: aApp.data.id } });
    const paid = await webhook({ id: `evt_${randomUUID()}`, type: "checkout.session.completed", created: created + 1, data: { object: { id: `cs_${randomUUID()}`, mode: "payment", payment_status: "paid", amount_total: 75000, currency: "usd", client_reference_id: wsA, metadata: { workspaceId: wsA, planKey: "expert_review", applicationId: aApp.data.id } } } });
    expect(paid.data.reason).toBe("purchase recorded");
    expect((await owner("GET", "/billing")).data.purchases).toMatchObject([{ planKey: "expert_review", applicationId: aApp.data.id, amountCents: 75000 }]);
    expect((await ownerB("GET", "/billing")).data.purchases).toEqual([]);
  });

  it("counts each AI-drafted application once a month, up to the plan's number", async () => {
    expect((await ownerB("POST", "/billing/trial", { planKey: "starter" })).status).toBe(201);
    const bOrg = await org(ownerB, "B org");
    expect(bOrg.status).toBe(201);
    const app = await ownerB("POST", "/grants/applications", { applicantId: bOrg.data.id, opportunityId: await freshOpportunity(), eligibilityConfirmed: true });
    const sectionId = (await ownerB("GET", `/grants/applications/${app.data.id}`)).data.sections[0].id;
    const bSession = { workspaceId: wsB };
    expect(await claimAiDraftedApplication(bSession, "other-app-1")).toMatchObject({ allowed: true, used: 1 });
    expect(await claimAiDraftedApplication(bSession, "other-app-1")).toMatchObject({ allowed: true, used: 1 });
    expect(await claimAiDraftedApplication(bSession, "other-app-2")).toMatchObject({ allowed: true, used: 2 });
    const refused = await ownerB("POST", `/grants/sections/${sectionId}/draft`);
    expect(refused.status).toBe(402);
    expect(refused.data.error).toContain("2 AI-drafted applications a month");
    expect(refused.data.error).toContain("You can still write and edit sections yourself.");
    // Writing the section by hand still works.
    expect((await ownerB("PATCH", `/grants/sections/${sectionId}`, { content: "<p>Written by hand.</p>" })).status).toBe(200);
    expect((await ownerB("GET", "/billing")).data.usage.aiDraftedApplications).toBe(2);
  });

  it("lets the operator mark a client workspace agency-managed", async () => {
    const locked = person();
    await locked("POST", "/auth/login", { password: process.env.ADMIN_PASSWORD });
    expect((await locked("PUT", `/workspaces/${wsB}/billing`, { managed: true })).status).toBe(403);
    expect((await ownerB("PUT", `/workspaces/${wsB}/billing`, { managed: true })).status).toBe(403);
    expect((await operator("PUT", `/workspaces/${wsA}/billing`, { managed: true })).status).toBe(409);
    expect((await operator("PUT", `/workspaces/${wsB}/billing`, { managed: true })).status).toBe(200);
    expect((await ownerB("GET", "/billing")).data.entitlement).toMatchObject({ mode: "unlimited", reason: "managed_plan" });
    expect(await claimAiDraftedApplication({ workspaceId: wsB }, "other-app-3")).toMatchObject({ allowed: true });
    // Switching billing off again: everything as before.
    setBilling(false);
    expect((await org(owner, "A org after")).status).toBe(201);
    expect((await owner("GET", "/billing")).data.entitlement.reason).toBe("billing_off");
  });
});
