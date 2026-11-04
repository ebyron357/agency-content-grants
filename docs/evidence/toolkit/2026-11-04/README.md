# Place designations and writing toolkit evidence, 4 November 2026

Branch `claude/stoic-hawking-8vvewa`, on top of `main` `997b735`. Migrations `0027_grant_place_designations`, `0028_grant_writing_toolkit` and `0029_grant_rating_calibration`. All names, addresses, tracts, opportunities and letters are synthetic.

## Screenshots

These come from the local production build (`NODE_ENV=test` database) at 1280 px and 2x, captured by `local-verification.spec.ts` (in this folder) against the real server. The script needs one synthetic opportunity (`e2e-toolkit-opp-0001`, titled "[SYNTHETIC] Community Literacy Partnerships") seeded into the local test database. No API creates opportunities, and CI's store is empty, so this run is local only and is not a CI spec. Axe (WCAG 2.0/2.1 A/AA) found no serious or critical violations on any of the screens below. Neither 390 px screen scrolls horizontally.

| File | Shows |
|---|---|
| `37-place-designations.png` | Place designations tab: the location, and a Qualified Opportunity Zone recorded as in, with the official tool link, guidance and sources |
| `38-match-designations.png` | A match that names both designations the notice mentions: a reason for the recorded Opportunity Zone, and a prompt to record the persistent-poverty county |
| `39-writing-checks.png` | Writing checks on an objectives section: reading grade, a placeholder to fill, and a SMART check of each objective |
| `40-logic-model.png` | The logic model builder after **Put it in this section** |
| `41-format-and-letters.png` | Format & letters: Arial 11 pt double spaced, the page estimate against a 10-page limit, the file-name caution, and a tracked letter of support. The full-page capture stops at the app's inner scroll container |
| `43-competitiveness-rating.png` | The competitiveness rating on the package step: four traced components, the actions that raise it, and context (about 4 awards from the notice's funding; no decisions yet), labelled as not a probability of approval |
| `42-package-checks.png` | Review & package with the new checks: no placeholders, format and page limit, letters received |
| `m-format-and-letters.png`, `m-place-designations.png` | The same screens at 390 px |

## Validation on this branch

| Gate | Result |
|---|---|
| Frozen install, format, typecheck, production build | Pass |
| API unit tests | 238 passed, including 29 new in `toolkit.unit.test.ts` |
| API database-backed tests (migrations 0000–0029 on an empty database) | 457 passed, including 2 new in `grant-toolkit.integration.test.ts` and rating assertions in the outcome test (frozen at submission, calibration, cleared on undo) |
| `pnpm audit --audit-level=high` | Pass: 0 critical, 0 high, 1 moderate (`minimatch`, dev only, unchanged) |
| Content OS tests | 34 passed, including 3 new in `WritingToolkit.test.tsx` |
| `tests/integration-tests.sh` | 40 passed, 0 skipped |
| Playwright accessibility and end-to-end gate | 11 passed, including the new `places.spec.ts` |
| Upgrade rehearsal: `6d9f488` writes data, then this branch (production build, `NODE_ENV=production`, TLS proxy) starts on the same database and disk | Migrations to `0029` applied, no error entries, old records readable, a designation recorded. `tests/production-smoke.sh` **75/75** (`smoke-upgrade-branch.txt`) |
| Rollback rehearsal: `6d9f488` restarted on the migrated database | No error entries, old records readable, smoke **75/75** (`smoke-rollback-6d9f488.txt`). The new columns and the letters table are ignored by the older code |

The final rehearsal build came from this branch's working tree, including the rating, before it was committed. Its health check reports the parent commit `44aac09`. Only documentation and evidence changed after that build.

## Behavior changes in existing flows (found by existing tests)

- **Rural wording.** The first version treated any "rural communities" in a notice as a USDA rural-designation mention. The existing nonprofit test caught it: an on-topic match grew an unexpected gap. Now only explicit rural-eligibility language counts.
- **Placeholders block the package.** The generated budget justification leaves `[Add: the basis for the rate …]` when an indirect rate is set. Before this change, the existing nonprofit test approved and exported a final package with that marker still in it. The new check blocks it. The test now fills the marker before approving, as an applicant must, and asserts the block first.

## Not verified

- **Automatic designation lookup: not built.** This session's network policy blocks the Census Geocoder, CDFI Fund, SBA, HUD, USDA and Census hosts, so a person records each result from the agency's tool. See `docs/GRANT_STUDIO.md`, Data sources.
- **The exported file's page count is estimated** from the word count and format. Check it in Word before submitting.
- **Production.** Nothing here is deployed.
