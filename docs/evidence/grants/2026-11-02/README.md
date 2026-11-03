# Grant directory verification — November 2, 2026

Baseline: `6d62fbaf58426a4cdacbee24765e327b629a96f7`.

## Passed locally

- `pnpm install --frozen-lockfile`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm run format:check`
- `pnpm --filter @workspace/content-os test` — 27 tests
- `pnpm --filter @workspace/api-server test:unit` — 137 Vitest tests and 17 Node guard tests
- `pnpm audit --audit-level=high` — exit 0; two moderate findings, no high/critical
- `git diff --check`
- Grant Playwright suite — 3 tests, with axe checks at desktop and mobile widths. Local-only config used Chromium Headless Shell 134 because pinned browser archives could not be downloaded. It launched the production frontend preview at 127.0.0.1 in the same process tree. The temporary config is not committed.

## Browser evidence

[Desktop screenshot](grants-1440.png) · [Mobile screenshot](grants-390.png)

These show synthetic authentication UI fixtures against a local production frontend build, not a live deployment. The catalog itself is real primary-source research. The tests exercise combined filters, cash-versus-credit labeling, source links, empty-state recovery, named navigation, mobile overflow and accessibility. The existing real-session accessibility suite also gains the grant route and mobile navigation name; its hosted result must be inspected separately.

## Not established locally

No local PostgreSQL/Docker was available for database-backed suites or the real-session gate. No application was submitted, no funds were awarded and no production deploy was performed. Hosted CI is required before merge. Production remains subject to the existing authenticated smoke/log verification gate.

## Source provenance

Each of the 21 entries in `artifacts/content-os/src/data/grants.ts` contains official source links and `checkedOn: 2026-11-02`. The directory explicitly distinguishes grants, partner-led funding, credits, software, fundraising and discovery. The manual update and freshness rules are in [GRANT_RESOURCES.md](../../../GRANT_RESOURCES.md).
