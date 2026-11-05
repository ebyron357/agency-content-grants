# Billing evidence, 5 November 2026

Branch `feat/billing-plans` (docs/BILLING.md). Collected locally on a disposable PostgreSQL 16 cluster with synthetic workspaces and people. **No Stripe account, key or network call was used.** Stripe's API is replaced by a recording fake in the tests. Webhooks are signed with a test secret by the official `stripe` library (23.0.1), so signature verification is the real code path. The screenshots use placeholder test-mode settings (a fake `sk_test_` value) only so that the page shows billing as on. No request reached Stripe.

## Commands and results

| Check | Command | Result |
|---|---|---|
| Locked install | `pnpm install --frozen-lockfile` | Pass |
| Format | `pnpm run format:check` | Pass |
| Typecheck | `pnpm run typecheck` | Pass |
| Hermetic API unit tests | `pnpm --filter @workspace/api-server test:unit` | 27 files, 254 tests passed (includes `lib/billing/billing.unit.test.ts`, 14 tests) |
| Database-backed API suite | `pnpm --filter @workspace/api-server test:db:prepare && pnpm --filter @workspace/api-server test` (NODE_ENV=test, `_test` database) | 54 files, 482 tests passed (includes `routes/billing.integration.test.ts`, 9 tests, and `routes/permissions.coverage.test.ts`) |
| Content OS tests | `pnpm --filter @workspace/content-os test` | 8 files, 37 tests passed (includes `BillingTab.test.tsx`, 3 tests; also run with `TZ=America/New_York`) |
| Production build | `pnpm run build` | Pass |
| Accessibility gate (Playwright and axe, real server, billing off as in CI) | `pnpm --filter @workspace/content-os test:a11y` against a local server | 12 specs passed, including the new `e2e/billing.spec.ts` |
| Billing ON in a browser (one-off, not committed) | Playwright against a local server with placeholder test settings: a client owner joins, sees "No plan yet", switches to yearly prices, starts a Pro trial, sees usage; axe at 1280 px and 390 px, no horizontal scroll | Pass |

Not run here: the Stripe test-mode flow end to end (Checkout page, portal, real webhook deliveries). It needs the owner's Stripe account (`BILLING.md` §5, step 6). CI's secret scan, dependency audit and SBOM run on the pull request.

## What the tests prove

- **Billing off changes nothing:** with no Stripe settings, `GET /billing` reports `enabled: false` and names the missing settings (never values). Organizations and invitations have no limit. The webhook route is 404. The billing actions refuse with `billing_off`. No Stripe call is made. The operator's agency workspace is the same.
- **Owners only:** admin and writer get 403 `forbidden_by_role` on every billing route; anonymous gets 401.
- **Fail closed:** with billing on and no plan, new organizations and invitations return 402 `plan_required` with a plain-language message, and reading still works. The same applies to an unknown Stripe price, a cancelled subscription and an ended trial (unit tests cover each case).
- **The agency owner is never locked out:** the team-password owner's agency workspace stays unlimited with billing on.
- **Trial:** one 14-day trial without a card. It applies Pro's limits: 1 organization (refused at 2, with the message), 5 users (members plus open invitations; a re-invitation of the same email is not refused).
- **Checkout and portal:** sessions carry the workspace id, the prices are found by lookup key, the Agency extra-organization add-on is passed as a quantity, and the trial carries over. The portal opens for the workspace's own customer.
- **Webhooks:** a tampered, wrong-secret, unsigned or stale event is refused. Each event applies once, and an older event cannot undo a newer one. A subscription sets plan, status, interval, period end, trial end, seats and extra organizations (Agency 10 + 2 = 12).
- **Tenants:** an event naming workspace B with A's Stripe customer is refused. B cannot buy an expert review for A's application (404). Purchases are listed only for their own workspace.
- **AI-drafted applications:** counted once per application per month. The third application on Starter returns 402 with the reset date, while editing a section by hand still works.
- **Agency-managed:** only the admin-unlocked operator can set it. The agency workspace itself cannot be changed. A managed workspace is unlimited.
- **Permission coverage:** every new route is classified; the coverage test passes.

## Screenshots (billing ON, placeholder test settings, synthetic workspace)

| File | Shows |
|---|---|
| `billing-no-plan.png` | Settings → Billing for a new client workspace owner: test-mode and proposed-price notices, "No plan yet" |
| `billing-trial.png` | After starting a Pro trial: 14 days left, usage meters against the plan's limits, plans with yearly prices |
| `billing-trial-390.png` | The same at 390 px: single column, no horizontal scroll; the AI-drafting reset date shown in UTC (1 December) |
