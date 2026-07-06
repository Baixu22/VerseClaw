# Observability Event Taxonomy

This document defines the namespace structure, retention/decay policies, trace aggregation rules, LCP kind registry, and scorecard governance for the Round 2 observability stack (A1–A6).

**Status**: Stage 3 deliverable. All areas must conform before moving to active pilot.

**Implementation sources**:
- Namespace + retention + truncation: `shared/types/observability.ts`
- Trace recorder: `openclaw_runtime/src/observability/trace-recorder.ts`
- LCP kind registry: `openclaw_runtime/src/local-control-plane/index.ts`
- Scorecard: `openclaw_runtime/src/observability/scorecard.ts`

---

## 1. Namespace Structure

Each area owns a namespace `claw.{area}.*`. Spans and events outside an area's namespace are rejected at recording time.

### 1.1 Area prefixes

| Area | Prefix | Owner |
|------|--------|-------|
| Layered Execution Isolation | `claw.a1.*` | A1 |
| Multi-Agent Orchestration | `claw.a2.*` | A2 |
| Runtime Resilience | `claw.a3.*` | A3 |
| Decision Quality | `claw.a4.*` | A4 (diagnostic only) |
| Adaptive Context Budget | `claw.a5.*` | A5 |
| Long-Running Persistence | `claw.a6.*` | A6 |
| Mission Control + infrastructure | `claw.core.*` | Mission Control / core |

### 1.2 Naming rules

- Event names follow the format `claw.{area}.{category}.{event}` (e.g., `claw.a1.snapshot.start`, `claw.a6.checkpoint.written`).
- The `core.` namespace is reserved for Mission Control and shared infrastructure. Only `core` area callers may emit `claw.core.*` events.
- Cross-namespace emission is rejected. Caller area `a1` may only emit `claw.a1.*`; it may NOT emit `claw.a6.*`.
- Reserved prefixes `verse.*` and `openclaw.*` are rejected — they are not area namespaces.
- Validation entry point: `validateEventNamespace(eventName, callerArea)` in `shared/types/observability.ts`.

### 1.3 Example valid events per area

| Area | Example events |
|------|----------------|
| A1 | `claw.a1.snapshot.start`, `claw.a1.snapshot.commit`, `claw.a1.snapshot.rollback`, `claw.a1.lease.interrupted` |
| A2 | `claw.a2.wave.started`, `claw.a2.wave.completed`, `claw.a2.worker.spawned`, `claw.a2.worker.reconnected` |
| A3 | `claw.a3.anomaly.classified`, `claw.a3.rollback.executed`, `claw.a3.circuit.tripped` |
| A4 | `claw.a4.decision.extracted`, `claw.a4.tool.choice`, `claw.a4.report.generated` |
| A5 | `claw.a5.budget.plan`, `claw.a5.wave.deferred`, `claw.a5.context.compacted` |
| A6 | `claw.a6.checkpoint.written`, `claw.a6.resume.verified`, `claw.a6.fingerprint.computed` |
| core | `claw.core.mission.decision`, `claw.core.trace.started`, `claw.core.trace.truncated`, `claw.core.trace.completed` |

---

## 2. Retention and Decay Policy

### 2.1 Event categories

Each span/event is classified into one of 4 categories. The category determines retention and sampling behavior.

| Category | Retention | Sampling rate (high throughput) | Threshold (per minute) |
|----------|-----------|--------------------------------|------------------------|
| `decision` | 7 days | 1.0 (always) | ∞ (no sampling) |
| `diagnostic` | 3 days | 0.1 (10%) | 100 |
| `error` | 30 days | 1.0 (always) | ∞ |
| `shadow` | 7 days | 0.01 (1%) | 50 |

Source: `OBSERVABILITY_RETENTION_POLICIES` in `shared/types/observability.ts`.

### 2.2 Decay semantics

- `decision`: never sampled down — full fidelity required for audit.
- `diagnostic`: above 100/min, only 10% of spans are retained.
- `error`: never sampled down — full fidelity for post-mortem.
- `shadow`: above 50/min, only 1% retained — shadow paths are non-production.

### 2.3 Buffer overflow behavior

- Trace buffer overflow: drop by area priority (A4 dropped first, A6 dropped last). See §3.2.
- LCP ring buffer overflow: ring eviction (newest wins), see §4.3.
- Buffer overflow never blocks the production path.

---

## 3. Trace Aggregation Rules

### 3.1 Trace lifecycle

1. `trace.started` — trace created with initial metadata.
2. `span.started` / `span.completed` — spans added during execution.
3. `event.recorded` — discrete events recorded within a span.
4. `trace.completed` — trace finalized, scorecard computed (optional).

### 3.2 Span truncation

When a trace exceeds `TRACE_SPAN_TRUNCATION_THRESHOLD` (200 spans):

1. Spans are sorted by `spanDropPriority(area)` — lower priority value = kept longer.
2. Priority order (kept longest first): `core(0) > a6(1) > a1(2) > a2(3) > a5(4) > a3(5) > a4(6)`.
3. Low-priority spans (A4 first, then A3, then A5, ...) are dropped until the trace is under threshold.
4. A `claw.core.trace.truncated` event is emitted with attributes:
   - `droppedSpanCount`: number of spans dropped.
   - `threshold`: the truncation threshold (200).
   - `droppedAreas`: list of areas whose spans were dropped.

### 3.3 Per-trace span cap

- Maximum spans per trace before truncation: **200** (`TRACE_SPAN_TRUNCATION_THRESHOLD`).
- Truncation is non-blocking — dropped spans are logged but do not delay execution.

### 3.4 Trace buffer

- In-memory ring buffer: 100 traces (`MAX_TRACES` in `trace-buffer.ts`).
- Eviction policy: oldest completed trace evicted when full.
- Scorecards are stored alongside traces in the same buffer.

---

## 4. LCP Kind Registry

### 4.1 Current kinds

The Local Control Plane (LCP) report kind registry currently has 5 kinds:

| Kind | Retention | Post-promotion sampling | Owner area |
|------|-----------|------------------------|------------|
| `context` | 7 days | 1.0 | A5 |
| `model_router` | 7 days | 1.0 | A4 |
| `capability` | 7 days | 1.0 | A1 |
| `evidence` | 30 days | 1.0 | A6 |
| `mission` | 7 days | 1.0 | Mission Control |

Source: `LOCAL_CONTROL_PLANE_REPORT_KINDS` + `LCP_KIND_METADATA` in `local-control-plane/index.ts`.

### 4.2 Kind count cap

- Maximum kinds: **10** (`MAX_LCP_KINDS`).
- Registering an 11th kind is rejected by `validateLcpKindRegistration(currentCount)`.
- Error message requires "project-lead + architecture review" before increasing the cap.

### 4.3 Ring buffer

- Fixed size: 200 reports (`MAX_REPORTS`).
- Eviction: oldest report evicted when ring is full.
- All payloads pass through `sanitizeJsonValue` (sensitive key redaction + depth/length truncation).

### 4.4 Decay policy enforcement

Every kind MUST declare a `LcpKindDecayPolicy`:
- `retentionMs`: how long reports of this kind are retained.
- `postPromotionSamplingRate`: sampling rate after the kind moves from shadow to active.

A kind without a decay policy is rejected at registration time. This is enforced by `LCP_KIND_METADATA` satisfying `Record<LocalControlPlaneReportKind, LcpKindDecayPolicy>` — the `satisfies` constraint ensures every kind has a policy.

### 4.5 Mode

All LCP reports are `mode: "observe"` — strictly observe-only. No LCP report can trigger an execution path change.

---

## 5. Scorecard Governance

### 5.1 Scorecard dimensions

Each completed trace produces an `ObservabilityScorecard` with 5 weighted dimensions:

| Dimension | Weight | Logic |
|-----------|--------|-------|
| Reliability | 0.30 | `errorCount === 0 ? 100 : 100 - 25*errorCount` |
| Verification | 0.25 | Adversarial mode requires `verifierCount > 0`; baseline 85 |
| Context Discipline | 0.20 | Role-first mode requires `contextPackCount > 0`; baseline 85 |
| Cost Control | 0.15 | `$0.25 / $1 / $5` three-tier threshold |
| Latency | 0.10 | `10s / 60s / 180s` three-tier threshold |

Source: `buildTraceScorecard` in `observability/scorecard.ts`.

### 5.2 Grade scale

| Grade | Score range | Meaning |
|-------|-------------|---------|
| A | ≥ 90 | Excellent |
| B | ≥ 80 | Good |
| C | ≥ 70 | Acceptable |
| D | ≥ 60 | Below baseline |
| F | < 60 | Failing |

### 5.3 Governance rules

- Scorecards are computed at trace completion, not mid-trace.
- Scorecards are stored in the trace buffer alongside the trace.
- A failing grade (F) does not block the production path — it is diagnostic only.
- Aggregated metrics (via `buildDashboardSnapshot`) surface alerts:
  - "adversarial mode but no verifier"
  - "role-first mode but no context-pack"

---

## 6. Implementation Status

| Component | Status | File |
|-----------|--------|------|
| Namespace validation | ✅ Implemented | `shared/types/observability.ts` |
| Retention policies | ✅ Implemented | `shared/types/observability.ts` |
| Span drop priority | ✅ Implemented | `shared/types/observability.ts` |
| Trace recorder | ✅ Implemented | `observability/trace-recorder.ts` |
| Trace buffer | ✅ Implemented | `observability/trace-buffer.ts` |
| Scorecard | ✅ Implemented | `observability/scorecard.ts` |
| LCP kind registry | ✅ Implemented | `local-control-plane/index.ts` |
| Trace truncation in recorder | ⚠️ Stage 3 — constants exist, recorder integration pending | `observability/trace-recorder.ts` |
| Namespace enforcement in recorder | ⚠️ Stage 3 — validation exists, recorder integration pending | `observability/trace-recorder.ts` |
