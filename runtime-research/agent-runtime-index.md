# Agent Runtime Index

这是后续开发 agent 的入口索引。目标是让任何新 agent 接手时，不必重新翻整套研究材料，也不会丢失阶段进度。

## How To Use

1. 先读本文件。
2. 根据任务类型跳到 `Read For Task`。
3. 再读对应项目的 `clawx-mapping.md`、`useful-tests.md` 和必要专题文档。
4. 开工前在当前代码中确认实际入口，不要只按研究文档猜。
5. 完成一个实施切片后，更新本文件的 `Implementation Status` 和 `Last Known Pointers`。

## Current Status

```text
research_extraction: complete
implementation_planning: ready
runtime_code_implementation: in_progress_phase_4_draft_ready
```

当前已有研究产物：

- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/handoffs/phase-1-runtime-surface-inventory/README.md`
- `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md`
- `runtime-research/handoffs/phase-3-provider-tool-registry-pilot/synthesis.md`
- `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/README.md`
- `runtime-research/completion-audit.md`
- 8 个项目包：`aider`、`serena`、`continue`、`opentelemetry`、`temporal`、`ast-grep`、`graphiti`、`openhands`

## Read For Task

| Task Intent | Read These First | Then Read |
|---|---|---|
| 做第一阶段并行调研 | `handoffs/phase-1-runtime-surface-inventory/README.md`, `handoffs/phase-1-runtime-surface-inventory/research-prompt.md` | `handoffs/phase-1-runtime-surface-inventory/parallel-lanes.md`, `handoffs/phase-1-runtime-surface-inventory/submission-template.md` |
| 做迁移替换/切流计划 | `migration-execution-plan.md` | `implementation-roadmap.md`, `agent-runtime-core-spec.md` |
| 做 AgentMap / 上下文压缩 | `aider/algorithms.md`, `aider/contracts.md` | `aider/clawx-mapping.md`, `aider/useful-tests.md` |
| 做符号级读写/引用/诊断 | `serena/symbol-api.md` | `serena/clawx-mapping.md`, `serena/useful-tests.md` |
| 做 provider registry | `continue/providers.md` | `continue/clawx-mapping.md`, `continue/useful-tests.md` |
| 做 tool invocation protocol | `continue/tool-provider.md` | `agent-runtime-core-spec.md`, `continue/useful-tests.md` |
| 做 slash/runtime commands | `continue/slash-command.md` | `continue/clawx-mapping.md` |
| 做 event log / checkpoint / resume | `temporal/workflow-semantics.md`, `openhands/runtime-events.md` | `temporal/clawx-mapping.md`, `openhands/clawx-mapping.md` |
| 做 verifier / evidence | `agent-runtime-core-spec.md` sections 5-7 | `temporal/useful-tests.md`, `openhands/useful-tests.md` |
| 做 trace context provider | `opentelemetry/trace-model.md`, `opentelemetry/query-and-source-mapping.md` | `opentelemetry/clawx-mapping.md`, `opentelemetry/useful-tests.md` |
| 做 runtime memory / temporal facts | `graphiti/temporal-knowledge-graph.md` | `graphiti/clawx-mapping.md`, `graphiti/useful-tests.md` |
| 做 AST patch planner | `ast-grep/rule-structure.md`, `ast-grep/patch-flow.md` | `ast-grep/clawx-mapping.md`, `ast-grep/useful-tests.md` |
| 做总体计划/排期 | `implementation-roadmap.md`, `migration-execution-plan.md` | `agent-runtime-core-spec.md` |

## Implementation Status

| Core Artifact | Status | Next Slice | Evidence Docs |
|---|---|---|---|
| AgentMap | planned | TypeScript/TSX symbol tags + PageRank ranking + token budget render | `aider/*` |
| Runtime Core Contracts | accepted_phase_2 | consume canonical contracts from adapters; no behavior cutover | `handoffs/phase-2-openclaw-runtime-core-foundation/synthesis.md`, `handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-a-runtime-core-contracts.md` |
| Runtime Context Provider | shadow_accepted_phase_3_registry_pilot | runtime diagnostic collector; no default provider ordering cutover | `handoffs/phase-3-provider-tool-registry-pilot/synthesis.md`, `handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-b-context-provider-registry-pilot.md`, `continue/providers.md` |
| Symbol Tool Layer | planned | overview/find/references/diagnostics MVP | `serena/*` |
| Tool Invocation Protocol | shadow_accepted_phase_3_registry_pilot | extend tool registry shadow coverage beyond MCP; later policy/cutover | `handoffs/phase-3-provider-tool-registry-pilot/synthesis.md`, `handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-c-tool-provider-registry-pilot.md`, `continue/tool-provider.md` |
| Provider/Tool Registry | accepted_phase_3_registry_pilot_shadow_only | runtime diagnostic collector and broader tool-provider shadow coverage before cutover | `handoffs/phase-3-provider-tool-registry-pilot/synthesis.md` |
| Workflow Checkpoint Engine | phase_4_draft_ready | append-only task event log + state reducer + resume shadow/idempotency | `handoffs/phase-4-event-log-checkpoint-resume/README.md`, `harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`, `temporal/*`, `openhands/runtime-events.md` |
| Evidence Verifier | shadow_accepted_phase_2 | standalone verifier fixtures; later blocking completion gate | `handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-e-evidence-verifier-shadow.md`, `agent-runtime-core-spec.md` |
| Trace Context Provider | planned | local span schema + task/tool trace query | `opentelemetry/*` |
| Runtime Memory Provider | planned | episodic task records + valid_at/invalid_at facts | `graphiti/*` |
| AST Patch Planner | planned | readonly TypeScript pattern/fix scan + preview diff | `ast-grep/*` |

Status vocabulary:

- `planned`: research and mapping exist, code work not started.
- `in_progress`: implementation slice is actively being built.
- `implemented`: slice landed with tests.
- `blocked`: needs external decision or dependency.
- `superseded`: replaced by a newer design; link to replacement.

## Source Boundaries

- `verseshell` and `codegraph-main` were intentionally excluded from this research set.
- Standalone LSP was not extracted as its own project; Serena's LSP wrapper is the symbol-layer evidence.
- OpenTelemetry source is docs/spec material, not SDK source.
- Temporal source is Python SDK, not Temporal service implementation.
- OpenHands local snapshot mainly exposes app-server conversation/event/callback layers; do not claim full Planner/Executor/Verifier runtime evidence from it.

## Last Known Pointers

When an implementation slice starts, add concrete ClawX paths here.

```text
AgentMap:
  code: pending_inventory
  tests: pending_inventory

Runtime Core Contracts:
  code: openclaw_runtime/src/runtime-core/types.ts; openclaw_runtime/src/runtime-core/evidence.ts; openclaw_runtime/src/runtime-core/events.ts; openclaw_runtime/src/runtime-core/index.ts
  tests: tests/unit/runtime-core-contracts.test.ts
  status: accepted_phase_2

Runtime Context Provider:
  code: openclaw_runtime/src/context-engine/types.ts; openclaw_runtime/src/context-engine/legacy.ts; openclaw_runtime/src/context-engine/shadow-flags.ts; openclaw_runtime/src/context-engine/provider-registry.ts; openclaw_runtime/src/agents/loop-context-pack.ts
  tests: tests/unit/context-shadow-adapter.test.ts; tests/unit/context-provider-registry.test.ts; tests/unit/loop-context-pack.test.ts
  status: shadow_accepted_phase_3_registry_pilot; provider ordering/default cutover remains future

Symbol Tool Layer:
  code: pending_inventory
  tests: pending_inventory

Tool Invocation Protocol:
  code: electron/services/tool-protocol-shadow.ts; electron/services/tool-provider-registry.ts; electron/services/mcp-api.ts
  tests: tests/unit/mcp-api.test.ts; tests/unit/tool-provider-registry.test.ts
  status: shadow_accepted_phase_3_registry_pilot for MCP callTool; broader policy/cutover remains future

Provider/Tool Registry:
  code: openclaw_runtime/src/runtime-core/registries.ts; openclaw_runtime/src/runtime-core/registry.ts; openclaw_runtime/src/runtime-core/index.ts; openclaw_runtime/src/config/types.openclaw.ts; openclaw_runtime/src/config/zod-schema.ts; openclaw_runtime/src/context-engine/provider-registry.ts; electron/services/tool-provider-registry.ts; electron/services/mcp-api.ts; openclaw_runtime/src/agents/task-loop-controller.ts
  tests: tests/unit/runtime-provider-tool-registry.test.ts; tests/unit/context-provider-registry.test.ts; tests/unit/tool-provider-registry.test.ts; tests/unit/runtime-core-contracts.test.ts; tests/unit/context-shadow-adapter.test.ts; tests/unit/mcp-api.test.ts; tests/unit/task-loop-controller.test.ts
  status: accepted_phase_3_registry_pilot_shadow_only; no default registry cutover
  next: runtime-owned registry diagnostic collector; broader tool-provider shadow coverage

Workflow Checkpoint Engine:
  code: openclaw_runtime/src/agents/task-loop-controller.ts; openclaw_runtime/src/agents/long-task-control/store.ts; openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  tests: tests/unit/task-loop-controller.test.ts; phase-4 tests pending
  status: phase_4_draft_ready for append-only event log + state reducer + resume shadow/idempotency
  handoff: runtime-research/handoffs/phase-4-event-log-checkpoint-resume/README.md; harness/specs/tasks/phase-4-event-log-checkpoint-resume.md

Evidence Verifier:
  code: openclaw_runtime/src/agents/task-loop-controller.ts
  tests: tests/unit/task-loop-controller.test.ts
  status: shadow_accepted_phase_2 for warning-only evidence verifier report; blocking verifier remains future

Trace Context Provider:
  code: pending_inventory
  tests: pending_inventory

Runtime Memory Provider:
  code: pending_inventory
  tests: pending_inventory

AST Patch Planner:
  code: pending_inventory
  tests: pending_inventory

Terminal Tool Exception:
  code: openclaw_runtime/src/agents/verseshell-runtime.ts; verseshell-runtime/src/server.rs
  tests: not part of Phase-2 runtime-core acceptance
  status: documented exception; user-configured stdio terminal tool, not a second runtime-core service
```

## Migration Tracking

When replacing an immature legacy path, track the work with this migration shape:

```text
Stage:
Legacy paths:
New paths:
Feature flag:
Shadow metrics:
Tests:
Rollback:
Status:
Next decision:
```

Use `migration-execution-plan.md` as the authoritative stage order for replacement work.

Current Phase-2 migration status:

```text
Stage: Stage 1 Contract Layer Without Behavior Change
Current legacy paths: MCP callTool; TaskLoop lifecycle/checkpoints; LoopContextPack and LegacyContextEngine context assembly; TaskLoop evidence gate projection
New paths: openclaw_runtime/src/runtime-core contracts; MCP ToolCallRequest/ToolCallResult shadows; TaskLoop RuntimeTaskEvent shadows; ContextItem shadows; warning-only evidence verifier report
Feature flag: runtime.toolProtocol.mcpShadow; runtime.contextProviders.shadow; runtime.contextProviders.loopPackShadow; runtimeTaskEventLogShadow; runtimeCoreShadow; runtime.evidenceVerifier.shadow
Shadow metrics: legacy response/prompt/status parity, runtime-core validator acceptance, evidence refs/metadata presence
Tests: tests/unit/runtime-core-contracts.test.ts; tests/unit/context-shadow-adapter.test.ts; tests/unit/mcp-api.test.ts; tests/unit/task-loop-controller.test.ts; tests/e2e/task-loop-panel.spec.ts
Rollback: disable shadow flags; legacy paths remain authoritative
Status: accepted_phase_2_ready_for_phase_3
Next decision: Phase 3 should add provider/tool registry pilot without default-on behavior changes.
```

Current Phase-3 migration status:

```text
Stage: Stage 4 Provider and Tool Registry Pilot (shadow-only)
Current legacy paths: LoopContextPack and LegacyContextEngine context assembly; MCP callTool legacy response/approval semantics; TaskLoop lifecycle/checkpoint shadows
New paths: openclaw_runtime/src/runtime-core/registries.ts; openclaw_runtime/src/context-engine/provider-registry.ts; electron/services/tool-provider-registry.ts; TaskLoop registry diagnostic shadow metadata/evidence
Feature flag: runtime.registryPilot.enabled; runtime.providerRegistry.shadow; runtime.contextProviders.registryPilot; runtime.toolRegistry.shadow; existing runtime.toolProtocol.mcpShadow; existing runtimeTaskEventLogShadow/runtimeCoreShadow
Shadow metrics: prompt/message parity, MCP response shape parity, registry diagnostic evidence refs, TaskLoop final status/checkpoint authority unchanged
Tests: tests/unit/runtime-provider-tool-registry.test.ts; tests/unit/context-provider-registry.test.ts; tests/unit/tool-provider-registry.test.ts; tests/unit/runtime-core-contracts.test.ts; tests/unit/context-shadow-adapter.test.ts; tests/unit/mcp-api.test.ts; tests/unit/task-loop-controller.test.ts
Rollback: disable registry and adapter shadow flags; legacy context/MCP/TaskLoop paths remain authoritative
Status: accepted_phase_3_ready_for_phase_4
Next decision: Phase 4 should add append-only event log, state reducer, checkpoint serializer, and resume shadow/idempotency without default-on resume cutover.
```

Current Phase-4 draft status:

```text
Stage: Stage 5 Event Log and Checkpoint shadow/dual-write preparation
Owner agent/thread: current synthesis-prep thread
Current legacy paths: TaskLoop in-memory run records; long_task_checkpoints store; task-ledger checkpoint projection; mission-loop/task-loop status tools
New paths: proposed under openclaw_runtime/src/runtime-core/** and openclaw_runtime/src/agents/long-task-control/**; TaskLoop event-log writer wiring remains future lane work
Feature flag: proposed runtime.eventLog.shadow; runtime.eventLog.persist; runtime.checkpointSerializer.shadow; runtime.resume.replayShadow; runtime.resume.preferEventLog must remain false/not implemented until future cutover
Shadow metrics: append-only idempotency, reducer replay parity, checkpoint serialization parity, resume side-effect suppression, missing tool result waiting/verifying diagnostics
Tests: draft in harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
Rollback: disable Phase-4 event-log/checkpoint/resume flags; legacy TaskLoop/checkpoint/resume behavior remains authoritative
Status: draft_ready
Next decision: launch lane-a-event-log-contracts-and-store first, then TaskLoop dual-write and reducer/resume lanes.
```

## Update Rules

- If you implement or materially change a core artifact, update its status and pointers in this file.
- If you discover a better source or contradiction, update the relevant project extraction and note the evidence path.
- If implementation touches user-visible UI, add/update Electron E2E coverage per project rules.
- If implementation touches communication paths, follow the comms checklist from `AGENTS.md`.
- If a reusable constraint emerges, promote it into `harness/specs/**` rather than leaving it only here.

## Quick Recovery Prompt

Use this when handing off to another agent:

```text
Read runtime-research/agent-runtime-index.md first.
Identify the target Core Artifact and current Status.
Read the matching clawx-mapping.md and useful-tests.md.
Inspect current ClawX code before implementing.
After changes, update agent-runtime-index.md with code paths, tests, and next slice.
```
