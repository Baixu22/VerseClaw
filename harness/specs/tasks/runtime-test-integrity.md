---
lifecycleStatus: archived
id: runtime-test-integrity
title: Runtime test contracts and default runner integrity
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Repair TF-0253 test fixture contract drift and the missing default test runner without weakening type checks or dropping requested files.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Explicit runtime test targets run through the existing Vitest project matrix.
docs:
  required: true
  paths:
    - docs/dev/runtime-test-integrity.md
touchedAreas:
  - openclaw_runtime/extensions/anthropic/stream-wrappers.test.ts
  - openclaw_runtime/extensions/memory-core/src/memory/manager-reindex-state.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-addressability.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-budget-shadow.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-promotion.test.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-safeguard-p6.test.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.cancellation.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node-phases.abort.test.ts
  - openclaw_runtime/src/agents/bash-tools.exec-host-node.abort.test.ts
  - openclaw_runtime/src/agents/goal-wake-runtime.test.ts
  - openclaw_runtime/src/agents/harness/selection.compass.test.ts
  - openclaw_runtime/src/agents/long-task-control/stage3-working-context.test.ts
  - openclaw_runtime/src/agents/mission-control/fenced-tick-wiring.test.ts
  - openclaw_runtime/src/agents/openai-transport-stream-responses-input.test.ts
  - openclaw_runtime/src/agents/stage1-tool-guard.test.ts
  - openclaw_runtime/src/agents/stage4-tool-guard.test.ts
  - openclaw_runtime/src/context-engine/source-set.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity-projection.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-lifecycle-consistency.test.ts
  - openclaw_runtime/src/gateway/server-methods/session-lifecycle-ledger.test.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.channel-start.test.ts
  - openclaw_runtime/src/gateway/session-drain-service.test.ts
  - openclaw_runtime/src/gateway/session-ecosystem-reclamation-cycle.test.ts
  - openclaw_runtime/src/gateway/session-reset-service.stop.test.ts
  - openclaw_runtime/src/gateway/session-reset-service.subagent-stop.test.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.test.ts
  - openclaw_runtime/src/knowledge/governance-lifecycle.test.ts
  - openclaw_runtime/src/knowledge/ks09-surface-report.test.ts
  - openclaw_runtime/src/plugin-sdk/provider-stream-shared.test.ts
  - openclaw_runtime/test/extension-import-boundaries.test.ts
  - openclaw_runtime/extensions/memory-wiki/src/apply-lifecycle.test.ts
  - openclaw_runtime/test/tsconfig/tsconfig.extensions.test.json
  - openclaw_runtime/test/scripts/test-projects.test.ts
  - openclaw_runtime/test/vitest/vitest.pattern-file.ts
  - openclaw_runtime/src/context-engine/chat-knowledge-source-adapters.ts
  - openclaw_runtime/extensions/memory-wiki/runtime-api.ts
  - openclaw_runtime/scripts/test-projects.mjs
  - openclaw_runtime/scripts/explicit-test-targets.mjs
  - openclaw_runtime/package.json
  - openclaw_runtime/scripts/run-vitest.mjs
  - harness/specs/tasks/runtime-test-integrity.md
  - docs/dev/runtime-test-integrity.md
  - artifacts/runtime-test-integrity/report.json
  - artifacts/runtime-test-integrity/credential-scan.json
  - artifacts/runtime-test-integrity/SHA256SUMS
requiredTests:
  - pnpm --dir openclaw_runtime exec tsgo --noEmit -p test/tsconfig/tsconfig.core.test.json --incremental false
  - pnpm --dir openclaw_runtime exec tsgo --noEmit -p test/tsconfig/tsconfig.extensions.test.json --incremental false
  - pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.core.json --incremental false
  - pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.extensions.json --incremental false
acceptance:
  - Both complete nonincremental test type gates pass without suppressions, any widening, coverage removal, or compiler relaxation.
  - The default runner executes explicit targets across projects and produces JSON containing every requested file and nonzero tests; missing targets fail.
  - Production core and extensions type checks remain passing; before and after exits and actual regression results are recorded as agent-driven evidence.
notes:
  - TF-0253 is the only node advanced. Existing dirty work and historical evidence are preserved; no release or product lock changes.
---
