# Billing: plans, trials and Stripe

**Status:** built and tested, **switched off**. Billing stays off until the owner creates a Stripe account and sets the settings in §5. While it is off, the product behaves exactly as it did before billing existed: nothing is limited and nobody is charged.

**Prices are proposals.** The prices below come from the owner's plan of 5 November 2026 (the Claude Doc "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan"). The owner has not published them. They are stored with `prices_published = false`, and the Billing page shows "Proposed prices" until the owner changes that.

## 1. Plans

Plans are rows in the `billing_plans` table, not constants in code. Prices, limits, features and Stripe lookup keys change with an SQL update and no release (§6). Migration `lib/db/drizzle/0033_billing_plans.sql` seeds them.

| Plan | Monthly | Yearly (two months free) | Users | Organizations | AI-drafted applications a month | Other |
|---|---|---|---|---|---|---|
| Starter | $49 | $490 | 2 | 1 | 2 | All matching and deadline alerts |
| Pro | $149 | $1,490 | 5 | 1 | 10 | Foundation open calls, approvals and packages, after-award tracking |
| Agency | $399 | $3,990 | 15 | 10 client organizations | No limit | Every Pro feature; $25 a month per extra client organization |
| Expert review | $750 once, per application | — | — | — | — | A vetted grant writer reviews one AI-drafted application |
| Agency-managed | not sold | — | No limit | No limit | No limit | A client workspace the agency runs for the client (§3) |

Every plan you can buy starts with a **14-day free trial with no card**. A workspace gets one trial.

What the limits count:

- **Users:** members of the workspace plus open, unexpired invitations. Sending an invitation is refused at the limit. A new invitation to the same email replaces the old one, so it is not refused. Accepting an invitation is refused only if the plan has shrunk since it was sent. The first person to join an empty workspace (its first owner) is always admitted, because a workspace needs an owner before anyone can choose its plan.
- **Organizations:** Grant Studio organizations (applicants) in the workspace. For Agency, "client organizations" are these organizations: one Agency workspace serves up to 10 clients, plus any extra it pays for.
- **AI-drafted applications:** an application counts once in a calendar month (UTC) the first time a section in it is drafted with AI **successfully**. More AI drafts in the same application that month are free. A draft that fails does not count: its request reserves the application's slot, a successful draft confirms it, and the draft job releases the reservation when its last attempt fails (unless another draft in that application succeeded). Writing and editing sections by hand is never limited. The count resets on the 1st.
- **Not metered:** section review, requirement extraction and the notice checklist use AI but do not count against any limit. The plan sells AI-drafted applications only; metering the others would be a pricing decision for the owner.

Features that do not exist yet (foundation open calls, after-award tracking) are listed on the plans, but this change does not gate them. They are other agents' week-1 work, and gating them belongs with them.

## 2. Rules (`artifacts/api-server/src/lib/billing/entitlements.ts`)

1. **Billing off:** no limits anywhere.
2. **The agency workspace** (the operator's own, which the `ADMIN_PASSWORD` sign-in uses) is **never limited**, with or without billing. The existing agency owner can never be locked out.
3. A plan's limits apply while its subscription is **trialing** (before the trial end), **active** or **past due** (Stripe's payment-retry window).
4. **Fail closed.** Anything else grants nothing: no plan, a plan key that is unknown, inactive or one-time, a Stripe price that matches no plan, an ended trial or a trial with no end date, and a cancelled, unpaid, incomplete or paused subscription. New organizations, invitations and AI drafts are refused with a message that says why and what to do. **Reading and editing existing work is never blocked.**
5. A refused action returns **HTTP 402** with `code` `plan_required` or `plan_limit_reached` and a plain-language `error`, for example: "Your Pro plan includes 1 organization, and this workspace already has 2. An owner can upgrade in Settings, Billing." The existing screens show the `error` as it is.

## 3. Who can do what

- **Settings → Billing is for owners only.** A new permission, `billing.manage`, is held by the owner role alone. Admins keep everything else they had. Every `/api/billing*` route requires it (`lib/permissions.ts`), and the per-route coverage test covers the new routes.
- The **operator** (team password with admin access unlocked) can mark a client workspace **agency-managed** (`PUT /api/workspaces/:id/billing { managed: true }`): no limits and no charge, for clients the agency serves directly. A workspace that pays through Stripe must cancel first.

## 4. How it works

| Piece | Where |
|---|---|
| Plans, subscriptions, usage, purchases, processed events | `lib/db/src/schema/billing.ts`, migration `0033_billing_plans.sql` |
| On/off switch (env names only, never values) | `artifacts/api-server/src/lib/billing/config.ts` |
| Entitlements and limit messages (pure) | `artifacts/api-server/src/lib/billing/entitlements.ts` |
| Stripe event → subscription change (pure) | `artifacts/api-server/src/lib/billing/stripeEvents.ts` |
| Stripe client, Checkout, portal, trial, usage, applying events | `artifacts/api-server/src/lib/billing/service.ts` |
| Routes | `artifacts/api-server/src/routes/billing.ts` |
| Limit checks | `POST /workspace/invites`, `POST /auth/invites/:token/accept`, `POST /grants/applicants`, `POST /grants/sections/:sid/draft` |
| Billing page | `artifacts/content-os/src/pages/BillingTab.tsx` (Settings → Billing) |

The design follows Stripe's official samples ([subscription-use-cases](https://github.com/stripe-samples/subscription-use-cases) and [checkout-single-subscription](https://github.com/stripe-samples/checkout-single-subscription), MIT). It uses the official [`stripe`](https://www.npmjs.com/package/stripe) package (23.0.1, MIT). No sample code is copied, only the pattern: Checkout for subscribing, the customer portal for changes, and a webhook as the source of truth.

- **Subscribing:** `POST /api/billing/checkout { planKey, interval: "month" | "year", extraOrganizations? }` finds the Stripe prices by **lookup key** and creates a Stripe customer for the workspace (once). It then opens a hosted **Checkout Session** with `client_reference_id` and `metadata.workspaceId`. The browser goes to Stripe's page. If the workspace is in a trial with more than two days left, the trial end carries over to the subscription.
- **Changing or cancelling:** `POST /api/billing/portal` opens the Stripe **customer portal**.
- **Trial without a card:** `POST /api/billing/trial { planKey }` records a 14-day trial locally, with no Stripe call. The week-2 self sign-up flow will call the same `startTrial(workspaceId, planKey)` for a new workspace.
- **Expert review:** `POST /api/billing/expert-review { applicationId }` opens a one-time Checkout for one of the workspace's own applications. The purchase is recorded when Stripe reports it paid. Nothing is purchased in-app yet. The Grant Studio button and the review workflow are later work.
- **Webhook:** `POST /api/billing/webhook` is mounted in `app.ts` **before** `express.json()`. It reads the raw bytes with `express.raw()` and checks them with `stripe.webhooks.constructEvent(raw, Stripe-Signature, STRIPE_WEBHOOK_SECRET)`, which also enforces Stripe's 5-minute timestamp tolerance. A bad or missing signature returns 400. With billing off the route is 404.
  - Handled events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `customer.subscription.created`, `updated`, `deleted`, `paused`, `resumed` and `trial_will_end`. Others are acknowledged and ignored.
  - The event updates the workspace's `workspace_subscriptions` row: plan (from the price lookup key), status, billing interval, trial end, period end (from the subscription item, as newer API versions report it), cancel at period end, seats (quantity) and extra organizations (quantity of the add-on price).
  - **Each event applies once:** the event id is stored in `billing_events` in the same transaction as the change. A failure returns 500, so Stripe retries.
  - **In order:** an event older than the last one applied to a workspace is ignored, and so is the end of a replaced subscription.
  - **Tenant safety:** an event that names one workspace but carries another workspace's Stripe customer or subscription is refused, so billing never moves between workspaces.
- **Concurrency:** counting and reserving an AI-drafted application runs in one transaction under a per-workspace advisory lock, so two requests cannot both take the last one. A reservation is a `billing_usage` row with `confirmed_at` null; it counts toward the limit until it is confirmed or released.
- **Limit:** if the worker process dies mid-draft, the job's final failure is recorded by the queue, not by the draft, so that reservation is not released and the application counts for the month.

## 5. Owner actions to switch billing on

Nothing below has been done. Do **not** change `render.yaml` for this: add the variables in the Render dashboard.

1. **Create a Stripe account** and finish its activation. Start in **test mode**.
2. **Create the products and prices** (Stripe Dashboard → Product catalog). Give each price exactly this **lookup key** (price → Edit → Lookup key):

   | Product | Price | Lookup key |
   |---|---|---|
   | Starter | $49 / month, recurring | `starter_monthly` |
   | Starter | $490 / year, recurring | `starter_annual` |
   | Pro | $149 / month | `pro_monthly` |
   | Pro | $1,490 / year | `pro_annual` |
   | Agency | $399 / month | `agency_monthly` |
   | Agency | $3,990 / year | `agency_annual` |
   | Agency extra client organization | $25 / month, per unit | `agency_extra_organization_monthly` |
   | Agency extra client organization | $250 / year, per unit | `agency_extra_organization_annual` |
   | Expert review | $750, one time | `expert_review` |

   The yearly add-on price ($250, the same two months free) is a proposal like the others. If you choose different prices, change them in Stripe and in `billing_plans` (§6).
3. **Set the environment variables** in Render → service `agency-content-grants` → Environment (never in `render.yaml`, never in git):

   | Variable | Value |
   |---|---|
   | `STRIPE_SECRET_KEY` | The secret key (`sk_test_…` first, `sk_live_…` at launch). A restricted key works if it can read prices and write customers, Checkout Sessions and billing portal sessions |
   | `STRIPE_WEBHOOK_SECRET` | The endpoint's signing secret (`whsec_…`) from step 4 |
   | `APP_BASE_URL` | The app's public origin, for example `https://agency-content-grants.onrender.com` (where Stripe sends people back) |
   | `BILLING_DISABLED` | Optional. `true` turns billing off again without removing the keys |

   Billing turns on only when the first three are all set. The Billing page names the ones that are missing (names only, never values).
4. **Configure the webhook endpoint** (Developers → Webhooks → Add endpoint): URL `https://<your app>/api/billing/webhook`. Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed` and `customer.subscription.trial_will_end`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Set up the customer portal** (Settings → Billing → Customer portal): allow updating the payment method, viewing invoices and cancelling. Allow switching plans between the Starter, Pro and Agency prices, and changing the quantity of the extra-organization price. Set the default return link to `https://<your app>/settings?tab=billing`.
6. Deploy (owner-only), then test in test mode with Stripe's test cards: start a trial, subscribe, open Manage billing, and cancel. Watch the webhook deliveries in Stripe.
7. When the prices are final: `UPDATE billing_plans SET prices_published = true WHERE purchasable;`, then switch to live keys and a live webhook endpoint.
8. Optionally mark client workspaces the agency runs itself as agency-managed (§3) **before** switching billing on. Otherwise their owners see "No plan yet" and can only start a trial or subscribe. After a deploy with billing on, the server logs a warning, "Billing is on and these client workspaces have no usable plan", with the count and the workspace ids; use it to find the ones still to mark.

Also before charging anyone: terms of service and a refund policy (plan §9; counsel).

## 6. Changing prices or limits without a release

```sql
-- Example: raise Pro to 8 users. Takes effect on the next request.
UPDATE billing_plans SET max_users = 8 WHERE key = 'pro';
-- Example: a new price. Create it in Stripe with a new lookup key first, then:
UPDATE billing_plans SET monthly_price_cents = 15900, stripe_lookup_monthly = 'pro_monthly_2027' WHERE key = 'pro';
```

Existing subscribers keep their Stripe price until it changes in Stripe. A subscription whose price lookup key no longer matches any plan grants nothing (fail closed), so keep old lookup keys on the plan, or move the subscribers in Stripe first.

## 7. Tests

- `artifacts/api-server/src/lib/billing/billing.unit.test.ts` (hermetic): the switch, entitlements, every fail-closed case, the limit messages, event mapping from Stripe-shaped fixtures, and signature verification with a test secret through `stripe.webhooks.generateTestHeaderString` and `constructEvent` (tampered, wrong-secret and stale events are refused).
- `artifacts/api-server/src/routes/billing.integration.test.ts` (database): billing off changes nothing; owners only; fail closed; trial; Checkout and portal (Stripe replaced by a recording fake); signed webhooks applied once and in order; an unknown price; cancellation; cross-workspace refusal; expert review only for the workspace's own application; the AI-drafted application count; agency-managed; and switching billing off again.
- `artifacts/api-server/src/lib/permissions.unit.test.ts` and `routes/permissions.coverage.test.ts`: billing is owner-only, and the new routes are classified.
- `artifacts/content-os/src/__tests__/BillingTab.test.tsx` and `artifacts/content-os/e2e/billing.spec.ts` (axe, keyboard, 390 px).

Evidence: `docs/evidence/billing/2026-11-05/README.md`.
