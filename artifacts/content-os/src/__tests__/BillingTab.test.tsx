import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import BillingTab, { type BillingView } from "@/pages/BillingTab";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const plans: BillingView["plans"] = [
  { key: "starter", name: "Starter", description: "For one writer.", kind: "subscription", monthlyPriceCents: 4900, annualPriceCents: 49000, oneTimePriceCents: null, limits: { users: 2, organizations: 1, aiDraftedApplications: 2 }, extraOrganizationPriceCents: null, features: ["2 users"], trialDays: 14, purchasable: true, pricesPublished: false },
  { key: "expert_review", name: "Expert review", description: "A human check.", kind: "one_time", monthlyPriceCents: null, annualPriceCents: null, oneTimePriceCents: 75000, limits: { users: null, organizations: null, aiDraftedApplications: null }, extraOrganizationPriceCents: null, features: [], trialDays: 0, purchasable: true, pricesPublished: false },
];

function view(over: Partial<BillingView> = {}): BillingView {
  return {
    enabled: true, mode: "test", missingSettings: [], forcedOff: false,
    workspace: { id: "w1", name: "Client A", kind: "client" },
    subscription: { planKey: "starter", status: "trialing", billingInterval: null, trialEndsAt: "2026-11-19T12:00:00Z", currentPeriodEnd: null, cancelAtPeriodEnd: false, extraOrganizations: 0, hasBillingAccount: false, hasStripeSubscription: false },
    entitlement: { mode: "plan", reason: "trial", planKey: "starter", planName: "Starter", limits: { users: 2, organizations: 1, aiDraftedApplications: 2 }, trialDaysLeft: 14 },
    usage: { users: 2, organizations: 1, aiDraftedApplications: 1 },
    usageResetsOn: "2026-12-01T00:00:00Z",
    trialAvailable: false, plans, pricesPublished: false, purchases: [],
    ...over,
  };
}

function mount(me: { permissions: string[] }, billing: BillingView) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.endsWith("/auth/me") ? { authenticated: true, isAdmin: false, member: null, workspace: null, role: "owner", roleLabel: "Owner", workspaces: [], ...me } : billing;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BillingTab /></QueryClientProvider>);
}

describe("Settings, Billing", () => {
  it("shows the trial, usage against limits and that prices are proposals", async () => {
    mount({ permissions: ["billing.manage"] }, view());
    expect(await screen.findByText("Free trial of Starter: 14 days left")).toBeInTheDocument();
    expect(screen.getByText("Proposed prices")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Users" })).toHaveAttribute("aria-valuetext", "2 of 2");
    expect(screen.getByRole("progressbar", { name: "AI-drafted applications this month" })).toHaveAttribute("aria-valuenow", "1");
    // Midnight UTC on 1 December is shown as 1 December in every time zone.
    expect(screen.getByText(/^Resets on /)).toHaveTextContent(new Date("2026-12-01T00:00:00Z").toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" }));
    expect(screen.getByRole("button", { name: "Subscribe to Starter, monthly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /free 14-day trial/ })).not.toBeInTheDocument();
  });

  it("says plainly when billing is off, naming only the missing settings", async () => {
    mount({ permissions: ["billing.manage"] }, view({ enabled: false, missingSettings: ["STRIPE_SECRET_KEY", "APP_BASE_URL"] }));
    expect(await screen.findByText("Billing is off")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is limited and nobody is charged/)).toHaveTextContent("STRIPE_SECRET_KEY, APP_BASE_URL");
    expect(screen.queryByRole("button", { name: /Subscribe/ })).not.toBeInTheDocument();
  });

  it("is for owners only", async () => {
    mount({ permissions: ["workspace.read", "members.manage"] }, view());
    await waitFor(() => expect(screen.getByText("Owners only")).toBeInTheDocument());
  });
});
