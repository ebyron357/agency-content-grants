# Branch and Pull Request Policy

## Protected workflow

1. Begin from current `main`.
2. Use one focused branch per work package.
3. Never commit autonomous work directly to `main`.
4. Open a pull request with evidence, acceptance results, risks, and next action.
5. Do not merge automatically.
6. Human approval is required for governance decisions, material architecture decisions, residual high risks, budget, pilot scope, and Stage 0 GO/NO-GO.

## Branch naming

- `agent/wpXX-description` for autonomous Stage 0 work
- `docs/description` for human-authored documentation
- `poc/description` for disposable security or architecture proofs
- `feat/description` only after implementation is approved

## Pull-request requirements

Every PR must identify:

- Work package and scope
- Files changed
- Evidence reviewed
- Decisions and assumptions
- Tests or validation actually run
- Acceptance criteria passed or failed
- Unresolved questions
- Security, licensing, cost, and tenant-isolation implications
- Exact next authorized action

## Required CI for pull requests targeting `main`

The canonical GitHub Actions workflow is `.github/workflows/ci.yml` (workflow name: **CI**). See `docs/CI.md`.

`.github/workflows/recovery-baseline-validation.yml` is historical recovery evidence and is not the required `main` pull-request gate.

## Merge standard

A PR may merge only when its claims are supported by repository evidence and all required human gates are satisfied. Missing evidence must be recorded as a blocker, never filled with invented completion.