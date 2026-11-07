# Evidence: GrantCrest brand, user guide and UX polish (7 November 2026)

Branch `feat/grantcrest-brand-guide`, based on `main` `3635a0a`. Owner request: on 6 November 2026, in a Claude conversation, the owner asked to keep building the full plan toward an enterprise-grade public launch on 4 December 2026, for flawless UI/UX and for docs that include a clear user guide; the product is being renamed **GrantCrest** (grantcrest.co). Plan: the Claude Doc "Grant Platform: End-to-End Build, Cost, Pricing and Launch Plan", build map, week 2. No other written approval is claimed.

## What changed

- **Name.** Every user-facing "Content OS" / "Content Machine" product name now reads **GrantCrest**: `<title>`, description, Open Graph and Twitter tags (plus `og:site_name`, `og:url` https://grantcrest.co, `application-name`), favicon, rail logo and tagline, sign-in, invitation and two-factor screens, dashboard, Create, Documents and Settings copy, the recovery-code file (`grantcrest-recovery-codes.txt`), the authenticator entry (TOTP issuer), DOCX and PDF export metadata, the grant package footer ("Prepared in GrantCrest (grantcrest.co) on …"), the calendar `PRODID`, and the Stripe app name. "Grant Studio" stays the name of the grant workspace; "Content Machine" stays only where it describes the content features. Not changed: repository, package, route, env var, database and Render service names, `render.yaml`, and the outbound `User-Agent` of the source fetcher.
- **Grants.gov notice.** "This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services." is shown on Grant Studio, every organization and opportunity page, the curated directory (Grants), the in-app guide, and in a new footer on every signed-in page. One constant: `GRANTS_GOV_NOTICE` in `artifacts/content-os/src/components/layout/Brand.tsx`.
- **User guide.** `docs/USER_GUIDE.md`, written for grant writers and agency owners, rendered in the app at `/help` (a **Help** item in the rail and **Help and user guide** in the footer) from the same file, so they cannot drift. Linked from README, the user manual, the admin manual, troubleshooting and the document ownership map.
- **UX polish.** Error messages go through one helper (`friendlyError`, `src/lib/api.ts`): the server's own message, otherwise a plain sentence for the kind of failure; never `POST /path failed: 500 …` or an HTML error page. The blank "Continue working" panel on the dashboard (no brands yet) now says what to do. The duplicated "Opportunity not found / Opportunity not found" error now explains why. The Settings dependency list has loading and error states, a meaningful empty state, `aria-pressed` filter buttons, and hides a filter row that only had "All". Billing-off text no longer shows an env var name. Title Case labels changed to sentence case (Model configuration, API keys, Webhook subscriptions). Automation empty states say what to do next. Grant Studio's empty state says it finds federal **and state** opportunities.

## Grants.gov wording check

`https://grants.gov/api/terms-conditions` could not be opened from this environment (the fetch permission request timed out). The wording above was checked against a dated third-party capture of that page (tostracker.app, captured 22 February 2026: "This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.", with the rule that services using the API display it prominently). It matches the text already recorded in `docs/SOURCE_REGISTRY.md` on 5 November. **Owner action:** confirm it on the official page.

## Validation (local, 6–7 November 2026)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm run format:check` | pass |
| `pnpm run typecheck` | pass |
| `pnpm --filter @workspace/api-server test:unit` | 335 passed (30 files) + 17 node tests |
| `test:db:prepare` + `pnpm --filter @workspace/api-server test` (PostgreSQL 16, disposable `brand_api_test`) | 591 passed (60 files) |
| `pnpm --filter @workspace/content-os test` | 48 passed (11 files), including the new `friendlyError` and Help/guide tests |
| `tests/integration-tests.sh` against the built server | 40 passed, 0 failed, 0 skipped (run on port 8095; the script's port was substituted in a scratch copy) |
| Playwright + axe, full `e2e/` suite against the built server | 14 passed |
| `pnpm run build` | pass |

The accessibility gate now also covers `/help`, checks the `GrantCrest` page title, the Grants.gov notice on Grant Studio and Grants and in the footer, that the footer opens the guide, that a contents link jumps to its section, and that **Help** is reachable on the 390 px rail.

Local run notes: the server served the built frontend through `FRONTEND_DIST_PATH` pointing at a symlink, because Express's `sendFile` refuses paths containing a dot-directory (`.claude/worktrees`); CI paths are unaffected.

## Screenshots

`before-*` are `main` `3635a0a`, except `before-opportunity-missing`, `before-settings-dependencies`, `before-settings-automation` and `before-settings-model-configuration`, which were taken after the rename but before the polish of those screens. `after-*` are this branch. 1280 px shots are full page; 390 px and the inner screens are the viewport. After shots of the dashboard show data left by the test runs, so its empty-state fix is visible in code and not in the after shot.

| Screen | Before | After |
|---|---|---|
| Sign in | `before-login-1280.png`, `before-login-390.png` | `after-login-1280.png`, `after-login-390.png` |
| Grant Studio | `before-grant-studio-1280.png`, `-390` | `after-grant-studio-1280.png`, `-390` (notice and footer) |
| Dashboard | `before-dashboard-1280.png` (blank Continue working panel) | `after-dashboard-1280.png` |
| Documents, 390 px | `before-documents-390.png` | `after-documents-390.png` |
| Settings | `before-settings-1280.png` | `after-settings-1280.png` |
| 404 | `before-not-found-1280.png` | `after-not-found-1280.png` |
| Missing opportunity | `before-opportunity-missing.png` | `after-opportunity-missing.png` |
| Settings tabs | `before-settings-{dependencies,automation,model-configuration}.png` | `after-settings-…` |
| New | — | `after-help-1280.png`, `after-help-390.png`, `after-grants-390.png`, `after-org-matches.png` |

## Not verified / follow-ups

- The official Grants.gov terms page (above).
- The `grants_gov` source registry row's stored terms note (seeded by migration `0031`) still says the notice is not shown; this PR adds no migration. An admin updates it in **Settings → Sources**.
- There is no web app manifest and no outbound email in the product, so there were none to rename.
- Existing authenticator entries keep the name "Content Machine" until a person turns two-factor off and on again; codes keep working.
