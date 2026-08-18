# 6. Long-Running Task Persistence

## Exploration Log

> FAILURE NOTE: The mandatory CodeGraph steps could not be executed because no CodeGraph MCP tools are exposed in this session. MCP resource and template discovery returned no usable CodeGraph surface, and `rtk` was not available on PATH. I continued with targeted source reads and record this as a tooling failure, not a design blocker.

- CodeGraph plans executed: `codegraph_decide` and `codegraph_context_plan` were required by the prompt but unavailable. Manual fallback followed the plan's named files and related resume/persistence modules.
- Files read:
  - `shared/types/task-ledger.ts`: workspace-scoped Task Ledger types for nodes, edges, session links, append-only events, idempotency keys, warnings, and materialized snapshots.
  - `openclaw_runtime/src/agents/long-task-control/store.ts`: `RuntimeResumeCheckpoint`, checkpoint triggers, long-task checkpoint/intervention/user-queue records, SQLite writes, idempotent upsert behavior, and best-effort Task Ledger projection.
  - `openclaw_runtime/src/agents/mission-control/controller.ts`: Mission lifecycle phases, pause/resume/cancel helpers, Task Loop execution, reviewer decisions, checkpoint creation, LCP mission reporting, and trace storage.
  - `openclaw_runtime/src/agents/mission-control/store.ts`: `saveMissionRun`, `recordMissionEvent`, and `getLatestMissionForSession` persistence over `mission_runs` and `mission_events`.
  - `openclaw_runtime/src/agents/mission-control/types.ts`: Mission statuses (`idle`, `running`, `sleeping`, `paused`, `ask_user`, `complete`, `blocked`, `cancelled`, `error`), phases, decisions, evidence refs, and tick records.
  - `openclaw_runtime/src/agents/loop-context-pack.ts`: bounded recovery context builder with protected P0 sections, resume checkpoint section, task ledger state, memory, transcript summary, token budgets, truncation, omitted items, and optional `ContextItem` shadow projection.
  - `openclaw_runtime/src/state/openclaw-state-schema.sql`: `state_leases`, `long_task_checkpoints`, `long_task_intervention_events`, `long_task_user_queue`, `runtime_task_event_log_records`, `mission_runs`, and `mission_events` schema.
  - `openclaw_runtime/src/acp/control-plane/manager.runtime-resume-state.ts`: stale ACP persistent-session recovery, one-time fresh runtime handle retry, and clearing persisted runtime resume identifiers while preserving the session shell.
  - `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts`: shadow comparison between persisted event-log replay and latest long-task checkpoint, with `legacyAuthoritative: true` and recommendations to keep legacy checkpoints authoritative.
  - `docs/clawx-design-overview.md`: confirms Task Ledger is not an executor, not memory, not transcripts, and not observability; `/loop` must create an explicit ledger root before recoverable checkpoint/intervention state; `LoopContextPack` is the only `/loop` recovery-context builder.
- Existing modules found:
  - Production: Task Ledger type contract, long-task checkpoint store, Mission store/controller, LoopContextPack, SQLite schema, ACP stale-session recovery.
  - Shadow: persisted resume shadow and event-log replay comparison; event log replay remains diagnostic unless flags are enabled.
  - Pilot/planned: promotion of event-log replay to authority, Mission scheduled ticks, broader session continuity beyond minimal checkpoints.
- Non-goals and constraints identified:
  - Task Ledger is not an executor, memory store, transcript, or observability trace store.
  - Memory may cite ledger state as evidence, but ledger events remain task-state truth.
  - Ordinary Chat is not automatically promoted into `/loop`; checkpoint/intervention state requires an explicit `/loop` root.
  - `LoopContextPack` is the only `/loop` recovery-context generation entry point.
  - Resume shadow follows the pilot pattern: legacy checkpoints authoritative until explicit gates prove replay safe.

## 1. Gap Analysis

- What the existing system can do:
  - Persist task structure through `shared/types/task-ledger.ts` and the Main-owned Task Ledger JSONL/snapshot model described in `docs/clawx-design-overview.md`.
  - Persist minimal continuation state through `RuntimeResumeCheckpoint` in `openclaw_runtime/src/agents/long-task-control/store.ts`, including objective/task hints, blockers, decisions, deviations, files, tests, next action, review items, evidence refs, validation state, acceptance status, and control signals.
  - Persist Mission lifecycle state through `openclaw_runtime/src/agents/mission-control/store.ts` and `openclaw_runtime/src/state/openclaw-state-schema.sql`.
  - Pause/resume Mission records at the policy-loop level through `pauseMission` (controller.ts:1100) and `resumeMission` (controller.ts:1111) in `openclaw_runtime/src/agents/mission-control/controller.ts` — note these mutate the Mission record's status only; they do not capture agent execution state, which is exactly the gap this design fills.
  - Rebuild bounded recovery prompt context through `openclaw_runtime/src/agents/loop-context-pack.ts`.
  - Recover from stale ACP runtime identifiers by clearing backend resume state and retrying with a fresh runtime handle in `manager.runtime-resume-state.ts`.
  - Compare event-log replay against legacy checkpoints in shadow through `persisted-resume-shadow.ts`.
- What the system cannot fully do yet:
  - Save a formal, versioned "session continuity contract" that says which agent state is guaranteed, reconstructable, or intentionally lost across pause/resume.
  - Pause a running session as a single coordinated transaction across hot in-memory state, SQLite state, transcript/session metadata, runtime handle identity, queued interventions, and filesystem checkpoint artifacts.
  - Resume with structured degradation when source files, workspace state, provider availability, or runtime identity changed.
  - Promote event-log replay from shadow comparison to active reconstruction while preserving the existing pilot boundaries.
- Why this matters:
  - Personal learning projects often involve long architectural investigations that span restarts. The user needs to know what survived, what was reconstructed, and what must be revalidated.
  - Without a contract, resume can appear to work while silently losing assumptions, tool outputs, or source-file freshness.
- Non-goals respected:
  - The design does not turn Task Ledger into an executor or transcript store.
  - It does not replace Mission Control, Task Loop, `LoopContextPack`, memory, observability, or ACP runtime sessions.
  - It keeps legacy checkpoints authoritative until shadow/pilot gates are passed.

## 2. Architecture Overview

```text
[EXISTING] In-memory turn/session state
        |
        v
[NEW] SessionContinuityCoordinator
        |
        +--> [EXISTING] long-task-control/store.ts
        |        warm checkpoint rows
        |
        +--> [EXISTING] mission-control/store.ts
        |        mission_runs / mission_events
        |
        +--> [EXISTING] Task Ledger JSONL snapshot
        |        task structure and progress only
        |
        +--> [NEW] ColdCheckpointWriter
        |        filesystem checkpoint bundle
        |
        +--> [EXISTING] manager.runtime-resume-state.ts
                 runtime identity handling

[NEW] ResumeContractVerifier
        |
        +--> [EXISTING] loop-context-pack.ts
        |        bounded recovery prompt
        |
        +--> [EXISTING] persisted-resume-shadow.ts
        |        replay-vs-checkpoint diagnostics
        |
        v
[NEW] DegradationPlanner
        |
        v
[EXISTING] Mission Control / Task Loop / ACP session shell
```

The design adds a coordination layer around existing stores. Hot state remains process-owned, warm state remains SQLite and Task Ledger, and cold state becomes a filesystem checkpoint bundle referenced by existing evidence refs.

## 3. Component Specifications

### SessionContinuityCoordinator

Responsibility: Owns the pause/resume transaction boundary. It collects the latest in-memory turn metadata, Mission state, Task Ledger root id, long-task checkpoint, runtime identity, queued intervention status, and optional cold bundle reference. It does not execute work; it records enough state for existing controllers to resume safely.

Interfaces:

```ts
type PauseSessionRequest = {
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  reason: "user_pause" | "app_shutdown" | "session_rotation" | "mission_sleep" | "runtime_error";
  activeMissionId?: string;
  taskLedgerRootId?: string;
  activeTask?: string;
  traceId?: string;
  allowColdBundle?: boolean;
};

type ResumeSessionRequest = {
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  preferredMissionId?: string;
  mode: "resume_if_safe" | "resume_with_review" | "fresh_with_context";
};

type SessionContinuitySnapshot = {
  schemaVersion: 1;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  stateTier: "hot" | "warm" | "cold";
  checkpointId?: string;
  missionId?: string;
  taskLedgerRootId?: string;
  runtimeIdentityState: "current" | "pending" | "cleared" | "unknown";
  coldBundleRef?: string;
  createdAt: string;
  resumeContract: ResumeContract;
};
```

Internal state: Keeps only short-lived locks and in-flight transaction status. Durable state is delegated to `long_task_checkpoints`, `mission_runs`, Task Ledger events, and cold bundle files.

Lifecycle: Created by the runtime control plane or Gateway session service. On pause, obtains a `state_leases` lease, records warm checkpoint state, optionally writes a cold bundle, releases the lease, and returns a snapshot. On resume, reads warm/cold state and delegates validation to `ResumeContractVerifier`.

Error handling: If full pause fails after partial writes, records a checkpoint with status `partial` and a degradation note. Resume treats partial snapshots as review-required and uses `LoopContextPack` instead of blindly continuing.

### ResumeContractVerifier

Responsibility: Defines and verifies what survives pause/resume. It classifies state as guaranteed, reconstructable, or volatile, then produces a resume decision.

Interfaces:

```ts
type ResumeContract = {
  version: 1;
  guaranteed: {
    taskLedgerEvents: boolean;
    missionRunRecord: boolean;
    latestRuntimeResumeCheckpoint: boolean;
    queuedUserMessages: boolean;
  };
  reconstructable: {
    loopContextPack: boolean;
    transcriptSummary: boolean;
    eventLogReplay: "shadow_only" | "pilot" | "active";
    runtimeSessionIdentity: "best_effort";
  };
  volatile: {
    inFlightToolCalls: "not_guaranteed";
    processMemory: "not_guaranteed";
    openFileHandles: "not_guaranteed";
    externalCommandState: "not_guaranteed";
  };
};

type ResumeVerificationResult = {
  decision: "safe_resume" | "resume_with_review" | "fresh_session_with_context" | "blocked";
  contract: ResumeContract;
  checkpointId?: string;
  missionId?: string;
  taskLedgerRootId?: string;
  degradationReasons: string[];
  requiredReviewItems: string[];
  evidenceRefs: Array<{ type: string; ref: string; label?: string }>;
};
```

Internal state: None. It reads from existing stores and produces a deterministic verification result.

Lifecycle: Runs before Mission resume, session handoff, or fresh-session recovery. It can also run during shutdown as a dry-run to warn whether a pause is complete.

Error handling: Missing Task Ledger root, corrupt checkpoint JSON, unreadable cold bundle, or mismatched replay returns `resume_with_review` or `blocked` rather than mutating state.

### ColdCheckpointWriter

Responsibility: Writes optional filesystem checkpoint bundles for data too large or too file-oriented for SQLite JSON columns. The bundle stores normalized metadata, source-file fingerprints, transcript summary pointers, latest compression artifact refs, and evidence links.

Interfaces:

```ts
type ColdCheckpointBundle = {
  schemaVersion: 1;
  bundleId: string;
  sessionKey: string;
  checkpointId: string;
  createdAt: string;
  files: Array<{ path: string; sha256?: string; mtimeMs?: number; exists: boolean }>;
  transcriptRefs: Array<{ kind: "summary" | "artifact" | "jsonl"; ref: string }>;
  evidenceRefs: Array<{ type: string; ref: string; label?: string }>;
  degradationPolicy: "review_on_mismatch" | "fresh_context_on_mismatch";
};
```

Internal state: Owns a workspace-contained checkpoint directory and atomic write temp files. It does not own task truth.

Lifecycle: Called after `recordLongTaskCheckpoint` succeeds. Writes bundle metadata, then updates checkpoint metadata/evidence refs with the bundle ref.

Error handling: Bundle write failure does not invalidate the warm checkpoint. It records `coldBundleUnavailable` in checkpoint metadata and forces resume review for file-fingerprint-dependent state.

### DegradationPlanner

Responsibility: Turns verification mismatches into a recovery route. It decides whether to resume directly, ask for review, start a fresh session with `LoopContextPack`, or block until user input.

Interfaces:

```ts
type DegradationPlan = {
  route: "continue_existing_runtime" | "fresh_runtime_same_session" | "new_session_handoff" | "ask_user" | "block";
  reason: string;
  loopContextInput?: LoopContextPackInput;
  missionPatch?: { status?: MissionStatus; phase?: MissionPhase; blockedReason?: string };
  taskLedgerReviewEvents: Array<{ title: string; reason: string; evidenceRefs: unknown[] }>;
};
```

Internal state: Stateless. It delegates prompt construction to `buildLoopContextPack`, Mission updates to `saveMissionRun`, and ledger review writes to Task Ledger APIs.

Lifecycle: Runs after `ResumeContractVerifier`. If route is `new_session_handoff`, it prepares context but does not auto-send.

Error handling: If all recovery context is unavailable, returns `block` with a concrete user-facing reason.

### ContinuityPromotionGate

Responsibility: Applies the existing pilot pattern to any move from checkpoint-only resume toward event-log-assisted active reconstruction.

Interfaces:

```ts
type ContinuityPromotionReport = {
  mode: "shadow" | "pilot" | "active";
  legacyCheckpointAuthoritative: boolean;
  replayMatchStatus: "matched" | "mismatch" | "waiting_verification" | "unreadable";
  requiredBoundaries: string[];
  rollback: "disable_flag_use_legacy_checkpoint";
  safeToPromote: boolean;
  blockers: string[];
};
```

Internal state: Bounded diagnostics only. It reads reports from `persisted-resume-shadow.ts`.

Lifecycle: Runs during resume validation and during test/audit workflows.

Error handling: Any unreadable event log, mismatch, missing legacy checkpoint, or unverified tool reuse keeps legacy checkpoint authority.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|-----------------|-----------------|-----------|
| `openclaw_runtime/src/agents/long-task-control/store.ts` | Add optional continuity metadata fields to checkpoint metadata and status values such as `paused`, `partial`, `resume_review_required`; keep `RuntimeResumeCheckpoint` v1 compatible. New status values ride in the existing free-text `status` column of `long_task_checkpoints` — no SQL migration. Reuse the existing `ResumeCheckpointTrigger` value `session_rotation` for coordinator-initiated pauses rather than adding a new trigger. | The checkpoint store is already the warm durable resume anchor. Changes should be additive and idempotent (the table already has an `idempotency_key` unique column). |
| `openclaw_runtime/src/agents/mission-control/controller.ts` | Route `pauseMission` and `resumeMission` through `SessionContinuityCoordinator` when enabled; keep current status transitions as fallback. | Mission state is the policy loop that users understand; pause/resume should still produce Mission events. |
| `openclaw_runtime/src/agents/mission-control/store.ts` | No schema rewrite. Continue saving `mission_runs` and `mission_events`; store continuity refs in the existing `metadata_json` column of `mission_runs` (defaults to `'{}'`, so no migration). | Mission persistence is already normalized enough for warm state. |
| `shared/types/task-ledger.ts` | No executor fields. Optionally add future evidence ref type only if needed; otherwise use existing `session`, `trace`, `file`, `memory`, `manual`, `tool`, `other`. | Task Ledger remains task-state truth, not runtime state. |
| `openclaw_runtime/src/agents/loop-context-pack.ts` | Add optional `continuitySnapshot` input if needed, rendered into existing resume/checkpoint or transcript sections. | Recovery context must continue through the single bounded context builder. |
| `openclaw_runtime/src/state/openclaw-state-schema.sql` | Prefer metadata JSON and existing tables first. Add a future `session_continuity_snapshots` table only if query/reporting needs outgrow checkpoint metadata. | Avoid unnecessary schema churn; the existing warm tables are strong enough for a pilot. |
| `openclaw_runtime/src/acp/control-plane/manager.runtime-resume-state.ts` | Expose a small result object when clearing runtime identity so the coordinator can record `runtimeIdentityState`. | ACP stale-session recovery already knows when identity is cleared; continuity needs to report that fact. |
| `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts` | Feed `ContinuityPromotionGate`; keep `legacyAuthoritative: true` until explicit promotion. | Event-log replay must not silently become active resume authority. |
| `docs/clawx-design-overview.md` | Update after implementation to describe the resume contract and cold bundle boundary. | Documentation should reflect behavior once code exists. |

## 5. Data Flow

Scenario: the user pauses a running Mission, closes the app, edits a source file externally, then resumes.

1. The user requests pause. Mission Control calls `SessionContinuityCoordinator.pauseSession` with `sessionKey`, `missionId`, and `taskLedgerRootId`.
2. The coordinator takes a `state_leases` lease from `openclaw-state-schema.sql` to avoid overlapping pause/resume writes.
3. It calls `recordLongTaskCheckpoint` in `openclaw_runtime/src/agents/long-task-control/store.ts` with trigger `session_rotation` or `guide`, including current decisions, blockers, evidence refs, validation state, and Task Ledger root id.
4. `recordLongTaskCheckpoint` writes `long_task_checkpoints` and best-effort Task Ledger projection. If projection fails, SQLite recovery state remains durable.
5. Mission Control saves `mission_runs` and appends `mission_events` through `saveMissionRun` and `recordMissionEvent`.
6. `ColdCheckpointWriter` writes file fingerprints and evidence refs to a bundle and attaches the bundle ref to checkpoint metadata.
7. On app restart, resume begins with `ResumeContractVerifier`. It reads latest Mission state, latest long-task checkpoint, queued messages, Task Ledger snapshot, cold bundle, and ACP runtime identity.
8. The verifier detects a changed source-file hash and returns `resume_with_review`.
9. `DegradationPlanner` builds a `LoopContextPackInput` with Task Ledger current state, the latest `RuntimeResumeCheckpoint`, transcript summary or compression artifact refs, and a review item explaining the file mismatch.
10. `buildLoopContextPack` creates bounded recovery context. P0 constraints and interventions are preserved; lower-priority memory/transcript data may be truncated.
11. Mission status becomes `ask_user` or `sleeping` depending on policy. The runtime does not claim seamless continuation until the user accepts the review or a fresh-context handoff is started.

## 6. Migration Path

- Phase 1: shadow contract
  - Generate `ResumeContract` and `ResumeVerificationResult` during pause/resume, but keep current pause/resume behavior.
  - Run `persisted-resume-shadow.ts` and record whether event-log replay matches latest checkpoints.
  - Store diagnostics in checkpoint metadata or LCP reports only.
- Phase 2: review-required pilot
  - Default-off flag.
  - Enable coordinated pause snapshots for explicit `/loop` or Mission sessions only.
  - On mismatch, require review or fresh-context handoff; never auto-continue.
- Phase 3: active warm resume
  - Allow `safe_resume` only when checkpoint, Mission, Task Ledger root, runtime identity, and file fingerprints are consistent.
  - Event-log replay remains advisory unless `ContinuityPromotionGate` says promotion criteria are met.
- Promotion gates:
  - Persisted resume shadow reports `matched` for representative task types.
  - No unreadable event-log rows in promotion sample.
  - Resume after app restart preserves Mission status, Task Ledger root, checkpoint evidence refs, and queued user messages.
  - File mismatch detection reliably routes to review.
  - Disable-only rollback returns to current checkpoint-based behavior.
- Rollback:
  - Disable the continuity feature flag.
  - Ignore continuity metadata and cold bundles.
  - Keep using `getLatestLongTaskCheckpoint`, current Mission store, and ACP fresh-handle retry.

## 7. Design Decisions

- Decision: Make the resume contract explicit instead of trying to persist every runtime detail.
  - Why: Tool calls, process memory, handles, and external commands are not reliably serializable.
  - Alternative rejected: Full process snapshotting. That would be brittle, platform-specific, and outside the local Node/Electron architecture.
  - Extension point: Runtime backends can later declare additional guaranteed fields.
- Decision: Keep Task Ledger as task truth, not execution state.
  - Why: `docs/clawx-design-overview.md` explicitly defines Task Ledger as structure/progress, not executor, memory, transcripts, or traces.
  - Alternative rejected: Store full agent state as Task Ledger metadata. That would pollute durable work state and make recovery semantics unclear.
  - Extension point: Ledger review nodes can record resume risks and user decisions.
- Decision: Use warm SQLite checkpoints as the primary resume anchor.
  - Why: `long_task_checkpoints`, `mission_runs`, and queue tables already exist and are indexed by session/status/root id.
  - Alternative rejected: A new continuity database as the first step. Existing tables already model most warm state.
  - Extension point: A `session_continuity_snapshots` table can be added later if reporting and retention require it.
- Decision: Use cold bundles for file-sensitive recovery evidence.
  - Why: Source fingerprints and transcript artifact references are better stored as workspace-contained files than squeezed into SQLite JSON columns.
  - Alternative rejected: Re-read all transcripts and files on every resume with no recorded baseline. That cannot distinguish expected from changed state.
  - Extension point: Cold bundles can later include compaction artifact projections, ClawGraph handoff snapshots, or trace summaries.
- Decision: Keep event-log replay shadow-authoritative only.
  - Why: `persisted-resume-shadow.ts` already reports `legacyAuthoritative: true`; promoting replay must follow the project's pilot pattern.
  - Alternative rejected: Use event-log replay as active resume immediately. Mismatches and unreadable rows would create unsafe state reconstruction.
  - Extension point: `ContinuityPromotionGate` can later enable event-log-assisted reconstruction for narrow task classes.

## 8. Validation Approach

- Unit experiments:
  - Pause/resume contract generation with complete, partial, and missing checkpoints.
  - Corrupt checkpoint JSON and unreadable cold bundle routes to review/block instead of crashing.
  - Changed file fingerprint routes to `resume_with_review`.
  - Idempotent pause writes do not duplicate `long_task_checkpoints`, `mission_events`, or Task Ledger projections.
- Integration experiments:
  - Start a Mission, reach checkpoint phase, pause, restart runtime, resume with unchanged workspace, and verify `safe_resume`.
  - Repeat with changed source files and verify review-required recovery context includes the mismatch.
  - Queue user messages before pause and verify `long_task_user_queue` survives and drains or restores correctly.
  - Force ACP missing persistent-session errors and confirm `manager.runtime-resume-state.ts` clears identity while continuity records degradation.
- Metrics:
  - Resume success rate by route.
  - Count of review-required resumes caused by source changes, missing checkpoints, or runtime identity reset.
  - Persisted resume shadow match rate.
  - Lost queued-message count, expected to be zero.
  - Time from resume request to usable `LoopContextPack`.
  - User-visible blocked resumes with actionable reasons.
- Acceptance signal:
  - A long-running Mission can pause across app restart, resume with clear state guarantees, and gracefully degrade to fresh bounded context when exact continuation is unsafe.

## 9. Round 2 Affirmed Design Strengths

The following Round 2 decisions are affirmed and must be preserved in implementation.

### 9.1 File fingerprint ownership: A6 is single source of truth, stored in SQLite

**Decision**: A6 owns file fingerprints. A1 reads A6's fingerprints. Fingerprints are stored in `long_task_checkpoints.metadata_json` (existing SQLite JSON column), not in a separate cold bundle filesystem surface.

**Why affirmed**: Single ownership eliminates the A1-vs-A6 fingerprint race. SQLite JSON column is sufficient for ~100 bytes/file (1000 files ≈ 100KB). The 5-point persistence checklist (below) confirms this is sound across backup, migration, crash consistency, and retention.

**Implementation constraint**: `metadata_json.file_fingerprints` schema is versioned (`version: 1`). A6 writes; A1 reads; no other module writes fingerprints. The `ColdCheckpointWriter`, `ColdCheckpointBundle`, `coldBundleRef`, bundle orphan cleanup, and atomic bundle write logic are all deleted — zero compatibility layer.

### 9.2 Persistence surface 5-point checklist (enforced gate)

**Decision**: Every new persistence surface proposed in any area must justify against five questions: (1) byte-size estimate, (2) backup/restore story, (3) migration story, (4) crash consistency, (5) retention policy. If any answer is "not yet defined," the surface is rejected.

**Why affirmed**: Concrete and enforceable. The checklist caught `ColdCheckpointWriter` (failed justification on byte-size grounds — fingerprints fit SQLite JSON) and will catch future speculative persistence layers before they are merged.

**Implementation constraint**: The checklist must be applied at PR review time to any change proposing a new persistence surface (new SQLite table, new file format, new on-disk directory). PRs proposing new surfaces without checklist answers in the PR description must be rejected. The checklist is documented in the development manual and referenced in PR template.
