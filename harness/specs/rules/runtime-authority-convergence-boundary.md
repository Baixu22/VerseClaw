---
id: runtime-authority-convergence-boundary
title: Runtime Authority Convergence Boundary
type: ai-coding-rule
appliesTo:
  - runtime-authority-convergence-program
requiredProfiles:
  - fast
---

Runtime convergence must reduce authorities, not add an abstraction beside them.

- OpenClaw Gateway/runtime remains the runtime owner.
- TaskFlow/TaskRegistry is the workflow convergence candidate. It becomes the only lifecycle owner only after durable revision/CAS and transition semantics pass and each legacy domain completes cutover.
- DCS may own provider-bound context only through the single `contextEngine` slot.
- Exactly one configured `memory` slot plugin may own persistent memory.
- MCP owns the external capability protocol; host-native tools must not be labelled MCP without a real MCP server/runtime path.
- OpenTelemetry/OTLP owns telemetry export. Receipts and domain journals are factual evidence, not a second telemetry platform.
- New runtime services, workflow engines, event stores, checkpoint stores, memory stores, context stores, receipt stores, protocols, telemetry stores, or LLM routers are forbidden unless an active package records an explicit owner replacement after proving existing owners insufficient.
- RC-01 must select a receipt persistence owner only after schema, atomic sequencing, retention, lookup, idempotency, failure propagation, privacy, and restart proof. RuntimeTaskEventLog is a candidate, not a preselected owner: it is default-off, prunable, and lacks receipt/effect event kinds.
- RuntimeTaskEventLog replay, reducer, resume cutover, and runtime-spine paths remain diagnostic-only.
- Existing domain journals remain effect/idempotency truth. EffectReceipt may correlate them but must never authorize side-effect replay.
- Approval pending/resolved truth and unknown-effect reconciliation must be durable before any cross-restart Operator claim.
- Source `openclaw_runtime` is the sole implementation path for convergence capabilities. The npm fallback must report explicit capability degradation and cannot satisfy receipt coverage or readiness.
- WireReceipt must seal the actual guarded request body after provider-specific finalizers; `onPayload` alone is not a sufficient universal anchor.
- Shadow work must prove byte/order/approval/retry/delivery parity before cutover.
- A migration must end with one writer. Indefinite dual-write is forbidden.
- Task Ledger, graph, Workbench, and Observability UI must remain rebuildable projections.
- Existing `runtime-spine` code remains `diagnostic_only` and cannot be promoted.
- Product locks remain false. Automated evidence cannot increment human/live counts.
- Only one Runtime Convergence work package may be active.
- RC-00 acceptance must reject invalid or missing base refs, missing/blank/non-string actors, Executor/Verifier identity overlap, and missing or incorrect semantic report digests; source inspection without a green isolated Verifier run is not acceptance evidence.
