---
lifecycleStatus: archived
id: release-artifact-attestation-integrity
title: Bind SBOM, provenance, ASAR integrity, and Electron fuses
scenario: windows-release-trust
taskType: release-governance
intent: Complete P6-004 by binding release metadata to exact artifacts, emitting independently verifiable attestations, and enforcing packaged Electron ASAR integrity fuses.
touchedAreas:
  - .github/workflows/release.yml
  - electron-builder.yml
  - package.json
  - pnpm-lock.yaml
  - scripts/release-integrity-manifest.mjs
  - scripts/lib/verified-download.mjs
  - scripts/validate-supply-chain-integrity.mjs
  - scripts/generate-release-trust-metadata.mjs
  - scripts/validate-release-trust-metadata.mjs
  - scripts/verify-packaged-electron-trust.mjs
  - scripts/collect-p6-004-evidence.mjs
  - tests/unit/release-artifact-integrity-p6-004.test.ts
  - harness/specs/scenarios/windows-release-trust.md
  - harness/specs/rules/release-artifact-attestation-integrity.md
  - harness/specs/tasks/release-artifact-attestation-integrity.md
  - plans/system-maturity/phase6-supply-release/**
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P6-004/**
expectedUserBehavior:
  - Every published artifact can be matched to a CycloneDX SBOM component and SLSA provenance subject by SHA256.
  - GitHub provenance and SBOM attestations can be verified independently of the build job.
  - A packaged Electron binary refuses an app.asar whose bytes no longer match embedded integrity metadata and cannot fall back to an unpacked app directory.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/release-artifact-integrity-p6-004.test.ts
acceptance:
  - Generated SBOM and provenance subjects exactly match the release artifact inventory.
  - Tampered metadata or artifacts fail portable verification.
  - Release workflow uses commit-pinned GitHub build-provenance and SBOM attestation actions before publication.
  - Electron builder policy and actual packaged fuse wire enable embedded ASAR validation plus OnlyLoadAppFromAsar.
docs:
  required: false
---

This task is the harness projection of System Maturity task P6-004 and the
remaining SBOM/provenance/runtime-integrity portion of Finding F-SUPPLY-002.
