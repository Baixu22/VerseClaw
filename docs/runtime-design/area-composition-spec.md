# Area Composition Specification

This document defines cross-area composition semantics for Round 2 designs (A1–A6). It resolves 4 blocking contradictions and specifies decision precedence, shared state ownership, the high-risk pair test matrix, and resource contention rules.

**Status**: Stage 0 deliverable. Must be approved before any area moves to active pilot.

---

## 1. Blocker Resolutions

### Blocker 1: MissionDecision enum vs `executeReplayRollback` signature

**Problem**: The A3 design's `executeReplayRollback` signature references `MissionDecision & { action: 'rollback' }`, but `MissionDecision` is `"continue" | "repair" | "sleep" | "ask_user" | "complete" | "blocked"` — there is no `rollback` value. Adding one would be a schema change, violating the `no_schema_change` pilot boundary.

**Resolution**: **Option (a) — sub-field on `repair`.**

```typescript
// In mission-control/types.ts (additive, no enum change):
export type MissionRepairStrategy = 'replay_rollback' | 'default';

export interface MissionReviewerResult {
  // ...existing fields...
  decision: MissionDecision;
  // NEW: when decision === 'repair', specifies the repair strategy.
  // When decision !== 'repair', this field is ignored.
  repairStrategy?: MissionRepairStrategy;
}
```

**Rationale**: `replay_rollback` is semantically a repair action (recovering from a bad state). Expressing it as a sub-field of `repair` preserves the existing enum, requires no schema migration, and keeps the pilot boundary intact. Mission Control's reviewer decides `repair` + `repairStrategy: 'replay_rollback'`; A3's `executeReplayRollback` is called only when both fields are present.

**Rejection log**:
- (b) "Add `rollback` to enum": rejected — schema change blocked by `no_schema_change`.
- (c) "Independent operator trigger": rejected — bypasses Mission Control's decision authority, violating the single-decision-host principle.

### Blocker 2: EvidenceRef schema ownership

**Problem**: Round 2 assigned EvidenceRef schema ownership to A4, but A4 is permanently diagnostic and may be deprecated (90-day <3-invocation rule). Production code (A2/A3/A6) cannot depend on a schema owned by a potentially-removable module.

**Resolution**: **Canonical type in `shared/types/evidence.ts` (no area owner).**

The canonical `EvidenceRef` type is the union of all 7 existing area-specific EvidenceRef types (`TaskLedgerEvidenceRef`, `MissionEvidenceRef`, `MemoryEvidenceRef`, `LongTaskEvidenceRef`, `ClawGraphEvidenceRef`, `LocalControlPlaneEvidenceRef`, `CompressionEvidenceRef`). It lives in the type-contract layer and is owned by no single area. A4 is a consumer, not the owner. Existing area-specific types are grandfathered (not migrated); new code uses the canonical type.

**File**: `shared/types/evidence.ts` (created in Stage 0).

### Blocker 3: A3 graduation depends on A4, but A4 may be deprecated first

**Problem**: A3's deprecation criteria states "Mission reviewer 采信 anomalyPattern 后的决策质量（通过 A4 离线分析）不低于基线". A4's deprecation criteria states "90 天内被调用少于 3 次则启动废弃评估". If no one runs A4, A4 gets deprecated, and A3 can never graduate.

**Resolution**: **A3 graduation uses Mission decision outcome tracking, not A4.**

A3's graduation metric changes from "A4 offline analysis shows decision quality not below baseline" to:
- "In 100 consecutive Mission decisions where `anomalyPattern` was non-null, the decision was not downgraded (to `blocked` or `sleep`) within the subsequent 5 ticks at a rate higher than the baseline (Mission decisions without anomalyPattern)."

This uses existing `mission_runs` records (Mission Control's own outcome tracking), not A4. If A4 is deprecated, A3 graduation is unaffected. A4 may still be used as an optional diagnostic tool during A3 review, but it is not a graduation dependency.

### Blocker 4: A1+A6 I/O during mid-turn pause

**Problem**: A6's `SessionContinuityCoordinator.pauseSession` can trigger mid-turn (user pause, app shutdown, runtime error). At that moment, A1's `TurnIsolationCoordinator` may hold an active lease and be performing snapshot I/O on workspace files. A6 also needs to write file fingerprints to the checkpoint. Concurrent I/O on the same paths is undefined.

**Resolution**: **Pause protocol — A1 lease commits before A6 writes checkpoint.**

When `pauseSession` is triggered mid-turn:
1. A6 sends a `pause-requested` signal to A1's `TurnIsolationCoordinator`.
2. A1 commits its current lease (flushes in-progress snapshot to completion or discards it if incomplete — see below).
3. A1 marks the lease as `interrupted_by_pause` in the trace.
4. A6 takes the `state_leases` lease and writes the checkpoint + fingerprints.
5. A6 releases the lease.

**Lease commit behavior on interrupt**: A1 commits the snapshot if it is >50% complete (heuristic: more than half of declared write paths have been snapshotted). If <50%, A1 discards the partial snapshot and records `snapshot_discarded_by_pause` in the trace. This avoids the worst case (partial snapshot that looks complete).

**A1+A6 test matrix addition**: The A1+A6 test pair must include a third case: "mid-turn pause triggers during A1 snapshot — A1 commits/discards, A6 writes checkpoint, no I/O race."

---

## 2. Decision Precedence Ordering

When multiple areas produce decisions for the same turn, the following precedence applies. Higher precedence wins.

```
A6 (persistence/resume authority) > A1 (isolation tier) > A5 (context budget) > A3 (resilience) > A2 (scheduling) > A4 (diagnostics, never overrides)
```

**Rationale for A5 > A3 (vs the original brief proposal A5 at position 5)**:
- A5 (context budget) must take effect before A2 (parallel worker scheduling) because wave scheduler worker allocation depends on A5's per-turn budget estimate. If A5 is after A2, worker count and token allocation are already fixed for the turn before the budget is applied — a no-op.
- A3 is after A2 because the simplified A3 only injects `anomalyPattern` into Mission reviewer input and produces no independent scheduling decision.
- A4 is permanently lowest — it is diagnostic-only with no write authority over any execution path.

**Precedence rules**:
- "Higher precedence" means: if A6 says "pause for checkpoint" and A1 says "continue turn", A6 wins — the turn pauses.
- Precedence is per-turn, not per-tick. Mission Control ticks are not affected by this ordering (Mission is the decision host, not a peer area).
- A4 never overrides any area. It reads traces and produces reports; it has no execution authority.

---

## 3. Shared State Ownership

Each shared concept has exactly one owner. Other areas are read-only consumers.

| Shared concept | Owner | Readers | Write rule |
|----------------|-------|---------|------------|
| **File fingerprints** | **A6** (`SessionContinuityCoordinator`) | A1 (`PolicyLightSnapshotter` reads for diff baseline) | A6 writes to `long_task_checkpoints.metadata_json.file_fingerprints`. A1 reads only. A1 never writes fingerprints. |
| **EvidenceRef schema** | **`shared/types/evidence.ts`** (type contract layer, no area owner) | A2, A3, A4, A6 | Type contract only. No runtime writes. New evidence ref types must be added to the canonical type. |
| **Control signals taxonomy** | **Mission Control** (existing) | A3 (`classifyAnomalyPattern` outputs `AnomalyPattern`, not `LongConversationControlSignal`) | A3 does not own or extend `LongConversationControlSignal`. Mission Control translates `AnomalyPattern` into its own signals. |
| **LCP kind registry** | **LCP module** (existing, `local-control-plane/index.ts`) | All areas | New kinds require `LCP_KIND_METADATA` entry + `validateLcpKindRegistration` check. Cap: 10 kinds. |
| **Trace span schema** | **`shared/types/observability.ts`** (type contract layer) | All areas | Each area creates spans only in its namespace (`claw.{area}.*`). Cross-namespace spans are rejected. |
| **CompressionArtifact schema** | **`compression-planner.ts`** (existing) | A5 (read-only) | A5 does not modify or subclass `CompressionArtifact v1`. |
| **SessionActorQueue ordering** | **ACP** (existing) | A2 (parallel workers must request independent child sessions) | A2 does not bypass or modify `SessionActorQueue`. |
| **`MissionDecision` enum** | **`mission-control/types.ts`** (existing) | A3 (injects `anomalyPattern` only) | A3 does not add to the enum. Rollback is expressed as `repair` + `repairStrategy: 'replay_rollback'`. |

---

## 4. High-Risk Pair Test Matrix

Each pair must be tested before both areas can be simultaneously active. The test must cover the expected interaction and the failure mode.

### Pair 1: A1 + A2 — Isolation under parallel workers

- **Trigger**: Parallel workers execute during isolation policy narrowing.
- **Expected**: Each worker has an independent isolation scope. A1 policy narrowing applies per child session, not across workers.
- **Failure mode**: Worker B's write operation bypasses Worker A's isolation boundary.
- **Test approach**: E2E — 2 workers write different files; assert both succeed and no cross-worker isolation leak.

### Pair 2: A3 + A6 — Rollback then resume

- **Trigger**: Mission Control decides rollback while A6 has a pending resume checkpoint.
- **Expected**: A6's `ResumeContractVerifier` runs before rollback. Rollback clears volatile state. Resume contract is marked `requires_reverification`.
- **Failure mode**: Rollback executes but resume contract still shows `guaranteed` status.
- **Test approach**: E2E — trigger Mission rollback, assert `ResumeContractVerifier` marks `requires_reverification`.

### Pair 3: A5 + A2 — Budget reduces workers for next wave

- **Trigger**: A5 budget estimate suggests reducing worker count from 3 to 1.
- **Expected**: A5 output is injected before wave scheduler starts. Current wave is immutable — A5 changes apply to next wave only (`appliesToWave` field).
- **Failure mode**: Wave already started, A5 modifies budget, workers are killed mid-flight.
- **Test approach**: E2E — A5 plan reduces `maxParallelWorkers`; assert current wave unchanged, next wave uses new count.

### Pair 4: A1 + A6 — Fingerprint sharing and mid-turn pause

- **Trigger**: A1 snapshotter and A6 checkpoint writer operate on the same file paths.
- **Expected**: A6 fingerprints are the source of truth. A1 reads them. When A6 is inactive (flag off), A1 falls back to Git-diff.
- **Sub-case (mid-turn pause)**: `pauseSession` triggers during A1 snapshot. A1 commits lease (if >50% complete) or discards (if <50%). A6 writes checkpoint. No I/O race.
- **Failure mode**: Both components write the same path's metadata concurrently, or A1 partial snapshot looks complete after pause.
- **Test approach**: E2E — concurrent fingerprint read/write; mid-turn pause during A1 lease.

### Pair 5: A5 + A6 — Resume re-runs budget planner

- **Trigger**: Long task resumes after pause; A5 needs to rebuild budget estimate.
- **Expected**: After resume, A5 re-runs `ContextBudgetPlanner`. Stale budget from checkpoint is not reused.
- **Failure mode**: Resume reuses expired token budget, causing context overflow.
- **Test approach**: E2E — pause mid-task, resume, assert `ContextBudgetPlanner` re-executes.

### Pair 6: A2 + A6 — Multi-worker mid-checkpoint resume

- **Trigger**: Multi-worker task pauses mid-checkpoint, then resumes.
- **Expected**: Resume creates new independent child sessions. Does not attempt to reconnect original worker topology. `HandoffMergeContract` marks completed handoffs as `reconstructable`.
- **Failure mode**: Resume tries to reconnect expired worker sessions, causing `SessionActorQueue` conflicts.
- **Test approach**: E2E — pause during multi-worker run, resume, assert new child sessions created.

---

## 5. Resource Contention Rules

### 5.1 Trace buffer

- Each area's span writes are non-blocking (fire-and-forget to async queue).
- Buffer full: drop by area priority — A4 spans dropped first, A6 spans dropped last.
- Trace buffer fullness never blocks the production path.
- Truncation threshold: 200 spans per trace. Above this, low-priority spans (by `spanDropPriority`) are dropped and a `claw.core.trace.truncated` event is recorded.

### 5.2 LCP ring buffer

- Fixed size (current: `MAX_REPORTS = 200`).
- New kind registration requires `estimated_events_per_minute` estimate.
- If a new kind would cause ring overflow at p99, registration is rejected — must increase ring size or deprecate an old kind first.
- Kind count cap: 10 (enforced by `MAX_LCP_KINDS`).

### 5.3 SQLite write throughput

- A6 is the sole writer to `long_task_checkpoints`.
- A1/A3/A5 write state through A6's interface, never directly opening SQLite connections.
- Batch flush: every 500ms or 20 accumulated records, whichever comes first.

### 5.4 Filesystem I/O

- A1 snapshot and A6 checkpoint do not execute blocking I/O on the same paths in the same turn phase.
- Coordination: A6 completes fingerprint updates in `pre-turn` phase. A1 reads fingerprints in `post-turn` phase. Sequencing is enforced by `TurnIsolationCoordinator`.
- Mid-turn pause exception: see Blocker 4 resolution — A1 commits/discards lease before A6 writes.

### 5.5 Per-turn cumulative latency budget

- Cumulative p99 per turn: ≤ 300ms (A5 pre-turn 30ms + A1 post-turn 200ms + overhead).
- If exceeded: degrade by area priority — A4 (if it had any per-turn cost, it doesn't) → A3 → A5 → A1. A2 and A6 are not per-turn and are not degraded by this rule.

### 5.6 Shadow total memory budget

- All shadow paths combined: ≤ 24MB.
- Per-path ceiling: 4MB (`SHADOW_SAFETY_CONFIG.maxBufferBytes`).
- 5 active shadow areas (A1, A2, A5, A6 + any future) × 4MB = 20MB, within 24MB budget.
- Overflow: `drop_oldest` strategy, never blocks production.
