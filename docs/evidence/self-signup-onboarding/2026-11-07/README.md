# Self sign-up and onboarding evidence, 7 November 2026

Branch `feat/self-signup-onboarding` (docs/SELF_SIGNUP.md), rebased on `main` `19aaf5e`. Collected locally against a disposable PostgreSQL 16 database (`signup_onboarding_test`, `NODE_ENV=test`) with synthetic people, organizations, EINs and opportunities only. **No email was sent and ProPublica was not called by any test:** email goes to a capturing test transport, and the lookup is answered by fixtures (API tests) or by a seeded cache row and routed synthetic answers (browser tests).

## Commands and results

| Check | Command | Result |
|---|---|---|
| Locked install | `pnpm install --frozen-lockfile` | Pass |
| Format | `pnpm run format:check` | Pass |
| Typecheck | `pnpm run typecheck` | Pass |
| Hermetic API unit tests | `pnpm --filter @workspace/api-server test:unit` | 31 files, 352 tests passed (includes `lib/onboarding/onboarding.unit.test.ts`); script self-test 17 passed |
| Database-backed API suite | `pnpm --filter @workspace/api-server test:db:prepare && pnpm --filter @workspace/api-server test` | 63 files, 625 tests passed (includes `routes/signup.integration.test.ts`, `routes/onboarding.integration.test.ts` and `routes/permissions.coverage.test.ts`) |
| GrantCrest frontend tests | `pnpm --filter @workspace/content-os test` | 9 files, 39 tests passed |
| Builds | `pnpm -r --if-present run build` | Pass |
| Integration tests against the built server | `bash tests/integration-tests.sh` (port changed to the local server's) | 40 passed, 0 failed, 0 skipped |
| Accessibility gate (Playwright and axe, real built server, sign-up off as in CI) | `pnpm --filter @workspace/content-os test:a11y` | 18 specs passed, including the 4 in `e2e/onboarding.spec.ts` |

Local note: the worktree sits under a `.claude` folder, and Express's `sendFile` refuses paths with a dot folder, so the local server was given `FRONTEND_DIST_PATH` pointing at a copy of the frontend build. CI does not need this.

## Timing (target: a new organization reaches a first match in under 5 minutes)

- Browser, real server, seeded cache and opportunities: EIN entry to first match took **about 5.4 seconds** of system time (`[onboarding timing]` line in the Playwright log); the test fails above 60 seconds.
- API, sign-up through email confirmation, lookup, organization and first match: asserted under 30 seconds.
- A person's time is mostly reading and ticking four short screens. The design has four steps and prefills everything the IRS records hold.

## What the tests prove

- **Sign-up off changes nothing:** no sign-up link, `/signup` is the sign-in page, every sign-up route 404s and nothing is written; with the flag on but no email provider it stays off.
- **On, it creates an isolated workspace:** nothing exists until the email link is opened; then a new client workspace with the person as owner, a signed-in session and audit entries. Another workspace's organizations and checklist are not visible; roles are enforced on the wizard's writes.
- **Abuse protection:** 3 sign-ups an hour per email from any address and 10 per IP address; the same answer for an existing account (which gets a sign-in email instead); a bot filling the hidden field gets the normal answer and nothing happens; expired, used and made-up links fail.
- **Billing:** with billing on, the 14-day trial starts through `startTrial`; with billing off, no trial and no limits.
- **Wizard:** happy path from EIN to first match; values not confirmed are never written to the profile but are kept as unconfirmed, sourced facts; unknown EIN, ProPublica unreachable (never cached) and malformed EIN; manual path with no EIN; checklist hide and show; the wizard stays reachable.
- **Accessibility:** sign-up, check-your-email, confirmation, every wizard step, the checklist and `/get-started` and `/onboarding` in the route gate pass axe (WCAG 2.0/2.1 A/AA, serious and critical) at 1280 px and 390 px with no sideways scroll.

## Not verified here

- A real email delivery (needs the owner's Resend account and domain, docs/SELF_SIGNUP.md §6).
- A live ProPublica call from the deployed server (the API's terms and response shape were read on 7 November 2026; tests use fixtures).
- CI's secret scan, dependency audit and SBOM run on the pull request.
