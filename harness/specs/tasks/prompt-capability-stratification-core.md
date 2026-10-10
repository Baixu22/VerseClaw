---
lifecycleStatus: archived
id: prompt-capability-stratification-core
title: Prompt Capability Stratification Core
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Land the lightweight PCS-v1.2 governance core for runtime intensity contributions: PromptSourceCatalog, PromptAssemblyLedger, and PromptAssemblyMatrix without creating a new orchestrator or storing raw prompt text.
touchedAreas:
  - harness/specs/tasks/prompt-capability-stratification-core.md
  - openclaw_runtime/src/agents/prompt-governance/prompt-source-catalog.ts
  - openclaw_runtime/src/agents/prompt-governance/prompt-assembly-ledger.ts
  - openclaw_runtime/src/agents/prompt-governance/prompt-assembly-matrix.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/intensity-policy.ts
  - tests/unit/prompt-governance.test.ts
  - tests/unit/runtime-intensity-policy.test.ts
expectedUserBehavior:
  - Runtime intensity prompt text is registered as a dynamic L4 contribution with a fixed char budget and no runtime reducer.
  - Every assembled intensity contribution has an append-only ledger record with hashes and requested/effective metadata, never raw prompt text.
  - The assembly matrix covers effort x model-support x route and proves linked-v1 intensity stability.
  - Non-builtin routes report prompt-only adherence and never claim full parity.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - chat-loop-boundary
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/prompt-governance.test.ts tests/unit/runtime-intensity-policy.test.ts tests/unit/prompt-quality-budget.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - PromptSourceCatalog has unique registered entries for runtime.intensity.prompt and runtime.intensity.harness_behavior.
  - Intensity prompt text is <= 400 chars and fails closed over budget.
  - PromptAssemblyLedger validation reports zero unregistered contributions for intensity entries.
  - PromptAssemblyMatrix validation reports zero intensity drift for covered cases.
docs:
  required: true
  files:
    - docs/architecture-overview.md
---

Catalog/Ledger/Matrix are evidence surfaces, not a new prompt authority. Context Engine remains an adapter.
