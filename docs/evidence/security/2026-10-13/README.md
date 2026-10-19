# Dependency security repair — 13 October 2026

Requested: investigate and repair the demonstrated high/critical dependency gate failure without disabling security checks. Baseline: `3579fae01a2cc61591168dce42d375287dbe8f4e`. Submitted branch: `portfolio/security-dependency-remediation-20261013`.

Changes: patched overrides for proxy-addr 2.0.8, source-map-js 1.2.2, and prosemirror-view 1.42.3; remove fast-glob's unpatched braces chain by using Node 24 `fs.promises.glob`; retain private-file exclusions and deterministic mockup registration. No paid resources, production deployment, schema, authentication, tenant isolation, or audit threshold changes.

| Check | Result | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; lifecycle scripts deliberately not run during dependency acquisition | Workspace build subsequently verifies installed packages |
| `pnpm --filter @workspace/api-server test:unit` | PASS: 17 Node tests and 131 Vitest tests | `agency_unit_tests.log` |
| `pnpm --filter @workspace/content-os test` | PASS: 21 tests | `agency_content_tests.log` |
| `pnpm --filter @workspace/mockup-sandbox test:discovery` | PASS: 2 tests | `agency_discovery_test.log` |
| `pnpm run build` | PASS: repository typecheck and workspace builds | `agency_build_final.log` |
| `pnpm audit --audit-level=high --json` | PASS: 0 critical, 0 high, 2 moderate | `agency_audit_final.json` |

Runtime: Node 24.19.0; pnpm 11.25.0 available in execution environment (repository declares pnpm 11.16.0; CI must verify its declared toolchain). Existing code already targets Node 24. Native glob is stable in Node 24 and supports string exclusion patterns. The new tests use Node's built-in test runner and TypeScript stripping.

Before repair: one critical, three high, two moderate advisories. After the three patched overrides, one high remained (`braces`); `agency_audit_after.json` records this intermediate result. Removing fast-glob's only usage eliminates that chain. Moderate findings are not suppressed or represented as fixed. Audit results are time-sensitive, not a guarantee against future advisories.

Primary references: [proxy-addr advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [ProseMirror advisory](https://github.com/advisories/GHSA-c8x8-7fp4-3x9w), [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [Node 24 filesystem API](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html#fspromisesglobpattern-options).

CI, independent review, database integration, browser and production verification are not claimed by these local results. Maintainer owns review/merge authorization; product owner owns production authorization and any paid Render provisioning. Existing required checks remain enforceable.
