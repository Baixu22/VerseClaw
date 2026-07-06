# Runtime Event Log Limited Authority Explicit Internal Wiring

Status: ready_for_explicit_internal_wiring_review
Date: 2026-07-02

This handoff records a fresh spec and runtime-core pure readiness component for Workflow Checkpoint Engine review/spec progression. It does not implement runtime behavior wiring, does not enable event-log resume authority, does not wire TaskLoop, does not switch runtime authority, and does not change Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

Reports, diagnostics, scorecards, deep-evaluation output, internal optimization output, explicit internal wiring readiness output, and boundary output are not task completion proof.

## Phase 1 Findings

1. The prior boundary permits only explicit internal wiring readiness review at the Workflow Checkpoint Engine layer. It permits a later fresh spec and a bounded runtime-core readiness component, not production runtime wiring.
2. The allowed inputs are caller-provided controlled dual-read report, limited-authority cutover report, internal optimization scorecard, thresholds, and diagnostic grouping summary.
3. The output decision set is `blocked_before_explicit_internal_wiring`, `needs_more_internal_wiring_evidence`, and `ready_for_explicit_internal_wiring_review`.
4. The component belongs in `runtime-core` only as a pure readiness/diagnostic helper. Its entry is tightened by requiring `explicitInvocation: true` and `callerProvidedInputs: true`; without those gates it fails closed.
5. Forbidden paths remain resume authority, default event-log enablement, TaskLoop default decisions, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport, schema/table/index/migration, DB/JSON/JSONL/TXT sidecars, services/listeners/daemons/servers/exporters/collectors, replay side effects, prompt/model-message/provider-ordering/retry/approval/tool-policy, and completion proof semantics.

## Phase Output

Files owned by this package:

- `harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md`
- `openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts`
- `runtime-research/handoffs/runtime-event-log-limited-authority-explicit-internal-wiring/README.md`
- `runtime-research/agent-runtime-index.md`

The runtime-core readiness component consumes only:

- controlled dual-read report;
- limited-authority cutover report;
- internal optimization scorecard;
- internal optimization thresholds;
- diagnostic grouping summary.

The only runtime-core public API added is `buildRuntimeEventLogLimitedAuthorityExplicitInternalWiringReadiness` plus its report/input types. It is an explicit pure function and is not called by TaskLoop, resume defaults, Gateway, UI, API, schema, provider transport, persistence, services, prompts, model messages, retry, approval, tool policy, or completion proof paths.

## Component Positioning

| Field | Position |
|---|---|
| Layer | `runtime-core` |
| Component kind | pure readiness/diagnostic component |
| Entry | explicit function call with `explicitInvocation: true` and `callerProvidedInputs: true` |
| Inputs | caller-provided helper reports, scorecard, thresholds, and diagnostic grouping summary |
| Output | review/spec progression report only |
| Authority | none; `long_task_checkpoints` remains default authoritative |
| Not a | TaskLoop decision component; resume authority selector; Gateway route; UI/API surface; schema/persistence component; provider transport hook; completion proof |

The component is normally usable by importing it from `openclaw_runtime/src/runtime-core` and explicitly passing already-built caller-provided evidence. Its ready decision is review readiness only, not production availability.

## Coupling Assessment

| Field | Value |
|---|---|
| couplingStatus | healthy |
| integrationPoint | Workflow Checkpoint Engine explicit internal wiring readiness |
| consumedInputs | controlled dual-read report; limited-authority cutover report; internal optimization scorecard; internal optimization thresholds; diagnostic grouping summary |
| forbiddenDependencies | resume authority changes; default event-log enablement; TaskLoop default decisions; Gateway transport; Electron IPC; renderer UI; host-api or api-client contracts; shared transport contracts; provider transport; schema table index migration; DB JSON JSONL TXT sidecar writes; service listener daemon server exporter collector; replay side effects; prompt model-message provider-ordering retry approval tool-policy; completion proof from helper reports |
| authorityRisk | low |
| redundancyRisk | low |
| maintenanceRisk | low |
| decisionImpact | review/spec progression only; runtime behavior remains unchanged |
| nextAllowedStep | Workflow Checkpoint Engine review of explicit internal wiring readiness; no direct runtime wiring |
| hardVetoCount | 0 |
| conclusion | ready_for_explicit_internal_wiring_review |

## Hard-Veto Summary

Hard veto count is `0` for the ready input.

The runtime-core readiness component blocks before explicit internal wiring when:

- controlled dual-read report is missing or not ready;
- limited-authority cutover report is not ready;
- scorecard hard veto count is non-zero;
- authority boundary flags drift away from unchanged/false values.

The runtime-core readiness component returns `needs_more_internal_wiring_evidence` when the score is below threshold without a hard veto.

## Boundary Position

This package may output only:

- review/spec progression decision;
- bounded diagnostics;
- coupling assessment;
- hard veto summary;
- authority boundary summary.

This package may not:

- change resume authority;
- enable event-log by default;
- connect to TaskLoop default decisions;
- add Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport work;
- add schema/table/index/migration work;
- write DB, JSON, JSONL, TXT, or sidecar state;
- start a service, listener, daemon, server, exporter, or collector;
- replay side effects;
- change prompts, model messages, provider ordering, retry, approval, or tool policy;
- treat helper reports, scorecards, readiness decisions, or diagnostics as completion proof.

## Validation Results

Commands were run directly because `rtk` is unavailable in this shell.

Passed:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md --no-diff`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 5 files passed, 27 tests passed.
- `pnpm run typecheck`
  - Result: node and web TypeScript projects passed.
- `pnpm --dir openclaw_runtime db:kysely:check`
- `pnpm --dir openclaw_runtime lint:kysely`
- `git diff --check -- harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts openclaw_runtime/src/runtime-core/index.ts runtime-research/handoffs/runtime-event-log-limited-authority-explicit-internal-wiring/README.md tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts runtime-research/agent-runtime-index.md`
  - Result: passed with line-ending warnings for `openclaw_runtime/src/runtime-core/index.ts` and `runtime-research/agent-runtime-index.md`.

Expected or unrelated results:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md`
  - Failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this task's touched areas. The same spec passes with `--no-diff`.

Comms replay/compare are not expected because this package does not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Scan Classification

Required scans were run with broad and touched-path counts.

- Forbidden authority/default-on scan:
  - broad count: 1460.
  - touched-path count: 73.
  - Classification: touched hits are spec/handoff boundary text, required scan commands, test forbidden-string assertions, and historical index language. No touched path grants event-log authority, disables legacy authority, or enables default-on behavior.
- Transport surface scan:
  - broad count: 27.
  - touched-path count: 2.
  - Classification: touched hits are only required scan-command text. No Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, or direct transport surface was added.
- Schema-write scan:
  - broad count: 281.
  - touched-path count: 26.
  - Classification: touched hits are forbidden-boundary text, rollback language, validation commands, test authority-boundary assertions, and historical index migration language. No schema/table/index/migration or persistence write path was added.
- Service/sidecar scan:
  - broad count: 2204.
  - touched-path count: 81.
  - Classification: touched hits are boundary text, rollback language, validation commands, test forbidden-dependency assertions, and historical index language. No service/listener/daemon/server/sidecar/exporter/collector/JSONL implementation was added.
- Raw/leakage scan:
  - broad count: 17.
  - touched-path count: 95.
  - Classification: touched hits are boundary text, validation commands, test completion-proof assertions, and historical index raw-retention language. No raw SQLite rows, raw `record_json`, raw checkpoint payload, raw tool args/output, transcripts, prompts, env, secrets, auth material, or unbounded diagnostics are emitted by this package.
- Combined touched-path classification scan:
  - touched-path count: 199.
  - Classification: docs/spec/index/runtime-core readiness boundary declarations, validation commands, coupling assessment assertions, rollback language, and historical index entries only.

## Docs Sync

README translation updates are not required because this package introduces no user-visible behavior, public API, product settings, renderer UI, Gateway/API behavior, or default runtime behavior. The durable docs for this package are this task spec, this handoff, and the runtime index pointer.

## Remaining Boundaries

- No default-on event-log authority.
- No broad runtime cutover.
- No default TaskLoop wiring.
- No runtime behavior change.
- No schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No replay side effects.
- `long_task_checkpoints` remains default authoritative.
- No treating helper reports, diagnostics, scorecards, replay comparison, retention summaries, deep-evaluation output, internal optimization output, explicit internal wiring readiness output, or boundary output as completion proof.
