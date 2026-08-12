# PROJECT CLOSEOUT — Content OS

Living handoff document. Last updated: 2026-08-11.

## Scope delivered

Content OS: single-user-per-instance AI content pipeline (brands → projects → research → sources → claims → outline → AI drafting → quality → export), with session auth, per-user data isolation, activity trail, and PDF/DOCX/MD/HTML/TXT export.

Explicitly **deferred** (not built, by product decision): grant management, multi-organization tenancy, clients, calendar/scheduling, asset library, third-party integrations beyond AI providers.

## Security & auth state

- Session auth (scrypt hashes, `connect-pg-simple` Postgres store, 15-min pruning, session regenerated on login).
- Login lockout: 5 failures / 15 min / IP (IPv6-subnet-normalized key, reset on success). Registration: 10 / 15 min.
- All routes except `/api/healthz` + `/api/auth/*` behind `requireAuth`.
- Ownership enforced server-side per request (`middleware/ownershipHelpers.ts`); PATCH endpoints use field allowlists.
- Export downloads: ownership check + path-traversal rejection + format allowlist (txt/md/markdown/docx/pdf/html).
- PDF upload: orphaned storage objects deleted if DB insert fails; accepts multipart field `pdf` or `file`.

## Data model notes

- Ownership is `userId`-based throughout; no organization layer exists.
- `activity_log` has a `user_id` column (migration 0003); the dashboard feed scopes by actor OR the user's projects (legacy rows lack `user_id`).
- Document sections link to projects through `documents` (`document_sections.document_id → documents.project_id`) — no direct `project_id` on sections.
- Extracted source text lives in `sources.extracted_text` (no `extracted_content`/`page_count` columns — older code referencing those silently dropped data).

## Migrations

`lib/db/drizzle/`: 0000 source file path, 0001 auth users, 0002 session table, 0003 activity_log.user_id. Applied at API startup; verify `[migrate] Migrations complete` in logs after deploys.

## Testing

- API: 35 vitest tests (routes, orchestration, PATCH hardening) — all passing.
- Frontend: ~10 vitest/RTL tests on the Create flow — passing.
- No e2e/browser test harness (Playwright/Cypress) exists; smoke testing is manual curl-based.
- Known pre-existing: 6 frontend typecheck errors in `BrandDetail.tsx`/`BrandsList.tsx` (generated-type mismatches) — untouched, not introduced by recent work.

## Known limitations

- `pdf-parse` (v1) cannot parse pdfkit-generated or hand-built PDFs ("bad XRef entry"); real-world PDFs work. Test uploads only with real PDFs.
- Export generation buffers fully in memory; no size cap on exported documents.
- Rate limiting is in-memory (single instance) — counters reset on process restart.
- Analytics page (if reached) shows only dashboard stats; no dedicated analytics pipeline.

## Operational notes

- API dev = esbuild bundle + node run; the runtime does NOT typecheck — run `pnpm exec tsc -b --force` after API changes.
- Health endpoint: `GET /api/healthz` → `{status:"ok"}`.
- Restart persistence verified: sessions, projects, sources, and activity survive restarts (Postgres-backed).
- No GitHub remote is connected to this workspace; commits are local (Replit checkpoints) until a remote is added.

## Recommended immediate production action

1. Connect the canonical GitHub repo/branch and push (owner action — URL/credentials pending).
2. Publish via Replit deployment; confirm `[migrate] Migrations complete` + `/api/healthz` on the production URL.
3. Set `SESSION_SECRET` and at least one AI provider key in production secrets.
