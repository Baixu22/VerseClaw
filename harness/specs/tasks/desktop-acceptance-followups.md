---
id: desktop-acceptance-followups
title: Repair the remaining Windows desktop acceptance failures
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 8143c48a316ff191805e027119e145f461c60314
intent: Complete TF-0255 through TF-0258 using current agent-driven evidence, preserving product locks and existing budgets.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - scripts/copy-runtime-package.mjs
  - scripts/bundle-openclaw-runtime.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - tests/unit/copy-runtime-package.test.ts
  - harness/specs/tasks/desktop-acceptance-followups.md
docs:
  required: false
requiredTests:
  - pnpm exec vitest run tests/unit/copy-runtime-package.test.ts tests/unit/after-pack-cleanup.test.ts --maxWorkers=1
acceptance:
  - Windows runtime and MCP deliveries contain their installed dependency versions without external development links. Module resolution from a relocated delivery stays inside that delivery, and NSIS finishes with exit 0.
  - RC-10 H-02 through H-06 preserve permission and timeout boundaries and produce current events, decisions, continuations and receipts from an agent-driven clean candidate.
  - Startup chunk checks pass their existing budgets and math, chat and first-screen Electron flows remain functional.
  - Scheduled/Browser and Knowledge Hub pass the full suite without forced clicks. Required checkpoint, compaction, Git and model-scope entries have real wiring and Electron coverage; existing skips are accounted for individually.
  - Curated evidence includes clean candidate identity, reproducible command receipts, hashes, zero-hit credential scanning, and honest exclusions. No historical verdict is re-signed.
---

The owner requested all four remaining nodes on 2026-10-06. Work advances in
node order. Human interaction is automated and labelled `driven_by: agent`.
This task does not authorize publication, paid model calls or product graduation.
