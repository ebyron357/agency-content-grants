# Recovery Provenance

## Recovery record

- Recovery date: 2026-08-12
- Recovery archive: `content-machine-export.zip`
- Archive SHA-256: `3935222D882B46A4D4F1551A620CF170EF3D474FDAA790ED4A22EDCF3F3AE91F`
- Original project: Replit-hosted Content OS / Content Machine application
- Target repository: `ebyron357/agency-content-grants`
- Recovery branch: `recovery/replit-content-machine-source`

The archive contained no Git history, branches, tags, remote configuration, or
deployment commit identifier. It therefore cannot prove which source revision
produced the former Replit deployment or establish a deployed Replit SHA.

## Imported source

The recovery preserves the existing GitHub governance documents and imports the
application workspace, including:

- `artifacts/content-os`
- `artifacts/api-server`
- `artifacts/mockup-sandbox`
- `lib/db`
- `lib/api-spec`
- `lib/api-client-react`
- `lib/api-zod`
- `scripts`
- root `src`
- `tests`
- database migrations
- workspace manifests and `pnpm-lock.yaml`
- Replit configuration retained as historical migration evidence
- recovered application documentation

The archive's root `README.md` was imported as
`docs/recovery/REPLIT_SOURCE_README.md` so it would not replace the canonical
GitHub governance README.

## Excluded material

- `attached_assets/`: prompt and conversation attachments, excluded as
  non-source material with potential personal or customer context.
- `.agents/`: Replit-local agent memory and execution context.
- `.canvas/`: Replit-local generated canvas assets not required by the declared
  application workspace.
- `data/exports/`: generated export output.
- `artifacts/api-server/data/exports/`: generated PDF and DOCX output, including
  historical E2E artifacts.
- `node_modules/`, build output, caches, logs, local databases, `.env` files,
  and private-key files: excluded by policy and enforced in `.gitignore`.

The included `artifacts/api-server/.env.example` contains placeholders only and
is retained as configuration documentation. No real credentials, private keys,
access tokens, database credentials, or sensitive customer data were identified
by the recovery scan.

## Known ambiguity

The archive contains multiple frontend-related trees:

- `artifacts/content-os`, identified by the workspace and recovered README as
  the intended production frontend.
- root `src`, an alternate or earlier frontend tree outside the declared pnpm
  workspace.
- `artifacts/mockup-sandbox`, a design and component-preview application.

Recovery intentionally preserves all three. No tree was silently deleted,
merged, renamed, or treated as authoritative beyond the evidence recorded
above. Consolidation requires a separate, reviewed decision after recovery.

## Governance and deployment boundary

This commit is a preservation baseline, not evidence that the recovered
application is approved for production under the repository's Stage 0 gates.
No Replit project was modified, no deployment was performed, and the archive
cannot demonstrate that a live deployment matched these files.

## Recovery-only compatibility adjustment

The recovered root `preinstall` script used the Unix-only `sh` command and
failed on Windows after dependency resolution. Recovery replaced that shell
one-liner with `scripts/enforce-pnpm.mjs`, preserving its two behaviors:
removing non-pnpm lockfiles and rejecting package managers other than pnpm.
pnpm 11 also required an explicit `allowBuilds.esbuild: true` decision for the
already pinned `esbuild` build dependency; no other dependency build scripts
were newly authorized. Recovered negative optional-dependency overrides for the
current Windows platform were removed for esbuild, Rollup, Lightning CSS, and
Tailwind CSS Oxide so
the lockfile can install the binaries required by typecheck, tests, and builds.
No product feature behavior was changed.
