---
lifecycleStatus: active
id: recovery-tool-redispatch
title: Resume durably admitted tool calls through the existing executor
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Complete TF-0719 by binding durable dispatch to the session generation and arguments, committing effect_pending before execution, and executing authorized pending calls before transcript repair.
diffBase: f719c3688
humanEvidence: not-required
touchedAreas:
  - openclaw_runtime/src/agents/command/attempt-execution.shared.ts
  - openclaw_runtime/src/agents/command/session.ts
  - openclaw_runtime/src/agents/command/session-store.ts
  - tests/unit/session-lifecycle-generation-barrier.test.ts
  - openclaw_runtime/src/gateway/session-lifecycle-state.ts
  - openclaw_runtime/src/config/sessions/store-load.ts
  - openclaw_runtime/src/auto-reply/reply/get-reply.ts
  - openclaw_runtime/src/auto-reply/reply/dispatch-from-config.ts
  - openclaw_runtime/src/auto-reply/reply/agent-runner.ts
  - openclaw_runtime/src/agents/agent-command.ts
  - openclaw_runtime/src/agents/execution-phase/**
  - openclaw_runtime/src/agents/agent-tool-definition-adapter.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery.flow.test.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.recovery-order.test.ts
  - openclaw_runtime/src/tasks/task-flow-cas.ts
  - openclaw_runtime/src/tasks/task-flow-cas.test.ts
  - openclaw_runtime/src/tasks/task-flow-registry.store.sqlite.ts
  - openclaw_runtime/src/tasks/workflow-lifecycle-owner.ts
  - openclaw_runtime/src/state/openclaw-state-*.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/agents/cross-area/cross-area-facades.ts
  - openclaw_runtime/src/agents/sessions/session-manager.ts
  - openclaw_runtime/src/agents/session-tool-result-guard-wrapper.ts
  - openclaw_runtime/src/infra/recovery-eval-probe.ts
  - openclaw_runtime/src/config/sessions/store-sqlite.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/plugins/session-entry-slot-keys.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/sessions/user-turn-transcript.ts
  - tests/e2e/recovery-contract-eval.spec.ts
  - tests/e2e/recovery-longsession-eval.spec.ts
  - tests/e2e/fixtures/recovery-contract-probe.ts
  - tests/e2e/fixtures/recovery-live-proxy.ts
  - tests/unit/recovery-live-proxy.test.ts
  - tests/unit/recovery-observation.test.ts
  - tests/e2e/fixtures/electron.ts
  - shared/long-session-continuity.ts
  - shared/types/session-activity.ts
  - shared/types/session-delegation.ts
  - shared/types/git.ts
  - shared/host-api/host-action-timeouts.ts
  - electron/services/sessions-api.ts
  - tests/unit/host-services.test.ts
  - tests/unit/host-action-timeouts.test.ts
  - shared/recovery-quality-readback.ts
  - tests/unit/recovery-quality-readback.test.ts
  - scripts/rsi-sekb-arms.d.mts
  - scripts/recovery-contract-matrix.mjs
  - scripts/recovery-contract-acceptance.mjs
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/session-manager-init.ts
  - openclaw_runtime/packages/agent-core/src/agent-loop.ts
  - harness/specs/tasks/recovery-tool-redispatch.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/fixtures/recovery-contract-eval/**
  - docs/dev/recovery-contract/**
  - scripts/recovery-contract-eval.mjs
  - tests/unit/recovery-contract-eval.test.ts
  - .gitignore
  - scripts/repository-artifacts.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
expectedUserBehavior:
  - The existing opt-in execution-phase writer can recover a durably admitted but unstarted tool call without asking the model to repeat it.
  - Unknown outcomes, legacy unbound rows, changed arguments, and missing durable authorization never execute automatically.
  - Normal tool validation, policy hooks, abort handling, and transcript persistence apply to recovered calls.
requiredTests:
  - tests/unit/session-lifecycle-generation-barrier.test.ts
  - openclaw_runtime/src/agents/main-session-restart-recovery.flow.test.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.recovery-order.test.ts
  - tests/unit/recovery-contract-eval.test.ts
  - tests/unit/recovery-quality-readback.test.ts
  - tests/unit/recovery-observation.test.ts
  - tests/unit/recovery-live-proxy.test.ts
  - openclaw_runtime/src/agents/execution-phase/redispatch.test.ts
  - openclaw_runtime/src/agents/execution-phase/store.test.ts
  - openclaw_runtime/src/agents/execution-phase/recovery.test.ts
acceptance:
  - Same-session late terminal events cannot finish a different lifecycle run; stale starts cannot roll ownership backward, and command metadata snapshots preserve the live lifecycle projection.
  - A continuation error before lifecycle start can settle its newer attempt when its explicit attempt start is later than the stored lifecycle start; arrival time alone does not admit a different run.
  - A pending final keeps its admitted continuation identity across RPC failures before lifecycle start, including subsequent interrupted transcript boundaries.
  - Startup recovery is scheduled only after stale-lock cleanup has persisted aborted-session markers; shutdown during cleanup prevents the later recovery schedule.
  - New dispatch records include a versioned boundary, sessionKey, sessionId, toolCallId, and argument digest; no raw arguments or results enter SQLite.
  - effect_pending commits before tool.execute and a duplicate claim cannot execute a second effect.
  - Startup preserves pending dispatches; unknown outcomes and storage errors fail closed.
  - Pending calls are read from the active transcript and executed with the existing validated executor before synthetic-result repair and before the next model request.
  - A persisted real result prevents replay; unrelated generations and changed arguments cannot acquire authorization.
  - User intent, assistant tool dispatch and real tool results are flushed to stable storage before their next acknowledged boundary; flush and synchronous dispatch-commit failures stop continuation.
  - Recovery prompts, routing and shadow facts accept pending finals only when their durable producer or admitted recovery run matches the lifecycle run; attempt timestamps never determine ownership; asynchronous acknowledgement cannot replace a newer pending payload or discard an older delivery owned by its sender.
  - Fault sampling waits for warmup terminal lifecycle and pending-delivery settlement before arming the probe; the frozen injection window and observation budgets remain unchanged.
  - A newer user turn excludes older assistant calls from recovery; shadow records the observed resume outcome rather than predicting RPC success.
  - Process interruption tests inspect disk state and prove one effect for a pre-execution crash and zero replays for an uncertain effect.
  - Measurement adapters retain the observed injection point rather than substituting the frozen annotation.
  - Defaults and product locks remain unchanged; focused proof does not claim a passing full evaluation.
  - Execution phase and status use the same flow_runs row and TaskFlow revision CAS; no active execution_phases writer remains after migration.
  - The execution writer is active only when both execution and Task Loop lifecycle writers select taskflow.
  - The formal five-window instrument preserves observed injection points, verifies durable artifacts and hashes, counts append-only effects, and restarts the same work in K5.
  - A timeout after a verified injected boundary retains the final disk snapshot, timeout flag and failed trial; it is never omitted or replaced by a successful retry. Setup failures before a boundary remain explicitly counted non-measurements.
  - K4 validates the hashed failed-write.json probe point and throw action rather than a nonexistent receipt hit field; both initial user-intent windows filter the exact target text to exclude heartbeat turns.
  - A failure between repeated kill boundaries writes an incomplete trial with the actual snapshot/error and crash count; missing outcome counters stay null and cannot become complete window evidence.
  - The live-provider proxy aborts upstream I/O when its caller disconnects or the fixture closes; a terminal assistant error ends the failed attempt without becoming quality evidence.
  - Fresh baseline and candidate runs use the unchanged frozen manifest; all acceptance claims follow the measured result.
  - Quality reports recompute every saved post-boundary assistant answer with one versioned judge, preserve the preliminary score and answer hash, and separate JSON schema compliance from factual fidelity.
docs:
  required: true
  files:
    - docs/dev/recovery-contract/REDISPATCH-20261104.md
---

The earlier implementation recorded `dispatched` while the tool was already running,
omitted the session/call binding, and settled that row as failed before recovery.
Those rows do not prove an unstarted effect. Only new versioned dispatch records,
claimed by a CAS to `effect_pending` before execution, authorize this continuation.
The existing domain journal remains effect truth. A synthetic transcript result
or a model-facing retry instruction never grants execution authority.
