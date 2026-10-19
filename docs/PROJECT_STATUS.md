# Content Machine — current project status

Status date: **13 October 2026**. Owner: Emmanuel Andre Byron (`ebyron357`). This is the single current status record. Governing issue: [#8](https://github.com/ebyron357/agency-content-grants/issues/8). ClickUp control task: `86e2tjzyc`.

## Current verdict

| Area | Verified state | Next action and owner |
|---|---|---|
| Previously delivered Content Machine scope | Historical closeout evidence is retained; new advisories do not reopen unrelated accepted functionality | Preserve accepted scope; implementation agent fixes the demonstrated security defect |
| Dependency security | **IN PROGRESS** — the main baseline has one critical and three high advisories; this branch repairs them and passes the existing high-severity audit threshold | Maintainer reviews the focused security PR and its CI before any merge |
| Local validation of this repair | **PASS** — frozen install, typecheck/build, 17 Node tests, 131 API unit tests, 21 frontend tests, and two new mockup-discovery tests | Required CI and independent review remain outstanding |
| Production | **NO-GO / NOT VERIFIED** — this repair does not deploy or provision services | Owner decides whether to authorize paid Render resources; operator verifies the approved production commit after deployment |

No production deployment, merge, independent review, database integration test, browser audit, or current Render inventory verification is claimed by this repair.

## Repair and evidence

The audited main baseline is `3579fae01a2cc61591168dce42d375287dbe8f4e`. A local audit on 13 October reproduced the dependency gate failure. The branch pins compatible patched releases of `proxy-addr` (2.0.8), `source-map-js` (1.2.2), and `prosemirror-view` (1.42.3). It removes the sole `fast-glob` dependency chain containing unpatched `braces`, using the existing Node 24 runtime's native filesystem glob for mockup discovery instead. Tests cover nested TSX discovery, private/hidden exclusions, deterministic results, and an absent mockup directory.

The final audit reports **zero critical, zero high, and two moderate** advisories. Moderate findings remain visible in audit metadata and are outside this focused critical/high repair. The security threshold, secret scanning, database guards, tenant controls, and CI checks are unchanged.

See [security repair evidence](evidence/security/2026-10-13/README.md) for commands, results, advisory references, and retained logs. The exact submitted commit is the commit containing this document; CI must evaluate that commit, not an earlier closeout SHA.

## Blockers and required decisions

| Blocker | Evidence | Owner | Resolution criteria | Next action |
|---|---|---|---|---|
| Security repair is not accepted on main | Branch changes and current dependency audit; historical CI audit failure [run 37084965738](https://github.com/ebyron357/agency-content-grants/actions/runs/37084965738) | Maintainer / designated reviewer | Required checks and applicable review pass, with normal branch protection enforced | Review the focused PR; do not deploy the vulnerable baseline |
| Production readiness remains unverified | 2 October closeout record reported no Render service; this pass did not recheck that external state | Product owner / Render account holder | Confirm existing resources or explicitly authorize paid provisioning and secrets; verify deployed SHA and smoke tests | Read the current Render state, then make any required owner decision |

The earlier instruction to create paid Render resources is historical context, not permission for this agent to incur charges or deploy production. The 13 October portfolio directive requires explicit production authorization.

## Preserved product and operating constraints

- Approved scope is the delivered Content Machine. Grant/proposal intelligence remains deferred under existing owner decisions.
- One shared operator account; access is revoked by password rotation. No new identity or tenant model is introduced.
- Single instance, in-process schedulers, and persistent Render disk remain the deployment design. Media and exports remain on disk; backup and retention procedures remain in the existing runbooks.
- AI providers, Typefully, and production credentials are owner-managed external dependencies. Demonstration output must stay labelled.
- Production verification must demonstrate repository/deployment SHA parity, authentication and isolation, persistence, export, accessibility, runtime health, and applicable rollback evidence.
- Previously verified gates are reused only where relevant code and environments remain unchanged. This dependency change requires its normal security and compatibility checks; it does not justify reopening unrelated completed scope.

## Governing documents and history

`AGENTS.md`, `docs/GO_NO_GO_DECISION.md`, `docs/DOCUMENT_OWNERSHIP_MAP.md`, `docs/CI.md`, `docs/PROJECT_COMPLETION_STANDARD.md`, and the deployment, security/access, data lifecycle, admin, client, troubleshooting, and acceptance manuals remain in force. This status update changes observed facts, not their security or approval policies. The October 2 GO/NO-GO record's historical gate results must not be interpreted as a current clean vulnerability audit.

The complete prior status, evidence matrix, known limitations, document index, and release history are retained in [the superseded October 2 snapshot](history/PROJECT_STATUS_2026-10-02_PRE_SECURITY_REPAIR.md). Earlier recovery records remain historical. This file supersedes that snapshot as the single current status; it does not overwrite or fabricate prior evidence.
