---
id: runtime-lineage-convergence
title: Mission、Task Loop、DCS、SEKB 统一 lineage
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Reuse the existing Mission, Task Loop, Task Ledger, trace, DCS, and SEKB
  identifiers so one bounded run can be traced across the production path.
touchedAreas:
  - harness/specs/tasks/runtime-lineage-convergence.md
  - harness/specs/rules/runtime-lineage-boundary.md
  - openclaw_runtime/src/runtime-core/lineage.ts
  - openclaw_runtime/src/agents/mission-control/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts
  - openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts
  - openclaw_runtime/src/knowledge/sekb/**
  - tests/unit/**
  - tests/e2e/knowledge-hub.spec.ts
  - src/pages/Knowledge/index.tsx
  - shared/host-api/contract.ts
  - shared/i18n/locales/**/knowledge.json
  - shared/verseshell/extraction.ts
  - shared/verseshell/facade.ts
  - electron/services/knowledge-api.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/dev/handoffs/LATEST.md
  - docs/architecture-overview.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lineage-boundary
  - backend-communication-boundary
requiredTests:
  - openclaw_runtime/src/runtime-core/lineage.test.ts
  - openclaw_runtime/src/agents/task-loop-controller.dcs-phase-producer.test.ts
  - openclaw_runtime/src/knowledge/sekb/sekb.test.ts
acceptance:
  - A new Mission tick passes one normalized lineage object into its Task Loop.
  - Task Loop lifecycle events, task_state Blocks, and terminal SEKB trajectories carry the same available mission/tick/loop/trace/task-ledger identifiers.
  - Missing lineage fields on legacy records are omitted or safely downgraded; they are never guessed from sessionKey alone.
  - Confirmed SEKB provenance never claims a source trajectory that is absent from the suggestion or whose stored lineage conflicts with the source session.
  - No new workflow or memory authority, database table, automatic principle writeback, or product-lock change is introduced.
expectedUserBehavior:
  - A completed Mission tick can be opened in the Knowledge runtime view and its source trajectory shows the same session, mission, loop, trace, and Task Ledger lineage when those identifiers exist.
  - Confirming a suggested principle displays the persisted source trajectory IDs and session provenance, while a mismatched source session is rejected.
  - Legacy trajectories without lineage remain reviewable without fabricated identifiers.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

# TF-0072 execution contract

This is a narrow vertical slice. The existing Mission, Task Loop, Task Ledger,
DCS BlockStore, and SEKB KnowledgeStore remain authoritative in their domains.
The lineage value is correlation metadata only; it must not become a second
lifecycle writer or a reason to enable DCS/SEKB defaults.
