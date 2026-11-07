# Federal forms and unsupported-claim check evidence, 7 November 2026

Branch `feat/federal-forms-claim-check`, on top of `main` `19aaf5e`. Migration `0036_grant_federal_forms_claims`. Scope: build map week 2, Agent 3, "Federal forms in the package; unsupported-claim check before approval" (`GRANT_PLATFORM_PLAN.md` §6, items 2 and the federal forms), requested by the owner on 6 November 2026. Every organization, opportunity, form value and section text here is synthetic.

## What was verified

| Behavior | How |
|---|---|
| SF-424, SF-424A, SF-424B and SF-LLL come from HHS/simpler-grants-gov `api/src/form_schema/forms/` at commit `d16806e34d6a1b46a6cccd5df34a518b3799666a` (public domain, CC0 waiver) | `scripts/extract-federal-forms.py` (parses the Python files with `ast`, never imports or runs them) wrote `definitions.ts`; unit test checks the four forms, version 4.0 and OMB 4040-0004 for the SF-424 |
| Prefill from the organization profile, the opportunity and the budget, and nothing else; a person's value wins; reset brings the prefill back | Unit tests; integration test |
| Validation against each form's JSON Schema (ajv 2020-12), with plain messages on the field | Unit tests (email, money, maximum length, required); integration test |
| Fields Grants.gov fills, computed totals and fields from the record cannot be typed; values of the wrong type are refused | Unit and integration tests (400 on `total_estimated_funding`, `date_received`, a string for a yes/no) |
| A review covers exactly the data reviewed: a later budget change asks for a new review | Unit and integration tests |
| SF-LLL can be marked not applicable only with a reason; no other form can | Integration test |
| The package DOCX contains the forms as readable tables; JSON and PDF download as drafts, final only after package approval; nothing is sent to Grants.gov | Integration test reads `word/document.xml` from the DOCX; 409 for the final JSON before approval. No route calls any external service |
| State programs have no forms step and no forms check | Integration test |
| Claims flagged (number, date, result, named partner, credential) with the reason and the method `Rule check (no AI)` | Unit tests; integration test; browser spec |
| **The server refuses section approval while a flag is open** (409 with the open flags) and records no approval | Integration test `blocks approval on the server until each flag is linked, edited away or dismissed with a reason` |
| Linking only to a confirmed fact of the same organization; dismissal needs a 10 to 1,000 character reason; editing the claim out closes the flag; a linked flag reopens if its fact loses confirmation | Integration test |
| Nothing is approved automatically | Integration test checks the section is still unapproved after all flags are resolved, until a person approves |
| With an AI provider, the model can only add flags, and only with a word-for-word quote | Unit tests on `acceptAiClaims` with synthetic model output. **No real AI provider was called** (no key in this environment) |
| Workspace isolation | Integration tests: another workspace gets 404 on every forms route (read, save, review, applicability, JSON, PDF) and every claim route (check, resolve, reopen, approve), and cannot link its own fact |
| Roles | Integration test through the full router: writers reach every forms and claim route; reviewers reach review, check, resolve and reopen and get 403 `forbidden_by_role` on filling forms; viewers get 403 on all writes and can read |

## Screenshots

From the local production build at 1280 px and 390 px against the real server, with no AI key (demo labelling shown), captured from the browser spec flow.

| File | Shows |
|---|---|
| `01-claim-flag.png` | The Write step: the section's "1 claim to back up" chip and the count in the section list |
| `02-sf424-prefilled.png` | The Federal forms step: the four forms with status, SF-424 header with counts, a required field marked |
| `03-sflll-not-applicable.png` | SF-LLL marked not applicable, with the reason recorded |
| `m-sf424a.png` | SF-424A at 390 px |

## Validation on this branch (local, Node 22, PostgreSQL 16)

| Gate | Result |
|---|---|
| Frozen install, format check, repository typecheck, API and frontend builds | Pass |
| API unit lane (`node --test` guard + vitest unit config) | 17 + 355 passed (32 files), including 10 new in `claims.unit.test.ts` and 10 in `federalForms.unit.test.ts` |
| API database-backed suite (migrations 0000–0036 on a fresh database) | 615 passed (63 files). New: 4 in `grant-forms-claims.integration.test.ts`. `grants.integration.test.ts` now fills the forms and backs a claim with a confirmed fact before approving (both required by this change) |
| Content OS unit tests | 39 passed |
| `tests/integration-tests.sh` against the built server | 40 passed, 0 failed, 0 skipped (run with the port changed to 8136 in a scratch copy, because other agents' servers held 8080) |
| Playwright gate (axe WCAG 2.0/2.1 A/AA, all specs) | 15 passed, including the new `forms-claims.spec.ts`. The server was started with `FRONTEND_DIST_PATH` pointing at a non-hidden path, because Express's static server refuses files under this worktree's `.claude` directory |
