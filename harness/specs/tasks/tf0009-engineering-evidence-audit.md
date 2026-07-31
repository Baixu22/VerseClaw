---
id: tf0009-engineering-evidence-audit
title: TF-0009 engineering evidence audit
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete a bounded agent-surrogate DCS, SEKB, Browser, kill, and decision workflow for TF-0009 while preserving zero human/live counts and blocking done or implicit UAS dependency release.
touchedAreas:
  - .agent-workbench/task-forest/**
  - .gitignore
  - artifacts/dcs-deep-test-week1/**
  - artifacts/first-product-preview/TF-0009/**
  - docs/dev/component-operational-readiness-checklist.md
  - docs/dev/dcs-deep-test-week1-kickoff.md
  - docs/dev/dcs-ops-canary-runbook.md
  - docs/dev/first-product-controlled-preview/STATUS.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/handoffs/OVERNIGHT-HARVEST-BRIEF.md
  - docs/dev/tf0009-engineering-evidence-audit.md
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
  - harness/specs/rules/tf0009-real-canary-authority.md
  - harness/specs/tasks/tf0009-engineering-evidence-audit.md
  - scripts/dcs-ops-preflight.mjs
  - scripts/lib/tf0009-agent-surrogate.mjs
  - scripts/build-openclaw-runtime.mjs
  - scripts/lib/tf0009-canary-readiness.mjs
  - scripts/smoke-openclaw-runtime.mjs
  - openclaw_runtime/scripts/tf0009-agent-surrogate.mts
  - package.json
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - tests/unit/sekb-runtime-build-contract.test.ts
  - tests/unit/tf0009-agent-surrogate.test.ts
  - tests/unit/tf0009-engineering-evidence-audit.test.ts
expectedUserBehavior:
  - Operators can distinguish L2 automation readiness from L3 real-canary authorization.
  - The agent campaign can complete 10 engineering runs per profile without changing the human qualifying count.
  - Missing named roles and human governance leaves l3Ready false even when agentSurrogateReady is true.
  - Agent, fixture, synthetic, E2E, and Harness evidence remains visible but never increments a TF-0009 human/live run count.
  - TF-0009 remains review_needed with the degraded-agent-complete label; its own evidence cannot self-authorize TF-0011 release.
  - A separately confirmed governance proposal may release TF-0011 for engineering-only work without changing TF-0009 human/live status.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - tf0009-real-canary-authority
  - docs-sync
requiredTests:
  - tests/unit/tf0009-agent-surrogate.test.ts
  - tests/unit/tf0009-engineering-evidence-audit.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - tests/unit/sekb-runtime-build-contract.test.ts
acceptance:
  - The machine-readable audit reports zero qualifying runs for all three profiles.
  - The agent-surrogate report contains exactly 10 passing agent runs per profile through the real component entrypoints and labels every run humanEquivalent=false and liveEvidence=false.
  - SEKB agent runs exercise capture, suggestion, rejection, and retrieval without any positive confirmation or principle write.
  - Browser agent runs exercise the approval state machine and supervised executor only against an isolated page runtime, not the public network.
  - The agent kill/rollback drill passes while all product locks remain frozen.
  - Every TF-0009 acceptance criterion distinguishes engineering mechanism evidence from missing real-canary evidence.
  - Preflight reports agentSurrogateReady=true and l3Ready=false while human governance is missing.
  - A cold full runtime build publishes the stable SEKB host entry before the critical Electron matrix runs.
  - A complete synthetic governance object can pass the pure readiness validator without changing product defaults.
  - The TF-0009 proposal recommends review_needed rather than done and does not self-authorize downstream release.
  - Any later TF-0011 engineering release is represented by a separate confirmed proposal and a non-blocking evidence edge.
  - Product locks, TF-0006 blocked state, and C1 keep-off authority remain unchanged.
docs:
  required: true
  files:
    - docs/dev/tf0009-engineering-evidence-audit.md
    - docs/dev/component-operational-readiness-checklist.md
    - docs/dev/dcs-deep-test-week1-kickoff.md
    - docs/dev/dcs-ops-canary-runbook.md
    - docs/dev/first-product-controlled-preview/STATUS.md
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/handoffs/LATEST.md
---

# TF-0009 engineering evidence audit

Use this task spec for evidence classification, L3 start-readiness hardening, and the bounded
agent-surrogate engineering campaign. The campaign itself does not authorize a human canary,
real provider credentials, remote side effects, positive SEKB confirmation by an agent,
Task Forest apply, TF-0011 implementation, default-on, product approval, or GA. TF-0011 may
start only after its own explicitly confirmed governance proposal; that does not complete
TF-0009.
