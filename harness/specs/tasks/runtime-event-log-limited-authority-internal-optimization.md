---
id: runtime-event-log-limited-authority-internal-optimization
title: Runtime event-log limited authority internal optimization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Improve the maintainability and reviewability of the limited-authority deep evaluation package without changing runtime behavior, authority, wiring, schemas, API, UI, provider transport, TaskLoop defaults, or completion proof semantics.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-internal-optimization/**
  - tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts
  - tests/unit/helpers/runtime-event-log-limited-authority-deep-eval.ts
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-internal-optimization/**
  - tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts
  - tests/unit/helpers/runtime-event-log-limited-authority-deep-eval.ts
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - No default event-log authority.
  - No broad runtime cutover.
  - No TaskLoop default wiring.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source outside explicit helper invocation.
  - Internal optimization output may recommend only blocked_before_internal_optimization, needs_more_limited_authority_optimization_evidence, or ready_for_explicit_internal_wiring_spec_or_next_optimization.
  - ready_for_explicit_internal_wiring_spec_or_next_optimization permits only a later fresh spec; it does not approve wiring, cutover, default-on behavior, schema/API/UI/provider/transport changes, TaskLoop default decisions, replay side effects, or completion proof.
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
forbiddenPatterns:
  - default-on event-log authority, event-log-first resume ordering by default, replacing long_task_checkpoints for all sessions, cutover_enabled output, event_log_authoritative output, default_on output, default-on output, defaultOn output, prefer_event_log output, runtime.resume.preferEventLog, or active authority from scorecard output
  - TaskLoop default wiring, TaskLoop final status changes, TaskLoop decision behavior changes, lifecycle payload changes, persisted checkpoint payload changes, reviewer prompt changes, model message changes, provider ordering changes, retry policy changes, approval policy changes, verifier authority changes, or tool permission authority changes
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, public API surface, or product settings
  - calling Gateway/Main/renderer/provider transport, replaying side effects, executing tools from replay, applying patches from replay, sending messages, writing workspace files from replay, or invoking provider transport
  - raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, raw event payloads, raw checkpoint payloads, or unbounded diagnostics in evaluation or optimization output
  - treating helper reports, diagnostics, scorecards, replay comparison, retention summaries, evidence review output, deep evaluation output, or optimization output as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - Any future explicit wiring flag must be covered by a later fresh spec.
rollback:
  - Remove this task spec.
  - Remove the internal optimization handoff.
  - Remove the test-only deep evaluation helper.
  - Restore the focused deep-evaluation unit test to inline builders if needed.
  - Revert only the runtime index pointer update for this optimization line.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - git diff --check -- harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/helpers/runtime-event-log-limited-authority-deep-eval.ts
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|default_on|default-on|defaultOn" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/helpers/runtime-event-log-limited-authority-deep-eval.ts
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl|raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-internal-optimization.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/helpers/runtime-event-log-limited-authority-deep-eval.ts
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - The task creates only a fresh internal optimization spec, test-only helper, focused test update, handoff package, and runtime index pointer update.
  - The helper uses at least 60 deterministic synthetic cases and only calls existing pure runtime helper functions.
  - Fixture/corpus duplication in the deep-evaluation test is reduced by moving reusable builders into a test-only helper.
  - Diagnostics are grouped by gate family for test/report readability only: opt-in / explicit invocation, operator gate / kill switch, controlled dual-read evidence, veto gates, boundary proof, rollback proof, and bounded diagnostics / leakage.
  - Helper report runtime shape is not changed; diagnostic grouping is a pure test helper wrapper.
  - Scorecard thresholds are centralized and explicit.
  - Passing metrics remain failClosedRate 1, cleanReadyRate 1, vetoBlockRate 1, boundarySensitivityRate 1, rollbackSensitivityRate 1, forbiddenStringLeakCount 0, defaultAuthorityDriftCount 0, taskLoopDecisionDriftCount 0, schemaApiUiProviderTransportDriftCount 0, diagnosticsBoundedRate 1, score >= 95, and hardVetoCount 0.
  - Internal optimization output may contain only blocked_before_internal_optimization, needs_more_limited_authority_optimization_evidence, or ready_for_explicit_internal_wiring_spec_or_next_optimization.
  - The handoff includes a compact metric table, hard-veto summary, optimization recommendation matrix, validation results, boundary scan counts, and an explicit note that reports, scorecards, and diagnostics are not completion proof.
  - No default-on event-log authority, broad runtime cutover, TaskLoop default wiring, schema/API/UI/provider/transport change, replay side effect, sidecar, service, DB/table/file creation, or prompt/model-message/policy change is introduced.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Limited Authority Internal Optimization

This task is an internal optimization of the existing limited-authority deep evaluation package.
It keeps the package evaluation-only and non-authoritative while improving maintainability and review efficiency.

## Optimization Targets

- Deduplicate the deterministic limited-authority corpus and controlled dual-read fixture builders into a test-only helper.
- Centralize scorecard thresholds so future tests and specs cannot accidentally loosen readiness gates.
- Group diagnostics by gate family for test/report readability without changing runtime helper output shape.
- Improve the handoff report with compact metrics, hard-veto summary, and a recommendation matrix.

The only ready decision is `ready_for_explicit_internal_wiring_spec_or_next_optimization`.
That decision does not approve event-log default authority, broad runtime cutover, TaskLoop default wiring, schema/API/UI/provider/transport changes, replay side effects, or completion proof from helper output.
