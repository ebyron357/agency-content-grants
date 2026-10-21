# Content Machine — current project status

Status date: **21 October 2026**. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. Governing issue: [#8](https://github.com/ebyron357/agency-content-grants/issues/8). ClickUp control task: `86e2tjzyc`.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Previously delivered Content Machine scope | Historical closeout evidence is retained; new advisories do not reopen unrelated accepted functionality | Preserve accepted scope |
| Dependency security | **IN PROGRESS** — PR #18 (13 October) cleared the critical/high advisories, but advisories published since then leave `main` (`6dc15e9`) with 2 high, 7 moderate and 3 low. This branch removes all of them; local audit reports zero advisories | Maintainer reviews the focused security PR and its CI before any merge |
| Local validation of this repair | **PASS with environment notes** — frozen install, audit, typecheck/build, 17 Node tests, 21 frontend tests, 2 mockup-discovery tests pass; one API unit test and the format check fail only from Windows path/CRLF effects (see evidence) | CI must pass all required steps, including the database, integration and accessibility suites not run locally |
| Production | **NO-GO / NOT VERIFIED** — this repair does not deploy or provision services | Owner decides whether to authorize paid Render resources; operator verifies the approved production commit after deployment |

No production deployment, merge, independent review, local database integration test, browser audit, or current Render inventory verification is claimed by this repair.

## Repair and evidence

**13 October (PR #18, merged):** pinned patched `proxy-addr` (2.0.8), `source-map-js` (1.2.2) and `prosemirror-view` (1.42.3), and replaced the `fast-glob` chain (unpatched `braces`) with Node 24's native filesystem glob. Evidence: [2026-10-13](evidence/security/2026-10-13/README.md).

**21 October (this branch):** a fresh audit of `main` found new advisories in `vite` (high), `markdown-it` (high), `sanitize-html`, `fast-copy` and `postcss-selector-parser`. The branch raises the `vite` catalog entry and adds a `vite` override to `^7.3.7` (covering the copy `vitest` pulls in), raises the `markdown-it` override to `^14.3.3`, raises the API server's `sanitize-html` to `^2.18.0`, and adds overrides `fast-copy ^4.1.0` and `postcss-selector-parser ^7.1.6`. All stay within their current major versions. The final audit reports **zero advisories at every severity**. Evidence: [2026-10-21](evidence/security/2026-10-21/README.md).

`sanitize-html` strips unsafe editor HTML on the server, so the database-backed API tests covering rich-content sanitisation must pass in CI before merge. The security threshold, secret scanning, database guards, tenant controls and CI checks are unchanged. CI must evaluate the commit containing this document.

## Blockers and required decisions

| Blocker | Evidence | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| Security repair is not accepted on main | `audit_before.json` for `6dc15e9`; branch changes and clean audit | Maintainer / designated reviewer | Required checks and applicable review pass, with normal branch protection enforced | Review the focused PR; do not deploy the vulnerable baseline |
| Production readiness remains unverified | 2 October closeout record reported no Render service; this pass did not recheck that external state | Product owner / Render account holder | Confirm existing resources or explicitly authorize paid provisioning and secrets; verify deployed SHA and smoke tests | Read the current Render state, then make any required owner decision |

The earlier instruction to create paid Render resources is historical context, not permission for this agent to incur charges or deploy production. The 13 October portfolio directive requires explicit production authorization.

## Known non-blocking findings

- `pnpm peers check` reports `@tiptap/core` 3.31.3 wanting `@tiptap/pm` 3.31.3 while 3.30.0 is installed. This is present on `main` before this change and is not altered here.

## Preserved product and operating constraints

- Approved scope is the delivered Content Machine. Grant/proposal intelligence remains deferred under existing owner decisions.
- One shared operator account; access is revoked by password rotation. No new identity or tenant model is introduced.
- Single instance, in-process schedulers, and persistent Render disk remain the deployment design. Media and exports remain on disk; backup and retention procedures remain in the existing runbooks.
- AI providers, Typefully, and production credentials are owner-managed external dependencies. Demonstration output must stay labelled.
- Production verification must demonstrate repository/deployment SHA parity, authentication and isolation, persistence, export, accessibility, runtime health, and applicable rollback evidence.
- Previously verified gates are reused only where relevant code and environments remain unchanged. This dependency change requires its normal security and compatibility checks; it does not justify reopening unrelated completed scope.

## Governing documents and history

`AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, `docs/DOCUMENT_OWNERSHIP_MAP.md`, `docs/CI.md`, `docs/PROJECT_COMPLETION_STANDARD.md`, and the deployment, security/access, data lifecycle, admin, client, troubleshooting, and acceptance manuals remain in force. This status update changes observed facts, not their security or approval policies. The October 2 GO/NO-GO record's historical gate results must not be interpreted as a current clean vulnerability audit.

The complete prior status, evidence matrix, known limitations, document index, and release history are retained in [the superseded October 2 snapshot](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md). Earlier recovery records remain historical. This file supersedes the 13 October version as the single current status; it does not overwrite or fabricate prior evidence.
