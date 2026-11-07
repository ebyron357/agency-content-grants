# Security and Access Handoff

How access to GrantCrest (formerly Content Machine) works, who controls it, and which controls protect it. Owner: `ebyron357`. No secret values appear in this repository. Updated 4 November 2026 for account security (R1, step 3 of `GRANT_PLATFORM_PLAN.md`): two-factor sign-in, per-browser sessions, sign-out everywhere and the audit log. Step 1 was workspaces and personal accounts; step 2 was per-role permissions.

## 1. Account model (actual behaviour)

GrantCrest is organized into **workspaces**. A workspace is one organization: the agency itself, or a client nonprofit or business. Every record belongs to exactly one workspace, and no workspace can read or change another's records.

- **How isolation works.** Each workspace owns its data through its own principal row in `users`. When someone signs in to a workspace, the session carries that principal as `session.userId`. The ownership check that every route already performs therefore limits them to that workspace: brands, projects, documents, media, exports, publishing, API keys, webhooks and all of Grant Studio. A record from another workspace is a 404.
- **Personal accounts (members).** A member signs in with their email and password, and belongs to one or more workspaces, each with a role. Passwords are hashed with scrypt (random salt, 64-byte key) and must be at least 12 characters, not repetitive, and not contain the email name. Emails are stored lowercased.
- **Roles limit what a member can do** (§2). The rules live in one policy file, `artifacts/api-server/src/lib/permissions.ts`, and are enforced on every request before the route runs. The UI reads the same rules from the API, so it only offers actions that will work, and **Settings → Team → What each role can do** shows the table.
- **Invitations.** An owner or admin invites someone by email and role, and gets a one-time link (`/invite/<token>`). It works once, expires after 7 days, can be withdrawn, and only a SHA-256 hash of the token is stored. A new invitation for the same email replaces any open one. The person chooses their name and password when they accept. Someone who already has an account confirms it with their password instead. No email is sent by the product yet (an email provider is owner decision D7), so the inviter sends the link.
- **The agency workspace and the team password.** The `ADMIN_PASSWORD` sign-in still works. It signs in to the agency workspace as its owner, with no personal identity, and the agency workspace is created automatically on first use. It is kept so operations and the smoke test keep working; personal accounts are preferred because they record who did what and can be removed one by one.
- **Client workspaces.** An admin-unlocked operator creates a client workspace (Settings → Team → Client workspaces) and gets an invitation link for its first owner. The owner then invites their own team.
- **Approvals and records name the person.** Grant Studio approvals, confirmations and outcomes record the signed-in member's name. With the team password they record the operator account.
- **Two-factor sign-in.** A member can add an authenticator app (TOTP, RFC 6238: 6 digits, 30-second steps, one step of clock drift either way). Sign-in then takes the password and a current code. Each code works once: the last accepted step is stored, and a code is claimed with a conditional update, so two requests with the same code cannot both succeed. A pending sign-in expires after 5 minutes or 5 wrong codes. Codes are also limited to 5 failures per 15 minutes per IP. The setup QR code is drawn in the browser, so the secret never goes to a third party. Secrets are encrypted at rest with AES-256-GCM under `MFA_ENCRYPTION_KEY`. Without that key they are stored unencrypted, marked as such, and Settings warns.
- **Recovery codes.** Turning on two-factor issues 10 single-use recovery codes (about 50 bits each), shown once, with copy and download. Only SHA-256 hashes are stored. Making new codes, or turning two-factor off, needs a current code; turning it off also needs the password.
- **Requiring two-factor.** An owner or admin can require it for the workspace, after turning it on for their own account. A member without it can then reach only their own account routes until they set it up; every other request gets 403 `mfa_enrollment_required`, and the app shows the setup screen. Nobody can turn it off for themselves while the workspace requires it.
- **Invitations and two-factor.** Joining another workspace with an existing account that has two-factor needs a code as well as the password, so an invitation is never a way around it.
- **Sessions.** The session is regenerated at every member sign-in, so a session ID cannot be fixed in advance. Each sign-in also gets a `member_sessions` row (browser, IP, method, last activity); the cookie carries its id. On every request the membership, role, account and that row are re-checked, cached for at most 10 seconds and cleared at once on any change. A removed or disabled member, or a browser signed out from elsewhere, therefore loses access on the next request, and a role change applies at once. Session callers of the automation API get the same check and permissions.
- **Sign-out everywhere.** Settings → Team → Where you're signed in lists a person's browsers and ends any of them, or all but the current one. Changing the password ends the other sign-ins automatically. Removing a member ends their sessions in that workspace.
- **Audit log.** Owners and admins read Settings → Team → Audit log: sign-ins (and whether two-factor or a recovery code was used), security changes, members and invitations, Grant Studio approvals and outcomes, and API keys and webhooks. They can filter by category, search, page back and export CSV (cells that would run as spreadsheet formulas are neutralized). Every entry records the signed-in person, taken from the request, so no route can forget it.

## 2. Roles and permissions

### Permissions

| Permission | Allows |
|---|---|
| `workspace.read` | See the workspace's data (every role) |
| `content.write` | Create and edit brands, projects, research, documents, media and exports |
| `content.publish` | Connect publishing destinations and schedule publications |
| `grants.write` | Edit organizations, facts, applications, requirements and drafts; run the section check |
| `grants.review` | Review, approve and reopen application sections |
| `grants.approve` | Approve the final package; record submissions and outcomes |
| `grants.finance` | Edit budgets and budget justification; record outcomes and award amounts |
| `automation.manage` | See and create API keys and webhooks |
| `members.manage` | Invite people, change roles and remove members; require two-factor; read and export the audit log |
| `workspace.configure` | Change AI providers, models, blueprints and dependencies (also needs admin unlock) |
| `billing.manage` | See and change the workspace's plan, trial and billing (Settings → Billing; `BILLING.md`) |

### Roles

| Role | Permissions | In practice |
|---|---|---|
| Owner | All | Everything, including members and the workspace. Only an owner can create or remove another owner. A workspace always keeps at least one owner |
| Admin | All except `billing.manage` | Everything except anything that touches an owner, and billing |
| Writer | read, content.write, content.publish, grants.write, grants.finance | Writes content and applications, including budgets. Cannot approve sections or the package |
| Reviewer | read, grants.review | Reads everything; reviews, approves and reopens sections. Cannot edit them |
| Authorized representative | read, grants.review, grants.approve | Approves sections and the final package; records submissions and outcomes |
| Finance | read, grants.finance | Edits budgets and records award amounts |
| Viewer | read | Read only. Cannot see API keys or webhooks |

Writing and approving are separated: the person who drafts a section cannot approve it unless they also hold an approving role, and only the authorized representative, an owner or an admin approves the package.

### How the rules are enforced

- `middleware/requirePermission.ts` runs after sign-in checks on every application route. It looks up the permission the request needs in `ROUTE_RULES` (first match wins). Reads not listed need `workspace.read`. A write that matches no rule needs `workspace.configure`, so an unclassified route is open only to owners and admins.
- A refused request returns **403** with `code: "forbidden_by_role"`, the permission it needed, and a message naming the roles that have it. The route handler does not run.
- `routes/permissions.coverage.test.ts` walks every route the API registers and fails if any write is unclassified or if any rule matches no route, so a new route cannot ship without a decision about who may call it.
- `routes/permissions.integration.test.ts` signs in as each role and checks both sides of its permissions over HTTP, including a role change applying on the next request.
- A person's own security routes (`/account/*`: two-factor, recovery codes, sessions) are open to every role, for their own account only.

### Actors

| Actor | How they authenticate | Can do | Cannot do |
|---|---|---|---|
| Anonymous visitor | — | See the sign-in and invitation pages; call `/api/healthz`, `/api/readyz` | Read or change any workspace data (401) |
| Member | Email and password, plus an authenticator or recovery code when two-factor is on → `sid` session cookie (HttpOnly, Secure, SameSite=Lax, 7-day lifetime, stored in PostgreSQL) with a revocable `member_sessions` row | Their workspaces, within their role's permissions | Reach any workspace they do not belong to; act beyond their role (403); use a workspace that requires two-factor before setting it up |
| Team password | `ADMIN_PASSWORD` → session as owner of the agency workspace | The agency workspace | Reach client workspaces |
| Admin-elevated session | Settings → Security → re-enter `ADMIN_PASSWORD` (`/api/auth/admin-unlock`) | Additionally: model configuration, provider tests, blueprint and dependency changes, `/api/seed`, creating and listing client workspaces | Read client workspace data |
| Automation client | `Authorization: Bearer <API key>` created in Settings → Automation | Only the key's scopes, in the workspace that created it (`docs/automation-api.md`) | Use the browser UI; act outside its scopes |
| Render account owner | Render dashboard | Deploy, roll back, view logs, change secrets, restore data | — |
| GitHub maintainers | GitHub | Change code through reviewed PRs; CI gates merges | Deploy (deploys are manual in Render) |

## 3. Provisioning and removing access

**Give someone access:** Settings → Team → Invite someone. Choose the narrowest role that fits (§2), copy the link, and send it to them through a channel you trust. The link works once and expires in 7 days.

**Change a role or remove someone:** Settings → Team → Members. Both take effect on the person's next request. Removal also ends their sessions in that workspace and revokes the API keys they created there. Remove them from Render and GitHub if they had access there.

**Require two-factor:** turn it on for your own account first (Settings → Team → Two-factor sign-in), then Settings → Team → Members → Require for everyone. The members list shows who has it.

**Lost phone:** the member signs in with a recovery code and sets two-factor up again. With no recovery codes left, an owner or admin removes and re-invites them.

**Suspected account compromise:** the person changes their password (which ends their other sessions) or uses Sign out everywhere else; an owner or admin can instead remove them at once. Check the audit log for what the account did.

**Forgotten member password:** there is no email reset yet. An owner or admin removes the member and invites them again; they choose a new password when they accept. A member who knows their password changes it in Settings → Team → Your account.

**Team password:** the owner sets a new `ADMIN_PASSWORD` in Render → Environment → Save and deploy, which is also the recovery path if it is lost. To sign everyone out at once (members included), regenerate `SESSION_SECRET` in the same change. Rotate the team password whenever someone who knew it leaves.

**Lockout:** five failed sign-ins from one IP lock that IP for 15 minutes, for member and team-password sign-ins alike. Two-factor codes have the same limit, and each pending sign-in allows 5 attempts. Invitation pages allow 20 failed attempts per 15 minutes per IP; successful lookups and acceptances do not count, so a team joining from one office is not blocked. All of these limits are persisted in PostgreSQL. Failed member sign-ins return the same message whether the email exists or not, and take the same time.

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
| `MFA_ENCRYPTION_KEY` | Render environment (generated; add it once on an existing service) | Owner | Do not rotate routinely; rotating makes existing two-factor secrets unreadable (runbook §10) |
| Two-factor secrets | AES-256-GCM ciphertext in PostgreSQL | Each member | Turn off and on again |
| Recovery codes | SHA-256 hash only, in PostgreSQL; shown once | Each member | Make new ones in Settings → Team |
| Member passwords | scrypt hash only, in PostgreSQL | Each member | By the member, in Settings → Team |
| Invitation tokens | SHA-256 hash only, in PostgreSQL; the link is shown once | Inviter | Expire in 7 days; can be withdrawn |
| `DATABASE_URL` | Render (from the database) | Render / owner | Managed by Render |
| `OPENAI_API_KEY` (or Anthropic / Gemini key) | Render environment | Owner (provider billing account) | Yearly or on exposure; revoke the old key at the provider |
| `TYPEFULLY_API_KEY` (optional) | Render environment | Owner | On exposure |
| Automation API keys | Hash only in PostgreSQL; raw value shown once at creation | Creator | Revoke in Settings → Automation |
| Webhook signing secrets | PostgreSQL; shown once at creation or rotation | Owner | Settings → Automation → Rotate signing secret |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (once billing is switched on) | Render environment only; never in `render.yaml` or git | Owner (Stripe account) | On exposure: roll the key in Stripe, and the endpoint's signing secret, then update Render (`BILLING.md` §5) |

## 6. Security controls in place

- All data routes require a session or a scoped API key; anonymous requests receive 401 (verified by `tests/production-smoke.sh` and the integration suite).
- Per-role permissions on every application route, from one policy file, with a coverage test over every registered route and an HTTP test per role (§2).
- Workspace isolation follows from ownership checks on every record. `routes/workspaces.integration.test.ts` signs in to two workspaces and checks, in both directions, that brands and Grant Studio records of one are 404 in the other. The database-backed API tests cover the other cross-user cases.
- Two-factor sign-in with single-use codes, recovery codes, an optional per-workspace requirement, and invitation acceptance that also needs a code. `lib/mfa.unit.test.ts` checks the RFC 6238 test vectors, drift, replay and encryption; `routes/account-security.integration.test.ts` checks the whole flow over HTTP; `e2e/security.spec.ts` runs it in a browser with axe.
- Membership, role, account and the browser's session row are re-checked on each request; removal, role changes, disabled accounts and sessions ended elsewhere apply at once. Owners and the last owner are protected from admins.
- An audit log with the person on every entry, for owners and admins, with CSV export.
- Session regeneration at member sign-in; secure session cookie; `trust proxy` for Render's TLS edge; `SESSION_SECRET` required at startup.
- Rate limits: sign-in, admin unlock and two-factor codes (5 / 15 min / IP); invitations (20 failed / 15 min / IP); image upload (20 / 10 min); image serving (120 / min).
- Billing (`BILLING.md`), once switched on: Stripe webhooks are verified against the raw body with the signing secret, applied once each and in order, and never move billing between workspaces. Plan limits fail closed, but the agency workspace is never limited. Only owners see or change billing.
- Rich text is sanitized server-side with an allowlist; scripts, event handlers and unsafe URLs are removed.
- Image uploads: JPEG, PNG, GIF or WebP only, verified by file signature, 10 MB maximum, alt text required, served only to the owning workspace with `nosniff` and a restrictive CSP. Source PDFs up to 50 MB. Video embeds limited to YouTube and Vimeo HTTPS URLs.
- Exports and downloads: format allowlist, ownership check, path-traversal rejection.
- Outbound source fetching and webhooks use DNS-rebinding-safe URL validation.
- Supply chain: `pnpm install --frozen-lockfile`, `pnpm audit --audit-level=high`, gitleaks secret scanning and a CycloneDX SBOM on every PR.
- Accessibility and UI regressions are gated in CI (`e2e/accessibility.spec.ts`, `e2e/accounts.spec.ts`, `e2e/security.spec.ts`).

## 7. Residual risks accepted for this release

| Risk | Mitigation |
|---|---|
| Content-side approvals (research plans, sources, outlines, document sections) are not separated from writing: anyone with `content.write` can approve them | Grant Studio, where approvals carry legal weight, is separated; content approvals are editorial and recorded in the activity log |
| The team password has no second factor and cannot be listed or ended per browser | Prefer personal accounts with two-factor; rotate `ADMIN_PASSWORD` and `SESSION_SECRET` to end team-password sessions |
| Two-factor uses authenticator apps only; no passkeys (WebAuthn) or hardware keys yet | Authenticator codes are single use, rate limited and encrypted at rest; passkeys are a later step |
| Audit entries written before 4 November 2026 have no person recorded | Shown as "Team password or system"; every new entry records the person |
| API keys created before 4 November 2026 have no recorded creator, so removing a member does not revoke them | Review Settings → Automation once and revoke keys you do not recognize |
| No email delivery: invitations are links the inviter sends, and there is no email password reset | Links work once and expire; a forgotten password is handled by re-inviting (§3) |
| The team password has no personal identity | Prefer personal accounts; rotate the team password on every departure |
| Single instance with local disk | Daily disk snapshots, database PITR, documented rollback and restore |
| AI provider receives document content for generation | Use a provider account whose data-use terms the owner accepts; demo mode sends nothing externally |

Report a suspected security issue to the owner privately (see `TROUBLESHOOTING_AND_SUPPORT.md`), not in a public GitHub issue.
