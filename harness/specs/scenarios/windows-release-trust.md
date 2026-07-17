---
id: windows-release-trust
title: Windows Release Trust
type: release-governance
ownedPaths:
  - .github/workflows/release.yml
  - shared/release-policy/**
  - scripts/validate-windows-release-policy.mjs
  - tests/unit/windows-signing-policy-p6-001.test.ts
  - plans/system-maturity/phase6-supply-release/**
  - artifacts/system-maturity/P6-*/**
requiredProfiles:
  - fast
requiredRules:
  - windows-release-signing-policy
---

Windows release trust covers the policy and evidence chain from release channel
selection through SignPath, Authenticode verification, updater metadata hashing,
and the final GitHub/OSS publish boundary.

Stable releases require verified Windows signatures before any public publish
job can begin. Alpha and beta releases may remain unsigned only when they stay
in prerelease/channel-scoped distribution. Unknown prerelease channels fail
closed and require signing until explicitly classified.
