---
id: supply-chain-integrity-pinning
title: Pin bundled binaries, release installers, and GitHub Actions
scenario: windows-release-trust
taskType: release-governance
intent: Complete P6-003 by making every packaged binary download and release workflow dependency checksum- or commit-pinned before use.
touchedAreas:
  - .github/workflows/**
  - scripts/lib/verified-download.mjs
  - scripts/release-integrity-manifest.mjs
  - scripts/download-bundled-uv.mjs
  - scripts/download-bundled-agent-browser.mjs
  - scripts/download-bundled-node.mjs
  - scripts/install-pinned-ossutil.mjs
  - scripts/validate-supply-chain-integrity.mjs
  - scripts/collect-p6-003-evidence.mjs
  - tests/unit/supply-chain-integrity-p6-003.test.ts
  - package.json
  - harness/specs/scenarios/windows-release-trust.md
  - harness/specs/rules/supply-chain-integrity-pinning.md
  - harness/specs/tasks/supply-chain-integrity-pinning.md
  - plans/system-maturity/phase6-supply-release/**
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P6-003/**
expectedUserBehavior:
  - Bundled uv, agent-browser, and Node assets are rejected before extraction when size or SHA256 differs from the tracked manifest.
  - The OSS publisher installs a pinned ossutil archive without executing a remote installer script or mutating system directories with sudo.
  - Every external GitHub Action is resolved by an immutable commit SHA.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/supply-chain-integrity-p6-003.test.ts
acceptance:
  - All packaged external binaries have tracked HTTPS source, version, size, and SHA256 metadata.
  - Checksum mismatch and incomplete manifest coverage fail closed in offline tests.
  - Release workflow contains no curl-to-shell installer and uses the pinned ossutil installer.
  - All external workflow actions use the approved full commit SHA for their repository.
docs:
  required: false
---

This task is the harness projection of System Maturity task P6-003 and the
integrity-pinning portion of Finding F-SUPPLY-002.
