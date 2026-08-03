# Target Architecture

## Ownership Matrix

| Fact or behavior | Target owner | Non-owners |
|---|---|---|
| Gateway, providers, channels, Cron, subagents | OpenClaw runtime | Electron renderer, ClawX duplicate services |
| Flow lifecycle, waiting, resume, cancel, revision | TaskFlow and TaskRegistry only after RC-06A capability proof and per-domain cutover | Mission tables, Task Loop controller, ClawGraph `Map`, Task Ledger |
| Checkpoint material | Existing `long_task_checkpoints` until a separate cutover is proven | Runtime event replay, UI state |
| Session transcript and identity | Existing OpenClaw session authority | Task Ledger, Observability index |
| Provider-bound logical context | DCS in the `contextEngine` slot | Memory providers, adapters, payload hooks |
| Persistent memory | One active `memory` slot plugin | VToken, DCS, SEKB proposal queue, Working Context |
| External effects | Existing domain executor plus RC-04 EffectReceipt correlation record | Context lineage, UI projection, OTel span |
| External tool protocol | MCP | Work Provider catalog, host-native tools |
| Telemetry export | OpenTelemetry/OTLP | Receipt store, Observability JSONL |
| User views | Electron projections | Runtime authority |
| Convergence capability reporting | Source `openclaw_runtime` capability probe | npm fallback assumptions, renderer inference |
| Receipt persistence | Typed, append-only `runtime_receipts` table in the existing openclaw-state SQLite, exposed through a narrow `ReceiptStore` interface (user-confirmed 2026-08-02; no new DB/sidecar/service) | `long_task_checkpoints` (mutable checkpoint truth), RuntimeTaskEventLog (default-off/prunable), Unreviewed JSONL, OTel |
| Pending approvals | Durable approval owner selected and implemented in RC-04 | Gateway process `Map`, renderer state |

## Runtime Flow

```text
Desktop / Channel / Cron / Remote
  -> OpenClaw ingress and session identity
  -> current domain workflow owner
     (TaskFlow only after RC-06A proof and that domain's cutover)
  -> DCS attempt CompilePlan
  -> per-model-call ContextBundle + ContextReceipt
  -> registered transport projection + WireReceipt
  -> model/tool proposal
  -> approval policy
  -> domain effect executor + EffectReceipt
  -> delivery adapter
```

All stages correlate through existing run/session/request/trace identities. OTel exports the trace; it does not replace receipts or effect journals.

## Receipt Rules

- `ContextReceipt`: logical bundle digest, source/version refs, selected/omitted decisions, budget, policy digest, and call identity.
- `WireReceipt`: final request-body digest after provider-specific finalizers, provider/adapter identity, registered transform IDs, `runtimeMode`, and transport-attempt identity. `onPayload` is only a candidate hook, not the final seal when later finalizers exist.
- `EffectReceipt`: proposal, approval decision, idempotency key, domain executor, outcome, artifact/journal refs, and recoverability.
- Domain journals remain the execution/idempotency truth. EffectReceipt correlates and explains them; it never authorizes replay.
- Raw prompt, tool output, credentials, cookies, and environment values are not persisted by default.
- **Receipt owner decision (user-confirmed 2026-08-02):** receipts persist in a new typed, append-only `runtime_receipts` table inside the existing openclaw-state SQLite, exposed through a narrow `ReceiptStore` interface. This reuses the shared state DB capabilities (schema, permissions, WAL, `PRAGMA busy_timeout`, restart persistence, synchronous immediate transaction via `runOpenClawStateWriteTransaction`) and introduces no new database, sidecar, service, or second runtime authority. `long_task_checkpoints` is rejected (mutable checkpoint/resume truth that updates `checkpoint_json` under the same idempotency key and cannot cover ordinary model calls); RuntimeTaskEventLog stays diagnostic; TaskFlow `flow_runs` (in-process CAS, workflow-scoped) and `mission_events` (mission-scoped) are rejected. The table follows seven hard constraints: (1) digest/refs/call-index/version/policy-digest only, never raw prompt, tool output, or credentials; (2) append-only, same `idempotency_key` with identical content is idempotent success while different content must conflict-fail; (3) no `max(sequence)+1`, use explicit attempt/model-call/wire-attempt identity; (4) no silent pruning, deletion needs an explicit lifecycle policy; (5) a shadow write failure must not change send behavior but must fail RC-02 acceptance; (6) a receipt explains and correlates facts only and never authorizes replay; (7) the npm fallback continues to report degraded and never counts toward receipt coverage.
- RuntimeTaskEventLog cannot be selected merely because a table exists: persistence is default-off, records are pruned, and the current event union has no receipt/effect kind. Its replay/reducer/resume and runtime-spine paths remain diagnostic-only.

## Context Boundaries

- One stable CompilePlan per attempt. A policy-only change within the same provider attempt increments `planRevision`; a provider capability change or fallback creates a new attempt.
- One immutable ContextBundle per model call; tool results create the next bundle without synchronously rerunning Mem.
- Provider fallback sets `attemptIndex += 1` and resets `planRevision`, `modelCallIndex`, and `wireAttemptIndex` to `0`. Same-provider transport retry keeps the attempt/model-call identity, increments only `wireAttemptIndex`, and is allowed only when the same request body is provably idempotent.
- Semantic transforms occur before bundle sealing. After sealing, only registered non-semantic transport transforms are allowed.
- COMPASS SSP and every other semantic prompt addition are registered pre-seal producers; none may remain a direct provider-bound bypass after cutover.
- Working Context is a task-scoped projection over existing Session/BlockStore facts, not a store.
- Mem is asynchronous and opt-in. Missing Mem output drops that candidate and never blocks a model call.

## Migration Pattern

Every authority migration uses exactly four steps:

1. observe the legacy path without behavior change;
2. build a read-only projection from the target owner;
3. cut one writer over with idempotency and rollback proof;
4. remove or freeze the legacy writer after a compatibility window.

Indefinite dual-write is not a migration strategy.

At the 2026-08-02 baseline, source `openclaw_runtime@2026.6.2` is the sole path allowed to implement these contracts; root npm `openclaw@2026.5.20` is legacy fallback. Every source receipt records `runtimeMode=source` and the observed runtime version. The npm fallback must expose `runtimeMode=npm` plus explicit capability degradation and must not emit complete-receipt or readiness claims.
