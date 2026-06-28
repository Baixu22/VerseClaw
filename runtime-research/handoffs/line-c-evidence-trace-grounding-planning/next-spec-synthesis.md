# Line C Grounding Spine Next-Spec Synthesis

## Inputs Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/next-spec-draft.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/next-spec-boundary-audit.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/submissions/next-spec-validation-matrix.md`
- `runtime-research/handoffs/line-c-evidence-trace-grounding-planning/deep-validation.md`

All required A/B/C submissions were present and ended accepted before this synthesis began.

## A/B/C Submission Decision Table

| Submission | Decision | Integrated into final spec | Notes |
| --- | --- | --- | --- |
| A: `next-spec-draft.md` | accepted | yes | Used as the base formal task spec, including `GroundingRef`, `GroundingQuery`, readonly/shadow flags, required rules, acceptance criteria, rollback, and future-phase entry constraints. |
| B: `next-spec-boundary-audit.md` | accepted | yes | Strengthened hard rejections for runtime authority, TaskLoop/Gateway/provider-ordering cutover, renderer transport bypass, persistence/database/sidecar, services/exporters/listeners, raw retention, memory fact promotion, and patch apply behavior. |
| C: `next-spec-validation-matrix.md` | accepted | yes | Adopted harness commands, prerequisite spec validation, focused unit-test set, typecheck, boundary scans, raw-retention scans, persistence scans, mutation scans, and conditional comms replay/compare trigger. |
| `deep-validation.md` | accepted | yes | Confirmed the planning set is ready for fresh harness task-spec creation and that implementation must wait for spec acceptance. |

## Final Spec Summary

Created:

```text
harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
```

The spec defines a readonly/shadow, derived-only Grounding Spine. The accepted first implementation slice may add contracts/helpers for `GroundingRef`, `GroundingRefTrust`, `GroundingQuery`, and bounded result summaries over existing Evidence Verifier, Trace Context, event-log, checkpoint, Runtime Memory, AgentMap, and Symbol surfaces.

The spec fixes every grounding record as `authority: "none"`. Trust, ranking, projection, sanitization, and source anchors are explanatory metadata only; they cannot influence completion, blocked/failed status, retry, approval, security, provider ordering, memory promotion, TaskLoop/Gateway behavior, or runtime policy.

This integrator step touched only the harness task spec and this synthesis. It did not implement runtime code.

## Required Tests Summary

The final spec requires these validation groups:

- Harness context and validate for `line-c-evidence-trace-grounding-spine.md`.
- Prerequisite validate commands for `phase-5-evidence-verifier.md`, `phase-6-trace-context-provider.md`, `phase-7-runtime-memory-provider.md`, and `phase-line-b-agentmap-symbol-readonly.md`.
- Focused grounding unit tests for contracts, projections, bounded query behavior, and raw-retention boundary.
- Existing focused regression tests for Evidence Verifier, Trace Context, event-log/checkpoint, TaskLoop, Runtime Memory, AgentMap, Symbol Tool, and context-provider registry behavior.
- Typecheck with `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`.
- Renderer/Main transport scans for direct IPC/Gateway calls.
- Service/exporter/listener/database scans over touched grounding files.
- Raw-retention, persistence/sidecar, mutation, authority, and `GroundingRef|GroundingQuery` scope scans.
- `comms:replay` and `comms:compare` only if a later accepted implementation touches Main/Gateway/host-api/api-client/provider transport, gateway events, runtime send/receive, delivery, or fallback paths.

Local note: `rtk` was not available in this PowerShell session, so the required spec-creation proof used the equivalent `node` commands. The spec preserves the `rtk`-prefixed required commands for agents/runners where RTK is available.

## Rejected-Boundary Audit

Rejected for this spec and any first implementation slice:

- No runtime implementation before the harness spec and synthesis are accepted.
- No completion gate, verifier enforcement gate, active pilot gate, terminal status cutover, retry/approval/security policy, provider-ordering change, or runtime authority from grounding records.
- No TaskLoop, Gateway, runtime execution, model-message, prompt assembly, context-provider default registration, renderer transport, provider transport, or fallback-policy cutover.
- No renderer direct `window.electron.ipcRenderer.invoke`, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned protocol switching.
- No service, daemon, listener, HTTP server, WebSocket server, Temporal worker, OpenTelemetry collector, OTLP exporter, telemetry upload, second Gateway/runtime process, or external service.
- No grounding persistence, database, SQLite schema, sidecar, JSON/JSONL/TXT runtime state file, cache, store, exporter, package dependency, or migration surface.
- No raw prompts, raw chat logs, raw traces, full event payloads, full checkpoints, full tool args/output, stdout/stderr, complete env, credentials, secrets, API keys, auth headers, traceparent/tracestate/baggage values, raw source, or unbounded command output in grounding output.
- No mutation of existing EvidenceRef, TaskLoopEvidenceRef, RuntimeTraceSpan, RuntimeTaskEvent, checkpoint, memory, AgentMap, or Symbol producer contracts in the initial grounding spine.
- No durable memory fact promotion from grounding records alone.
- No source refs, symbol refs, renderer refs, external trace context, subagent prose, model summaries, patch refs, or memory refs becoming authoritative runtime truth.
- No AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior.
- No UI/user-visible behavior in this task. Any later UI requires a fresh accepted spec, i18n, styling compliance, and Electron E2E coverage.

## Implementation Lane Decision

Implementation lanes are allowed only after this formal spec validates and this synthesis remains accepted. The allowed first code slice is narrow: derived grounding contracts/helpers, projection helpers, fixtures, and focused tests.

Implementation lanes are not allowed to cut over runtime behavior, wire default providers, persist grounding state, expose raw data, alter renderer/Main transport, promote memory facts, or add patch-apply behavior. Any AST Patch Planner, UI, provider-ordering, TaskLoop/Gateway, persistence, or consumer cutover requires a separate accepted harness task spec.

## Validation Results

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |

Status: accepted
