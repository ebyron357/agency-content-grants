# Security and Access Handoff

How access to Content Machine works, who controls it, and which controls protect it. Owner: `ebyron357`. No secret values appear in this repository.

## 1. Account model (actual behaviour)

Content Machine has **one built-in workspace account** named `admin`. There is no public sign-up, no per-person username or e-mail login, no invitation flow and no e-mail password reset.

- **Sign-in:** open the production URL; enter the workspace password. The password is the `ADMIN_PASSWORD` environment variable on the Render service.
- **First login:** the `admin` account is created automatically when the service first starts. There is no separate first-login password change; the owner chooses the password when creating the Render blueprint.
- **Username / e-mail format:** not applicable — the sign-in form asks only for the password.
- **Data ownership in the app:** every brand, project, document, image and export belongs to the `admin` account. The API enforces ownership on every record, so records from any other account (for example restored from another environment) are never served.

## 2. Roles and permissions

| Actor | How they authenticate | Can do | Cannot do |
|---|---|---|---|
| Anonymous visitor | — | See the sign-in page; call `/api/healthz`, `/api/readyz` | Read or change any workspace data (401) |
| Signed-in user | Workspace password → `sid` session cookie (HttpOnly, Secure, SameSite=Lax, 7-day lifetime, stored in PostgreSQL) | Everything in the workspace: brands, documents, editing, media, exports, distribution, performance, API keys, webhooks | Change global settings without admin elevation |
| Admin-elevated session | Settings → Security → re-enter the same password (`/api/auth/admin-unlock`) | Additionally: model configuration, provider connection tests, blueprint and dependency-registry changes, `/api/seed` | — |
| Automation client | `Authorization: Bearer <API key>` created in Settings → Automation | Only the scopes granted to the key: `read`, `projects:write`, `repurposing:write`, `publishing:write` (`docs/automation-api.md`) | Use the browser UI; act outside its scopes |
| Render account owner | Render dashboard | Deploy, roll back, view logs, change secrets, restore data | — |
| GitHub maintainers | GitHub | Change code via reviewed PRs; CI gates merges | Deploy (deploys are manual in Render) |

## 3. Provisioning and removing access

**Give someone access:** share the production URL and the workspace password through a password manager share or another end-to-end encrypted channel. Never send it in e-mail, chat, tickets or documents. Record who has it in the access register below.

**Change the password / recover access:** the owner sets a new `ADMIN_PASSWORD` in Render → Environment → Save and deploy. This is also the recovery path if the password is lost. To sign everyone out at the same time, regenerate `SESSION_SECRET` in the same change.

**Remove someone's access (offboarding):** rotate `ADMIN_PASSWORD` **and** `SESSION_SECRET`, revoke any API keys they created (Settings → Automation), remove them from the Render team and GitHub collaborators if applicable, and share the new password with remaining users.

**Lockout:** five failed sign-ins from one IP lock that IP out for 15 minutes (persisted in PostgreSQL, survives restarts). A successful sign-in resets the counter.

## 4. Access register

Keep this current at handoff (names and roles only — never credentials):

| Person | Role | Access | Granted | Removed |
|---|---|---|---|---|
| Emmanuel Andre Byron (`ebyron357`) | Owner, administrator | Workspace password, Render account, GitHub owner | Project start | — |

## 5. Secrets register

| Secret | Stored in | Owner | Rotation |
|---|---|---|---|
| `ADMIN_PASSWORD` | Render environment; owner's password manager | Owner | On staff change or suspected exposure |
| `SESSION_SECRET` | Render environment (generated) | Owner | With password rotation when removing access |
| `DATABASE_URL` | Render (from the database) | Render / owner | Managed by Render |
| `OPENAI_API_KEY` (or Anthropic / Gemini key) | Render environment | Owner (provider billing account) | Yearly or on exposure; revoke old key at provider |
| `TYPEFULLY_API_KEY` (optional) | Render environment | Owner | On exposure |
| Automation API keys | Hash only in PostgreSQL; raw value shown once at creation | Creator | Revoke in Settings → Automation |
| Webhook signing secrets | PostgreSQL; shown once at creation or rotation | Owner | Settings → Automation → Rotate signing secret |

## 6. Security controls in place

- All data routes require a session or scoped API key; anonymous requests receive 401 (verified by `tests/production-smoke.sh` and the integration suite).
- Ownership is enforced server-side for brands, projects, sources, claims, outlines, sections, media, exports, publications, API keys and webhooks; unknown or foreign IDs return 404. Cross-user isolation is covered by the database-backed API tests.
- Secure session cookie, `trust proxy` for Render's TLS edge, SESSION_SECRET required at startup.
- Rate limits: sign-in and admin unlock (5 / 15 min / IP, PostgreSQL-backed); image upload (20 / 10 min); image serving (120 / min).
- Rich text is sanitised server-side with an allowlist; scripts, event handlers and unsafe URLs are removed.
- Image uploads: JPEG, PNG, GIF or WebP only, verified by file signature, 10 MB maximum, alt text required, served only to the owner with `nosniff` and a restrictive CSP. Source PDFs up to 50 MB. Video embeds limited to YouTube and Vimeo HTTPS URLs.
- Exports and downloads: format allowlist, ownership check, path-traversal rejection.
- Outbound source fetching and webhooks use DNS-rebinding-safe URL validation.
- Supply chain: `pnpm install --frozen-lockfile`, `pnpm audit --audit-level=high` (0 known vulnerabilities on 2 Oct 2026), gitleaks secret scanning and a CycloneDX SBOM on every PR.
- Accessibility and UI regressions are gated in CI (`e2e/accessibility.spec.ts`).

## 7. Residual risks accepted for this release

| Risk | Mitigation |
|---|---|
| One shared password for all users; no per-person audit identity | Keep the user group small; rotate on every departure; activity log records actions per workspace |
| Single instance with local disk | Daily disk snapshots, database PITR, documented rollback and restore |
| AI provider receives document content for generation | Use a provider account whose data-use terms the owner accepts; demo mode sends nothing externally |

Report a suspected security issue to the owner privately (see `TROUBLESHOOTING_AND_SUPPORT.md`), not in a public GitHub issue.
