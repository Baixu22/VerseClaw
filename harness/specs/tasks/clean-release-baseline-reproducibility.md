---
id: clean-release-baseline-reproducibility
title: Enforce a clean and reproducible release baseline
scenario: windows-release-trust
taskType: release-governance
intent: Complete P6-005 by denying dirty or unbound release sources, requiring every full release gate, and producing a deterministic source manifest.
touchedAreas:
  - .github/workflows/release.yml
  - package.json
  - plans/system-maturity/gates.json
  - scripts/release-baseline-manifest.mjs
  - scripts/validate-release-baseline.mjs
  - scripts/collect-p6-005-evidence.mjs
  - tests/unit/release-baseline-p6-005.test.ts
  - harness/specs/scenarios/windows-release-trust.md
  - harness/specs/rules/clean-release-baseline-reproducibility.md
  - harness/specs/tasks/clean-release-baseline-reproducibility.md
  - plans/system-maturity/phase6-supply-release/**
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P6-005/**
expectedUserBehavior:
  - A release cannot begin from a dirty tree or from a commit that is not bound to the requested tag/ref.
  - Every command classified as a required release gate has zero-exit, hash-addressed evidence before packaging begins.
  - The same commit and release inputs regenerate the same source manifest bytes.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/release-baseline-p6-005.test.ts
acceptance:
  - Dirty, unbound, or tag-mismatched release sources fail closed.
  - All required full release gates pass and are represented in evidence.
  - Source manifests are byte-for-byte reproducible for the same commit and inputs.
  - Release packaging jobs depend on the clean baseline gate.
docs:
  required: false
---

This task is the harness projection of System Maturity task P6-005 and Finding
F-GOV-003.
