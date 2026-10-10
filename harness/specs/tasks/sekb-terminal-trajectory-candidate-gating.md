---
lifecycleStatus: archived
id: sekb-terminal-trajectory-candidate-gating
title: SEKB terminal trajectory candidate gating and deduplication
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Gate SEKB distillation suggestions on real terminal agent trajectories and
  remove duplicate terminal captures using the existing runtime lineage.
touchedAreas:
  - harness/specs/tasks/sekb-terminal-trajectory-candidate-gating.md
  - openclaw_runtime/src/knowledge/sekb/trajectory-capture.ts
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/knowledge/sekb/terminal-trajectory-gating.test.ts
  - openclaw_runtime/src/knowledge/sekb/sekb.test.ts
  - openclaw_runtime/src/knowledge/sekb/harness-integration.ts
  - openclaw_runtime/src/knowledge/sekb/harness-integration.test.ts
  - openclaw_runtime/src/knowledge/sekb/golden-path.ts
  - openclaw_runtime/src/knowledge/sekb/golden-path.test.ts
  - openclaw_runtime/src/knowledge/sekb/batch-distillation-assistant.test.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.task-state.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-controller.dcs-phase-producer.test.ts
  - artifacts/comms/current-metrics.json
  - artifacts/comms/compare-report.md
  - docs/enhancements/sekb-mvp.md
  - docs/enhancements/sekb-runtime-roadmap.md
expectedUserBehavior:
  - Terminal-only task-state notifications do not create distillation candidates.
  - A candidate source has persisted real tool-call/tool-result evidence and a
    complete runtime lineage when the producer has one.
  - Replayed terminal capture for the same run/trace is idempotently ignored.
  - Human confirmation remains the only durable principle/experience write path.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - sekb-runtime-development-loop
  - runtime-lineage-boundary
  - dcs-stage5-sekb-closure-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/sekb-terminal-trajectory-candidate-gating.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts src/knowledge/sekb/harness-integration.test.ts src/knowledge/sekb/terminal-trajectory-gating.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/agents/embedded-agent-runner/extensions.task-state.test.ts src/agents/task-loop-controller.dcs-phase-producer.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/sekb-terminal-trajectory-candidate-gating.md
acceptance:
  - Distillation suggestions contain only trajectories with at least one real
    tool.call or tool.result step and a terminal outcome.
  - When runtime lineage is available, candidate source trajectories have a
    valid sessionId, run identity, and trace identity; missing legacy lineage
    remains readable but is not promoted into a new candidate.
  - Repeated terminal capture with the same run/trace lineage returns the
    existing trajectory identity and does not add a second source row.
  - Duplicate source ids and duplicate candidate clusters are deterministic and
    do not produce repeated suggestions.
  - suggest_principles_from_trajectories remains advisory and never writes a
    principle, experience Block, or other durable knowledge.
  - confirm_and_save remains the only durable L2/experience write path.
  - SEKB remains default-off; liveReady, productApproved, and defaultOn remain
    false.
docs:
  required: true
  references:
    - docs/enhancements/sekb-mvp.md
    - docs/enhancements/sekb-runtime-roadmap.md
---

# Scope

This card consumes the bounded `runtime-lineage.v1` metadata delivered by
TF-0072. It does not add a workflow owner, a new persistence format, a batch
distillation path, or autonomous confirmation.

## RED -> GREEN

Add focused failing coverage for:

1. empty terminal captures being excluded from suggestions;
2. captures with tool evidence but no usable lineage being excluded from the
   new terminal candidate path;
3. repeated terminal events for one run/trace returning one trajectory; and
4. duplicate source ids/clusters producing one deterministic suggestion.

The implementation must reuse `TrajectoryCapture`, `KnowledgeStore`, and the
existing AgentHarness/TaskLoop phase seams. Legacy trajectories remain readable
for reports and deletion, but are not silently upgraded into new candidates.

## Boundaries

- No renderer or Electron UI changes.
- No automatic principle or experience write-back.
- No inference of mission/tick/trace ids from a session key.
- No raw prompts, tool payloads, credentials, or transcript text in lineage.
- No changes to default flags or product-approval state.
