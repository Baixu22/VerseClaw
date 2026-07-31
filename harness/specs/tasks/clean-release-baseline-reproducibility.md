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
  - scripts/validate-first-product-release-candidate.mjs
  - tests/unit/release-baseline-p6-005.test.ts
  - tests/unit/first-product-release-candidate.test.ts
  - harness/specs/scenarios/windows-release-trust.md
  - harness/specs/rules/clean-release-baseline-reproducibility.md
  - harness/specs/tasks/clean-release-baseline-reproducibility.md
  - plans/system-maturity/phase6-supply-release/**
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P6-005/**
  - artifacts/first-product-preview/FP-P2-07/**
  - artifacts/first-product-preview/FP-P3-01/**
  - docs/dev/first-product-controlled-preview/**
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - A release cannot begin from a dirty tree or from a commit that is not bound to the requested tag/ref.
  - The release collector rebuilds the OpenClaw runtime before Electron-dependent gates and records that preflight with captured output digests.
  - Every command classified as a required release gate has zero-exit, hash-addressed evidence before packaging begins.
  - Captured release evidence redacts workspace and user-home absolute paths before hashing or persistence.
  - The same commit and release inputs regenerate the same source manifest bytes.
  - The fixture-grade Windows x64 candidate proves updater metadata, release-info, ASAR integrity, source coverage, provenance, and credential boundaries without entering public latest.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/release-baseline-p6-005.test.ts
  - tests/unit/first-product-release-candidate.test.ts
acceptance:
  - Dirty, unbound, or tag-mismatched release sources fail closed.
  - A missing, failed, or tampered runtime-build preflight fails before release evidence can pass.
  - All required full release gates pass and are represented in evidence.
  - Release preflight and gate streams contain no workspace or user-home absolute paths.
  - Source manifests are byte-for-byte reproducible for the same commit and inputs.
  - Release packaging jobs depend on the clean baseline gate.
  - The packaged Windows x64 candidate is newer than its build outputs, contains no bundled git/gh or GitHub CLI auth state, and matches latest.yml plus release-info.
  - MergeBeacon provenance resolves to an exact commit and Apache-2.0/NOTICE disposition while direct source copying remains disabled.
docs:
  required: false
---

This task is the harness projection of System Maturity task P6-005 and Finding
F-GOV-003.
