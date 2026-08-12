# Content OS

An AI-assisted content production system: define a brand, create a project, generate a research plan, curate sources, extract claims, build an outline, draft sections with AI, evaluate quality, and export the finished document.

## Product status

Working application under active polish. Core pipeline (brands → projects → research → sources → claims → outline → drafting → quality → export) is functional end-to-end with persistence, authentication, and per-user data isolation.

## Major capabilities

- **Brands** — voice, tone, vocabulary, audience profiles, and fact bases that ground all generation
- **Projects** — full content briefs (audience, intent, length, POV, citation requirements)
- **Research** — AI-generated research plans with questions and approval step
- **Sources** — URL/PDF sources; PDF upload with text extraction, re-extraction, and original-file download; approve/reject workflow
- **Claims** — extracted factual claims tied to sources
- **Outlines & drafting** — AI outline → per-section AI drafting, editing, regeneration with revision history
- **Quality** — automated scoring (tone, fact accuracy) with issue lists
- **Exports** — PDF, DOCX, Markdown, HTML, TXT with export history
- **Dashboard** — stats and per-user activity feed (logins, brand/project/source/section/export events)
- **Auth** — session login with rate limiting and login lockout; sessions persist across restarts

## Architecture

pnpm monorepo:

```
artifacts/
  api-server/     Express 5 + Drizzle ORM API (TypeScript, esbuild bundle)
  content-os/     React + Vite + shadcn/ui + TanStack Query frontend
  mockup-sandbox/ Component preview sandbox (design tooling)
lib/
  db/             Shared Drizzle schema + migrations (drizzle/)
```

- Frontend calls the API at `${BASE_PATH}api/...` with `credentials: "include"`.
- All API routes except `/api/healthz` and `/api/auth/*` require a session.
- Every tenant-owned record is scoped by `userId`; ownership is verified server-side on every read/write (see `middleware/ownershipHelpers.ts`).
- AI calls route through `lib/ai/router.ts` with per-provider config stored in the DB.

## Technology stack

Node 24, Express 5, Drizzle ORM, PostgreSQL (Replit-managed), connect-pg-simple sessions, multer, pdf-parse, pdfkit, docx, express-rate-limit, pino. Frontend: React 19, Vite 7, Tailwind 4, shadcn/ui (Radix), TanStack Query, wouter.

## Development

```bash
pnpm install
pnpm --filter @workspace/api-server run dev    # API on :8080 (runs migrations at startup)
pnpm --filter @workspace/content-os run dev    # Vite dev server
```

Typecheck: `pnpm exec tsc -b --force` (api-server) / `pnpm --filter @workspace/content-os run typecheck`.

## Environment variables

See `artifacts/api-server/.env.example`. Critical: `SESSION_SECRET`, `DATABASE_URL` (auto on Replit), at least one AI provider key. The server fails clearly at startup if required config is missing.

## Database

Schema lives in `lib/db/src/schema/*`. Migrations are SQL files in `lib/db/drizzle/` with a journal in `lib/db/drizzle/meta/_journal.json`; they are applied automatically at API startup (`[migrate]` log lines). New migrations: add the SQL file, append a journal entry with the next `idx`.

## Tests

```bash
pnpm --filter @workspace/api-server test    # vitest, 35 tests (routes, orchestration, patch hardening)
pnpm --filter @workspace/content-os test    # vitest + React Testing Library
```

## Production build

```bash
pnpm run build                              # typecheck + build all packages
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

Frontend builds to `artifacts/content-os/dist/public` and is served statically with SPA fallback.

## Security notes

- Passwords hashed with scrypt; login is rate-limited (5 failures / 15 min / IP, reset on success; IPv6-subnet-safe keys) and registration limited to 10/15 min.
- Sessions regenerate on login (fixation protection) and are pruned every 15 minutes.
- PATCH endpoints use explicit field allowlists — no mass assignment.
- Export downloads validate ownership and reject path traversal.
- PDF upload cleans up orphaned storage objects if the DB insert fails.
- No secrets are logged; error responses do not expose internals.
