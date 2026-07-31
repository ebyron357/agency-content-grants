# SBOM and License Control Plan

## Purpose

Define how the platform will produce, verify, retain, and review software bills of materials before any production implementation is approved.

## Current limitation

The repository contains governance documents only. It has no package manifests, lockfiles, containers, application source, model files, datasets, or deployed infrastructure. Therefore, a truthful production SBOM cannot yet be generated.

The Stage 0 output is an SBOM control design plus a candidate-component inventory. Actual CycloneDX and SPDX artifacts become mandatory as soon as disposable manifests or container images are created.

## Required SBOM formats

Generate both:

- CycloneDX JSON for security and dependency tooling.
- SPDX JSON for license and compliance exchange.

Store generated artifacts under:

```text
artifacts/sbom/<release-or-commit>/
  application.cdx.json
  application.spdx.json
  containers/
  models-and-data.json
  verification-report.md
```

Generated release artifacts must reference the exact Git commit and lockfile state.

## Inventory scope

The SBOM process must include:

1. Direct and transitive application dependencies.
2. Development, build, testing, and code-generation dependencies.
3. Operating-system and container-image packages.
4. Database extensions.
5. Workflow server, SDK, UI, CLI, and deployment-chart components.
6. Plugins and integrations.
7. Browser-side packages.
8. Copied snippets, vendored files, templates, fonts, icons, and media.
9. AI models, embedding models, rerankers, datasets, benchmark corpora, and prompt packs.
10. External SaaS and APIs in a separate service inventory, including terms and data-processing implications.

## Required component fields

Each component record must contain:

- Name
- Exact version or immutable revision
- Package URL or canonical source
- Supplier
- SHA or checksum when available
- Direct or transitive status
- Runtime, build-time, development, model, dataset, or service classification
- Declared license
- Verified license text location
- Copyright and attribution requirements
- Commercial-use status
- Redistribution status
- Network-use or source-availability obligations
- Known vulnerabilities
- End-of-life status
- Decision: ADOPT, PILOT, REPLACE, REJECT, or DEFER
- Owner
- Review date
- Replacement path

## Tooling strategy

Candidate tools may include Syft for filesystem/container discovery, package-manager-native inventory, CycloneDX generators, and ScanCode or equivalent license inspection. Tool selection remains subject to its own licensing review.

Minimum execution sequence:

1. Install dependencies from immutable lockfiles.
2. Generate package-manager inventory.
3. Scan the built filesystem and each container image.
4. Produce CycloneDX and SPDX files.
5. Compare results and investigate differences.
6. Verify all unknown, custom, dual, and conflicting licenses manually.
7. Run vulnerability and end-of-life checks.
8. Fail the release gate on prohibited, unknown, or unapproved components.
9. Attach SBOMs and the verification report to the release.

## Policy gates

A build must fail when:

- A runtime component lacks an exact version.
- A component has no identifiable license.
- A restricted or custom license lacks written approval.
- Required attribution is missing.
- A prohibited dependency appears.
- The SBOM does not match the lockfile or built image.
- A critical vulnerability lacks an approved exception.
- A model or dataset lacks documented usage rights.

## Continuous controls

- Generate SBOMs on every release candidate.
- Diff SBOMs in pull requests when dependency state changes.
- Re-scan released artifacts on a scheduled basis for newly disclosed vulnerabilities.
- Review all dependency update pull requests for license drift.
- Retain historical SBOMs for the supported lifetime of each release plus the contractual retention period.
- Require an owner-approved exception record with expiration date for every policy bypass.

## Stage 0 acceptance

WP-02 SBOM planning is complete when:

- Formats and storage paths are defined.
- Inventory scope and required fields are defined.
- Failure gates are defined.
- Candidate-stack license decisions are recorded.
- The repository clearly states that no production SBOM exists until manifests and built artifacts exist.

Actual SBOM generation remains a future implementation-gate requirement, not a completed Stage 0 execution claim.