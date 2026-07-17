---
id: windows-update-feed-integrity
title: Bind AutoUpdater to an auditable feed and tamper checks
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete P6-002 by making the Main-owned AutoUpdater feed, channel, source, and package-integrity decisions explicit and fail-closed.
touchedAreas:
  - electron/services/updates-api.ts
  - shared/release-policy/windows-update-feed-policy.ts
  - scripts/validate-windows-update-feed-policy.mts
  - scripts/collect-p6-002-evidence.mjs
  - .github/workflows/release.yml
  - tests/unit/windows-update-feed-p6-002.test.ts
  - plans/system-maturity/phase6-supply-release/**
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P6-002/**
  - harness/specs/rules/windows-update-feed-integrity.md
  - harness/specs/tasks/windows-update-feed-integrity.md
  - package.json
expectedUserBehavior:
  - Packaged update checks use the fixed HTTPS OSS origin and the installed stable/alpha/beta channel.
  - A wrong feed source or wrong-channel metadata is rejected instead of silently switching update streams.
  - A package whose SHA512 or size differs from metadata is rejected before installation.
  - Renderer update actions continue through the existing typed host API and cannot select transport or feed policy.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
  - windows-update-feed-integrity
requiredTests:
  - tests/unit/windows-update-feed-p6-002.test.ts
acceptance:
  - Main configures electron-updater from a fixed HTTPS origin and the installed package channel.
  - Feed source and channel decisions are inspectable without exposing renderer-controlled transport choices.
  - Wrong source/channel metadata and tampered package hash/size fail closed.
  - Release workflow output directories and client feed policy remain consistent.
docs:
  required: false
---

This task is the harness projection of System Maturity task P6-002 and the
remaining update-feed portion of Finding F-SUPPLY-001.
