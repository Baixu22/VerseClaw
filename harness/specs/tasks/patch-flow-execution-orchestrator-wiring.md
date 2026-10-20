---
lifecycleStatus: active
id: patch-flow-execution-orchestrator-wiring
title: Execute patch-flow proposals after overlapping orchestration workers complete
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: be19c3c66
intent: >-
  Wire applyPatchProposalsSerial into the real deferred orchestration completion
  path. A caller must explicitly opt in and the advisory must recommend
  patch-flow; workers then operate proposal-only and the lead-side completion
  path serially applies their extracted apply_patch proposals. Failures are
  recorded best-effort and never block verifier startup or the main flow.
scenarios:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - coding-runtime-workspace-dcs-producer-boundary
  - dcs-stage5-sekb-closure-boundary
expectedUserBehavior:
  - Explicit patchFlowExecution=true plus a patch-flow advisory starts proposal-only workers; advisory alone never executes patch-flow.
  - Proposal-only workers cannot use write/edit/apply_patch/bash/exec and must return one fenced apply_patch proposal.
  - Once every expected worker has completed, the orchestration completion path extracts proposals and calls applyPatchProposalsSerial in the real workspace.
  - Serial apply failures or destructive holds are recorded in orchestration metadata and do not block the deferred verifier.
  - runtime.coding.patchFlow.default remains false and no default isolation or product lock changes.
touchedAreas:
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestration-patch-flow.ts
  - openclaw_runtime/src/agents/orchestration-patch-flow.test.ts
  - openclaw_runtime/src/agents/subagent-registry.ts
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - docs/generated/catalogs/tools.md
  - harness/specs/tasks/patch-flow-execution-orchestrator-wiring.md
docs:
  required: false
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/patch-flow-execution-orchestrator-wiring.md
  - pnpm harness validate --spec harness/specs/tasks/patch-flow-execution-orchestrator-wiring.md
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.unit-fast.config.ts src/agents/orchestration-patch-flow.test.ts src/agents/patch-flow.test.ts src/agents/patch-flow-graduation.test.ts --reporter=verbose
  - pnpm run catalogs:check
  - pnpm exec eslint openclaw_runtime/src/agents/subagent-registry.types.ts openclaw_runtime/src/agents/orchestrator-run-observed.ts openclaw_runtime/src/agents/orchestration-patch-flow.ts openclaw_runtime/src/agents/orchestration-patch-flow.test.ts openclaw_runtime/src/agents/subagent-registry.ts shared/dcs/prod-flags-catalog.ts
  - pnpm run typecheck
acceptance:
  - The production deferred orchestration path calls applyPatchProposalsSerial after all expected workers complete and before verifier startup.
  - Proposal extraction reads real frozen worker completion output and preserves worker identity/write-set provenance.
  - Proposal-only mode hard-denies direct write and shell tools and instructs workers to emit exactly one fenced apply_patch proposal.
  - A focused test applies two real proposals serially in a temporary workspace and proves output files changed.
  - A focused failure test proves apply errors/holds are recorded and never thrown to the verifier path.
  - A focused regression proves omitted/false patchFlowExecution keeps worker context and metadata unchanged.
  - runtime.coding.patchFlow.default remains false; no default-on, product lock, or real-human claim is introduced.
notes:
  - Agent-driven soak evidence is generated from the focused real-disk serial-apply tests and recorded as driven_by: agent.
  - This task intentionally does not flip patchFlow.default or auto-switch isolation.
---
