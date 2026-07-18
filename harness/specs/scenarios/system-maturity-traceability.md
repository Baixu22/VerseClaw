---
id: system-maturity-traceability
title: System Maturity Finding Traceability
type: governance-control-plane
ownedPaths:
  - plans/system-maturity/**
  - scripts/validate-system-maturity-*.mjs
  - scripts/collect-p7-*.mjs
  - scripts/lib/system-maturity-*.mjs
  - tests/unit/system-maturity-*.test.ts
  - artifacts/system-maturity/**
requiredProfiles:
  - fast
requiredRules:
  - system-maturity-traceability
---

System Maturity traceability keeps Findings, tasks, test identities, changed
code, acceptance evidence, and review cadence mutually resolvable. The control
plane must fail closed when a link is orphaned, a completed task lacks
acceptance evidence, or evidence is older than the code and tests it claims to
cover.
