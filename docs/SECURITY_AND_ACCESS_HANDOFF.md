# Security and Access Handoff

How access to Content Machine works, who controls it, and which controls protect it. Owner: `ebyron357`. No secret values appear in this repository. Updated 4 November 2026 for workspaces and personal accounts (R1, step 1 of `GRANT_PLATFORM_PLAN.md`).

## 1. Account model (actual behaviour)

Content Machine is organized into **workspaces**. A workspace is one organization: the agency itself, or a client nonprofit or business. Every record belongs to exactly one workspace, and no workspace can read or change another's records.

- **How isolation works.** Each workspace owns its data through its own principal row in `users`. When someone signs in to a workspace, the session carries that principal as `session.userId`. The ownership check that every route already performs therefore limits them to that workspace: brands, projects, documents, media, exports, publishing, API keys, webhooks and all of Grant Studio. A record from another workspace is a 404.
- **Personal accounts (members).** A member signs in with their email and password, and belongs to one or more workspaces, each with a role. Passwords are hashed with scrypt (random salt, 64-byte key) and must be at least 12 characters, not repetitive, and not contain the email name. Emails are stored lowercased.
- **Invitations.** An owner or admin invites someone by email and role, and gets a one-time link (`/invite/<token>`). It works once, expires after 7 days, can be withdrawn, and only a SHA-256 hash of the token is stored. A new invitation for the same email replaces any open one. The person chooses their name and password when they accept. Someone who already has an account confirms it with their password instead. No email is sent by the product yet (an email provider is owner decision D7), so the inviter sends the link.
- **The agency workspace and the team password.** The `ADMIN_PASSWORD` sign-in still works. It signs in to the agency workspace as its owner, with no personal identity, and the agency workspace is created automatically on first use. It is kept so operations and the smoke test keep working; personal accounts are preferred because they record who did what and can be removed one by one.
- **Client workspaces.** An admin-unlocked operator creates a client workspace (Settings → Team → Client workspaces) and gets an invitation link for its first owner. The owner then invites their own team.
- **Approvals and records name the person.** Grant Studio approvals, confirmations and outcomes record the signed-in member's name. With the team password they record the operator account.
- **Sessions.** The session is regenerated at every member sign-in, so a session ID cannot be fixed in advance. On every request a member's membership is re-checked (cached for at most 10 seconds, and cleared immediately when a membership changes). A removed or disabled member therefore loses access on their next request, and a role change applies at once.

## 2. Roles and permissions

| Role | Can do now (R1 step 1) | Planned limits (R1 step 2, permissions) |
|---|---|---|
| Owner | Everything in the workspace, including members, roles and the workspace name. Only an owner can create or remove another owner. A workspace always keeps at least one owner | — |
| Admin | Everything in the workspace, including inviting, changing roles and removing members, except anything that touches an owner | — |
| Writer, reviewer, authorized representative, finance, viewer | Everything in the workspace's data; cannot manage members | Writer: no package approval. Reviewer: approves sections. Authorized representative: approves packages and records submissions. Finance: budgets and awards. Viewer: read only |

| Actor | How they authenticate | Can do | Cannot do |
|---|---|---|---|
| Anonymous visitor | — | See the sign-in and invitation pages; call `/api/healthz`, `/api/readyz` | Read or change any workspace data (401) |
| Member | Email and password → `sid` session cookie (HttpOnly, Secure, SameSite=Lax, 7-day lifetime, stored in PostgreSQL) | Their workspaces, according to role | Reach any workspace they do not belong to |
| Team password | `ADMIN_PASSWORD` → session as owner of the agency workspace | The agency workspace | Reach client workspaces |
| Admin-elevated session | Settings → Security → re-enter `ADMIN_PASSWORD` (`/api/auth/admin-unlock`) | Additionally: model configuration, provider tests, blueprint and dependency changes, `/api/seed`, creating and listing client workspaces | Read client workspace data |
| Automation client | `Authorization: Bearer <API key>` created in Settings → Automation | Only the key's scopes, in the workspace that created it (`docs/automation-api.md`) | Use the browser UI; act outside its scopes |
| Render account owner | Render dashboard | Deploy, roll back, view logs, change secrets, restore data | — |
| GitHub maintainers | GitHub | Change code through reviewed PRs; CI gates merges | Deploy (deploys are manual in Render) |

## 3. Provisioning and removing access

**Give someone access:** Settings → Team → Invite someone. Choose their role, copy the link, and send it to them through a channel you trust. The link works once and expires in 7 days.

**Change a role or remove someone:** Settings → Team → Members. Removal takes effect on the person's next request. Also revoke any API keys they created (Settings → Automation), and remove them from Render and GitHub if they had access there.

**Forgotten member password:** there is no email reset yet. An owner or admin removes the member and invites them again; they choose a new password when they accept. A member who knows their password changes it in Settings → Team → Your account.

**Team password:** the owner sets a new `ADMIN_PASSWORD` in Render → Environment → Save and deploy, which is also the recovery path if it is lost. To sign everyone out at once (members included), regenerate `SESSION_SECRET` in the same change. Rotate the team password whenever someone who knew it leaves.

**Lockout:** five failed sign-ins from one IP lock that IP for 15 minutes, for member and team-password sign-ins alike. Invitation pages are limited to 20 attempts per 15 minutes per IP. All of these limits are persisted in PostgreSQL. Failed member sign-ins return the same message whether the email exists or not, and take the same time.

## 4. Access register

Keep this current at handoff (names and roles only, never credentials). Settings → Team is the live list of each workspace's members.

| Person | Role | Access | Granted | Removed |
|---|---|---|---|---|
| Emmanuel Andre Byron (`ebyron357`) | Owner, administrator | Team password, Render account, GitHub owner | Project start | — |

## 5. Secrets register

| Secret | Stored in | Owner | Rotation |
|---|---|---|---|
| `ADMIN_PASSWORD` | Render environment; owner's password manager | Owner | On staff change or suspected exposure |
| `SESSION_SECRET` | Render environment (generated) | Owner | When signing everyone out |
| Member passwords | scrypt hash only, in PostgreSQL | Each member | By the member, in Settings → Team |
| Invitation tokens | SHA-256 hash only, in PostgreSQL; the link is shown once | Inviter | Expire in 7 days; can be withdrawn |
| `DATABASE_URL` | Render (from the database) | Render / owner | Managed by Render |
| `OPENAI_API_KEY` (or Anthropic / Gemini key) | Render environment | Owner (provider billing account) | Yearly or on exposure; revoke the old key at the provider |
| `TYPEFULLY_API_KEY` (optional) | Render environment | Owner | On exposure |
| Automation API keys | Hash only in PostgreSQL; raw value shown once at creation | Creator | Revoke in Settings → Automation |
| Webhook signing secrets | PostgreSQL; shown once at creation or rotation | Owner | Settings → Automation → Rotate signing secret |

## 6. Security controls in place

- All data routes require a session or a scoped API key; anonymous requests receive 401 (verified by `tests/production-smoke.sh` and the integration suite).
- Workspace isolation follows from ownership checks on every record. `routes/workspaces.integration.test.ts` signs in to two workspaces and checks, in both directions, that brands and Grant Studio records of one are 404 in the other. The database-backed API tests cover the other cross-user cases.
- Membership is re-checked on each request; removal, role changes and disabled accounts apply at once. Owners and the last owner are protected from admins.
- Session regeneration at member sign-in; secure session cookie; `trust proxy` for Render's TLS edge; `SESSION_SECRET` required at startup.
- Rate limits: sign-in and admin unlock (5 / 15 min / IP); invitations (20 / 15 min / IP); image upload (20 / 10 min); image serving (120 / min).
- Rich text is sanitized server-side with an allowlist; scripts, event handlers and unsafe URLs are removed.
- Image uploads: JPEG, PNG, GIF or WebP only, verified by file signature, 10 MB maximum, alt text required, served only to the owning workspace with `nosniff` and a restrictive CSP. Source PDFs up to 50 MB. Video embeds limited to YouTube and Vimeo HTTPS URLs.
- Exports and downloads: format allowlist, ownership check, path-traversal rejection.
- Outbound source fetching and webhooks use DNS-rebinding-safe URL validation.
- Supply chain: `pnpm install --frozen-lockfile`, `pnpm audit --audit-level=high`, gitleaks secret scanning and a CycloneDX SBOM on every PR.
- Accessibility and UI regressions are gated in CI (`e2e/accessibility.spec.ts`, `e2e/accounts.spec.ts`).

## 7. Residual risks accepted for this release

| Risk | Mitigation |
|---|---|
| Roles other than owner and admin do not yet limit what a member can do with the workspace's data | Invite only people who need full access until R1 step 2 adds per-role permissions; roles are already recorded so the limits apply as soon as they ship |
| No two-factor sign-in, no audit log screen, no "sign out everywhere" yet | Planned in R1 step 3; the activity log already records sign-ins, invitations, role changes and removals |
| No email delivery: invitations are links the inviter sends, and there is no email password reset | Links work once and expire; a forgotten password is handled by re-inviting (§3) |
| The team password has no personal identity | Prefer personal accounts; rotate the team password on every departure |
| Single instance with local disk | Daily disk snapshots, database PITR, documented rollback and restore |
| AI provider receives document content for generation | Use a provider account whose data-use terms the owner accepts; demo mode sends nothing externally |

Report a suspected security issue to the owner privately (see `TROUBLESHOOTING_AND_SUPPORT.md`), not in a public GitHub issue.
