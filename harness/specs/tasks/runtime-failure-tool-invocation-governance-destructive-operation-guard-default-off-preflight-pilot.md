---
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Default-Off Preflight Pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the accepted default-off `destructive_operation_guard` preflight pilot, limited to mutation-capable tool invocation preflight, with flag-off legacy behavior and no other active consumers.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/config/**
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
expectedUserBehavior:
  - By default, tool behavior remains legacy behavior because `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` is omitted or false.
  - When the flag is explicitly true, only mutation-capable tool invocation preflight may evaluate sanitized preflight candidate metadata.
  - Flag-on blocking is limited to a fully evidence-qualified `destructive_operation_guard` candidate with deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, Phase 5 future block candidate metadata, `requiresAcceptedSpec=true`, and passing false-block corpus metadata.
  - Missing candidate metadata, non-preflight ownership, non-mutation-capable tools, invalid candidates, deleted path alone, missing edit metric failures, or failing false-block corpus metadata allow the tool path.
  - TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, and renderer code do not own or consume the active decision.
  - The pilot does not create default-on behavior, production rollout, broad shell pattern blocking, live provider reads, real workspace mutation proof, services, daemons, listeners, databases, exporters, or schedulers.
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
  - workspace-harness-single-source
featureFlags:
  - `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` is explicit and default-off.
  - Omitted or `false` means disabled.
  - The config schema accepts only boolean values for `enabled`.
  - Only explicit boolean `true` enables the preflight pilot.
  - Flag-off evaluation returns `legacyBehavior: true` and cannot block.
rollback:
  - Disable or omit `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` to restore legacy tool behavior.
  - Delete the pilot helper, hook import/context field, config schema entries, focused tests, task spec, handoff package, and parent doc entries if the pilot must be removed.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing state cleanup is required.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts
acceptance:
  - The flag defaults off and omitted settings preserve legacy tool behavior.
  - Flag-off evaluation returns an allow decision with `legacyBehavior: true`.
  - The config schema accepts only the strict nested flag path and does not synthesize defaults.
  - The only active runtime consumer is `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`, the accepted mutation-capable tool invocation preflight owner.
  - The pilot consumes explicit sanitized preflight candidate metadata only; it does not run replay, scorecard, governance, advisory, or evidence proof helpers on the active path.
  - Flag-on blocking requires all accepted trigger signals at the same time and never treats deleted touched-path metadata alone as sufficient.
  - False-block corpus metadata must pass before a block is possible.
  - Focused tests cover flag-off legacy behavior, flag-on pilot behavior, non-mutation-capable allow behavior, missing candidate allow behavior, false-block trigger protection, sanitized diagnostics, config schema strictness, boundary scans, and rollback proof.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint, lifecycle, Electron service, renderer, or script path is added as an active consumer.
  - This phase stops after the default-off pilot implementation and does not begin Phase E holdout expansion.
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, checkpoint behavior, lifecycle behavior, renderer behavior, Electron service behavior, or default tool behavior
  - adding active consumers outside mutation-capable tool invocation preflight
  - defaulting the pilot on or default-blocking tools
  - running replay, scorecard, governance advisory, or evidence proof helpers as active preflight proof
  - using deleted touched-path metadata alone, broad shell command patterns, slow command metadata alone, or known dev-server-like long-running metadata as an active trigger
  - writing guard decisions, replay reports, scorecards, governance reports, evidence proof reports, failure events, evidence envelopes, raw prompts, provider payloads, tool args/results, secrets, environment dumps, or workspace content into checkpoint or lifecycle authority state
  - reading live providers, executing real tool mutation, modifying the real workspace for proof, scanning unbounded workspace content, or using live provider/tool data as proof
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
  - treating this pilot, replay reports, scorecards, governance reports, evidence proof output, evidence, failure events, proposal docs, boundary docs, or handoff docs as task completion proof
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-pilot/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Default-Off Preflight Pilot

This Phase D package implements the accepted default-off `destructive_operation_guard` preflight pilot.

The concrete active owner is `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`, specifically `runBeforeToolCallHook`, because that is the mutation-capable tool invocation preflight layer. The pilot remains disabled unless `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` is explicit boolean `true`.

The runtime-core helper evaluates only caller-supplied sanitized preflight candidate metadata. It does not invoke replay, scorecard, governance advisory, or evidence proof helpers. Missing metadata or disabled flag preserves the legacy allow path.

This phase does not approve production/default-on behavior and does not begin Phase E holdout expansion.
