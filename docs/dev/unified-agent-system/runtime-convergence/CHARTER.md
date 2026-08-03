# Convergence Charter

> Proposed and non-authorizing until the Task Forest proposal in `STATUS.md` is applied. On activation, the locks below become mandatory.

## Product Outcome

Build a local-first OpenClaw Operator Desktop that can prove:

1. what each model call received and why;
2. what the user approved;
3. what external effect occurred;
4. what can and cannot be recovered after failure.

The project is not a generic Agent OS, coding-agent framework, workflow engine, memory platform, or observability vendor.

## In Scope

- Reduce duplicate Run, Workflow, Context, Memory, Tool, Effect, and Telemetry authorities.
- Prove TaskFlow through RC-06A before per-domain reuse; directly reuse OpenClaw plugin slots, MCP runtime, provider adapters, channels, Cron, subagents, and OTel exporter.
- Keep Electron-native workspace, keychain, terminal, file, Git, browser, notification, and approval UX.
- Implement bounded ContextReceipt, WireReceipt, and EffectReceipt contracts without creating a second event store.
- Deliver one cross-entry Operator workflow with automated engineering evidence, followed by final user acceptance.

## Out of Scope

- Default-on graduation, GA, release approval, or TF-0006 completion.
- A new agent loop, DAG runtime, distributed workflow service, memory database, context store, protocol, telemetry store, or provider router.
- LangGraph, Temporal, OpenHands, LangSmith, or Phoenix as a core dependency.
- Automatic SEKB writeback, synchronous mandatory Mem, autonomous browser/private-network access, or side-effect replay.
- Deleting legacy data before a tested compatibility and rollback window exists.

## Activation Locks

| Domain | Decision |
|---|---|
| Runtime | OpenClaw Gateway and runtime remain authoritative; ClawX is an embedding and product layer. |
| Workflow | TaskFlow/TaskRegistry are the convergence candidate, not yet a proven universal owner. RC-06A must prove durable revision/CAS and transition semantics before any domain cutover. |
| Context | DCS occupies the single `contextEngine` slot and owns provider-bound selection, budget, projection, and receipts. |
| Memory | Exactly one configured OpenClaw `memory` slot owner may persist memory. Other systems produce candidates or review proposals only. |
| Tools | MCP is the external capability protocol. Native Git, storage, terminal, and browser tools remain host-native providers. |
| Telemetry | OpenTelemetry/OTLP is the export standard. Product receipts and domain journals remain factual evidence. |
| Evidence | Receipts persist in a new typed, append-only `runtime_receipts` table in the existing openclaw-state SQLite via a narrow `ReceiptStore` interface (user-confirmed 2026-08-02; no new DB/sidecar/service). RuntimeTaskEventLog remains diagnostic (default-off, prunable, no receipt kinds). |
| Evidence scope | No diagnostic replay, reducer, resume, trajectory, or runtime-spine path may become lifecycle or effect authority. |
| UI | Task Ledger, Graph, Workbench, and Observability are rebuildable projections, not runtime truth. |
| Runtime Spine | Existing `diagnostic_only` code is frozen; it may be removed or adapted but never promoted as a second runtime. |
| Packaging | Source `openclaw_runtime` is the only implementation path for convergence capabilities. The npm fallback must report receipts as unavailable/degraded and cannot satisfy readiness. |

## Hard Stops

Stop the active package and set it to `review_needed` when any condition occurs:

- implementation requires a new persistent authority or service;
- an upstream OpenClaw capability already satisfies the contract and no adapter proof was attempted;
- a shadow path changes payload bytes, execution order, approvals, retry, or delivery;
- an old and new writer would remain authoritative after the package exit;
- required tests need wider ownership only to hide unrelated failures;
- product locks, privacy boundaries, or default behavior would change;
- human/live evidence is being fabricated, simulated, or counted before the final phase.

## Program Done

The program may be `done` only when every required work package is listed in `STATUS.md.accepted_work_packages`, the final evidence manifest and independent Verifier report are reproducible and mutually bound, `STATUS.md` first reaches `human_acceptance_pending`, and the user records an explicit `accepted` verdict artifact from `HUMAN-ACCEPTANCE.md`.
