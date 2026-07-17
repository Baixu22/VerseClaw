---
id: windows-release-trust
title: Windows Release Trust
type: release-governance
ownedPaths:
  - .github/workflows/**
  - shared/release-policy/**
  - scripts/lib/verified-download.mjs
  - scripts/release-integrity-manifest.mjs
  - scripts/download-bundled-*.mjs
  - scripts/install-pinned-ossutil.mjs
  - scripts/validate-supply-chain-integrity.mjs
  - scripts/generate-release-trust-metadata.mjs
  - scripts/validate-release-trust-metadata.mjs
  - scripts/verify-packaged-electron-trust.mjs
  - scripts/validate-windows-release-policy.mjs
  - tests/unit/windows-signing-policy-p6-001.test.ts
  - plans/system-maturity/phase6-supply-release/**
  - artifacts/system-maturity/P6-*/**
requiredProfiles:
  - fast
requiredRules:
  - windows-release-signing-policy
  - supply-chain-integrity-pinning
  - release-artifact-attestation-integrity
---

Windows release trust covers the policy and evidence chain from release channel
selection through SignPath, Authenticode verification, updater metadata hashing,
and the final GitHub/OSS publish boundary.

Build inputs are part of the same trust boundary. Bundled executables and CI
installers require tracked SHA256 values before extraction or execution, and
third-party GitHub Actions require immutable 40-character commit pins.

Release outputs carry a CycloneDX SBOM and SLSA-shaped provenance bound to the
exact artifact hashes. GitHub artifact attestations provide independent
verification, while packaged Electron binaries enable embedded ASAR integrity
validation and refuse fallback loading outside `app.asar`.

Stable releases require verified Windows signatures before any public publish
job can begin. Alpha and beta releases may remain unsigned only when they stay
in prerelease/channel-scoped distribution. Unknown prerelease channels fail
closed and require signing until explicitly classified.
