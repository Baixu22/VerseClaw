# 1. Layered Execution Isolation

## Exploration Log

> FAILURE NOTE: The mandatory `codegraph_decide` and `codegraph_context_plan` calls could not be executed because no CodeGraph MCP tools/resources are exposed in this session, and the `rtk` shell proxy named by project instructions is not on PATH. I used the plan's named files plus local `rg`/file reads instead, and kept the scope limited to Area 1.

- CodeGraph plans executed: attempted availability discovery through MCP resource/template listing; no CodeGraph tools were callable. Local fallback reading list: `electron/utils/sandbox-policy-resolver.ts`, `electron/services/sandbox-api.ts`, `shared/types/sandbox.ts`, `openclaw_runtime/src/acp/control-plane/spawn.ts`, plugin boundary/policy files, and `docs/clawx-design-overview.md`.
- Files read:
  - `electron/utils/sandbox-policy-resolver.ts`: `resolveSandboxEffectivePolicy` normalizes requested provider, computes degradation to `policy-light`, maps workspace permission mode into OpenClaw config (via `mapWorkspacePermissionToSandboxConfig` and `describeSandboxRuntimeLevel` from `electron/utils/workspace-runtime-permissions.ts`), normalizes network policy (`normalizeNetworkPolicy` folds the legacy `localOnly` profile value into `approvalRequired`), and emits warnings.
  - `electron/services/sandbox-api.ts`: sandbox state is Main-owned through `sandbox.status`, `sandbox.detectProviders`, `sandbox.updateProfile`, and `sandbox.explain`; profiles are persisted in `electron-store`.
  - `shared/types/sandbox.ts`: existing public model has `SandboxProviderId`, `SandboxRuntimeLevel = policy | light | strong | unavailable`, `SandboxNetworkPolicy`, capabilities, OpenClaw sandbox config, and effective policy/status types.
  - `openclaw_runtime/src/acp/control-plane/spawn.ts`: spawn cleanup is best-effort across runtime close, ACP manager close, session binding unbind, and gateway session delete; this is a recovery hook, not a general isolation planner.
  - `openclaw_runtime/src/acp/translator.ts` search results: ACP session metadata already carries `spawnedWorkspaceDir`, `spawnedCwd`, `spawnedBy`, and `spawnDepth`, which are the current worktree/session boundary signals.
  - `openclaw_runtime/src/plugins/AGENTS.md`: plugin boundary separates control-plane discovery/manifest work from runtime execution; manifest-first and lazy activation are hard rules.
  - `openclaw_runtime/src/plugins/config-policy.ts`: plugin activation is config/trust-list driven without activating runtime code.
  - `openclaw_runtime/src/plugins/trusted-tool-policy.ts`: plugins can contribute trusted tool policies that may block, mutate params, or require approval before tool calls.
  - `openclaw_runtime/src/plugins/runtime/runtime-plugin-boundary.ts`: plugin runtime boundaries resolve manifest-owned module paths and loading rules; they are package/source boundaries, not OS sandboxes.
  - `docs/clawx-design-overview.md`: section 7.1 documents `policy-light` default, optional `windows-light`, `docker-strong`, `ssh-strong`, degraded fallback, and the explicit non-goal that `policy-light` is not container/VM isolation.
- Existing modules found:
  - Production: `shared/types/sandbox.ts`, `electron/utils/sandbox-policy-resolver.ts`, `electron/services/sandbox-api.ts`, `src/lib/host-api.ts`, `shared/host-api/contract.ts`.
  - Production: ACP session manager/translator/spawn cleanup under `openclaw_runtime/src/acp/`, with session/workspace metadata and cleanup hooks.
  - Production: plugin activation/trust policy/runtime boundary under `openclaw_runtime/src/plugins/`.
  - Planned/reserved: `ssh-strong` provider is typed and documented but not wired as a concrete local provider.
  - Optional/degraded: `docker-strong` is production-visible but optional and degrades to `policy-light` if Docker CLI/daemon/image are missing.
- Non-goals and constraints identified:
  - `policy-light` is not a container, VM, kernel, or Docker-equivalent boundary.
  - Docker is not a hard dependency for default app operation.
  - Renderer must use host-api; sandbox policy remains Main-owned.
  - Plugin boundaries should remain manifest/config/trust boundaries and should not become private plugin-only backdoors.

## 1. Gap Analysis

- Existing system can compute a workspace-level effective sandbox policy through `electron/utils/sandbox-policy-resolver.ts`, expose it through `electron/services/sandbox-api.ts`, and share the type contract through `shared/types/sandbox.ts`.
- Existing system can degrade unavailable strong providers to `policy-light` with warnings, so local development remains usable without Docker.
- Existing ACP paths can isolate spawned work by session/workspace metadata (`openclaw_runtime/src/acp/translator.ts`) and clean up partial spawn state (`openclaw_runtime/src/acp/control-plane/spawn.ts`).
- Existing plugin paths can gate plugin-owned tools through config activation and `openclaw_runtime/src/plugins/trusted-tool-policy.ts`.
- The system cannot currently choose a stricter or looser isolation tier for an individual turn or tool action. Once a workspace profile is selected, every action inherits the same effective provider.
- The system cannot create per-turn filesystem snapshots or overlays for `policy-light` mode. It can block or approve operations, but it cannot cheaply reset a turn's writes.
- The system cannot express per-turn network intent beyond a workspace profile's `SandboxNetworkPolicy`.
- This gap matters because a personal learning agent often mixes harmless read-only exploration, risky file edits, external network fetches, and destructive cleanup in one session. Per-turn isolation would let the runtime pay the cost of stronger boundaries only when the action actually needs them.
- The design respects the existing non-goal that `policy-light` is not strong isolation. It improves auditability and reset behavior under `policy-light`, while making no false container/VM claim.

## 2. Architecture Overview

```text
[EXISTING] Renderer Settings UI
        |
        v
[EXISTING] src/lib/host-api.ts
        |
        v
[EXISTING] electron/services/sandbox-api.ts
        |
        v
[EXISTING] electron/utils/sandbox-policy-resolver.ts
        |                         [NEW] PerTurnIsolationPolicyResolver
        |------------------------------------|
                                             v
[EXISTING] shared/types/sandbox.ts  ->  [NEW] shared/types/turn-isolation.ts
                                             |
                                             v
[EXISTING] ACP session manager/translator -> [NEW] TurnIsolationCoordinator
                                             |
                 +---------------------------+---------------------------+
                 v                           v                           v
        [NEW] PolicyLightSnapshotter  [NEW] NetworkIntentGate    [NEW] IsolationFailureRecovery
                 |                           |                           |
                 v                           v                           v
[EXISTING] workspace roots/files APIs [EXISTING] approval policy  [EXISTING] spawn cleanup/session close

[EXISTING] plugin trusted-tool-policy.ts -> [NEW] IsolationAdvice hook input
```

## 3. Component Specifications

### PerTurnIsolationPolicyResolver

Responsibility: Computes an action-scoped isolation decision by narrowing, never widening, the workspace effective policy from `resolveSandboxEffectivePolicy`. It accepts the action kind, files, network intent, plugin/tool owner, and risk classification, then returns the minimum viable tier plus degradation reasons.

Interfaces:

```ts
export type TurnIsolationMode = "inherit-workspace" | "policy-snapshot" | "light-process" | "strong-runtime";

export interface TurnIsolationRequest {
  sessionKey: string;
  turnId: string;
  toolName?: string;
  pluginId?: string;
  risk: "read" | "write" | "network" | "destructive" | "external-write" | "dangerous";
  paths?: string[];
  networkIntent?: "none" | "local" | "external";
  requestedRuntimeLevel?: SandboxRuntimeLevel;
}

export interface TurnIsolationDecision {
  mode: TurnIsolationMode;
  effectiveRuntimeLevel: SandboxRuntimeLevel;
  providerId: SandboxProviderId;
  networkPolicy: SandboxNetworkPolicy;
  degraded: boolean;
  reasons: string[];
  requiresApproval: boolean;
  snapshotRequired: boolean;
}
```

Internal state: Owns no durable policy state. It reads the workspace `SandboxEffectivePolicy`, provider availability, and action metadata; decisions are recorded as telemetry by the coordinator.

Lifecycle: The workspace `SandboxEffectivePolicy` is computed in Main (as today) and shipped to the runtime through the existing `SandboxOpenClawConfig` path. The per-turn resolver runs **runtime-side**, narrowing against that shipped snapshot — it must not require a synchronous Main round-trip per tool call, because Main and the runtime are separate processes connected over WS/HTTP. It is invoked once before each turn/tool action; discarded decisions become trace/audit entries.

> REVIEW NOTE: Confirm the ownership split — the design assumes workspace policy stays Main-owned (`electron/utils/sandbox-policy-resolver.ts`) while per-turn narrowing runs in the runtime against the config snapshot Main already passes down. If per-turn decisions must instead round-trip to Main, the latency and failure-mode analysis below changes.

Error handling strategy: If provider detection or decision construction fails, return a degraded `policy-light` decision with approval required for writes/network/destructive actions.

### TurnIsolationCoordinator

Responsibility: Owns the per-turn lifecycle: plan isolation, prepare snapshot/overlay if needed, pass the decision into ACP/tool execution, finalize by either committing accepted changes or reverting failed/unapproved changes.

Interfaces:

```ts
export interface TurnIsolationLease {
  leaseId: string;
  sessionKey: string;
  turnId: string;
  decision: TurnIsolationDecision;
  overlayRoot?: string;
  touchedPaths: string[];
}

export interface TurnIsolationCoordinator {
  begin(request: TurnIsolationRequest): Promise<TurnIsolationLease>;
  recordPathTouch(leaseId: string, path: string): Promise<void>;
  commit(leaseId: string, result: { approved: boolean }): Promise<void>;
  rollback(leaseId: string, reason: string): Promise<void>;
}
```

Internal state: Owns short-lived leases and delegates durable facts to existing transcript/event/audit surfaces. It does not replace ACP session state.

Lifecycle: Begins before a turn or risky tool call, remains active through execution, and tears down after commit/rollback. Leases must be idempotently recoverable after process crashes.

Error handling strategy: Lease creation failure falls back to `inherit-workspace` only for read-only actions. For mutating actions, failure changes the decision to approval-required or blocked, depending on workspace permission mode.

### PolicyLightSnapshotter

Responsibility: Provides fast reset semantics without containers by taking file-level snapshots for paths that a turn intends to mutate or discovers during execution. For Git workspaces, it can prefer Git-index/diff metadata; for non-Git workspaces, it stores content copies under an OpenClaw checkpoint directory.

Interfaces:

```ts
export interface SnapshotPlan {
  root: string;
  expectedPaths: string[];
  mode: "git-diff" | "copy-on-write";
  maxBytes: number;
}

export interface SnapshotHandle {
  id: string;
  mode: SnapshotPlan["mode"];
  capturedPaths: string[];
  restore(): Promise<void>;
  discard(): Promise<void>;
}
```

Internal state: Owns only temporary snapshot manifests and copied file content. It delegates path validation to existing Main/Gateway workspace-root checks.

Known limits (stated up front so the shadow phase can measure them): snapshots only cover paths the runtime itself touches through tool execution. Writes made by spawned shell commands to unpredicted paths, or by external processes, are only caught if `recordPathTouch` is wired into the exec tool's output parsing. The shadow phase's predicted-vs-actual touched-path comparison exists precisely to size this hole before enforcement.

Lifecycle: Created during `begin`, expanded as files are touched, discarded on commit, restored on rollback, and garbage-collected on startup if orphaned.

Error handling strategy: Snapshot failures are terminal for destructive or external-write actions; for ordinary edits, they degrade to approval-required policy execution if the user accepts the risk.

### NetworkIntentGate

Responsibility: Maps per-turn `networkIntent` onto the existing `SandboxNetworkPolicy`. `disabled` blocks external network actions; `approvalRequired` requests approval for external network; `enabled` allows but records intent and destination class.

Interfaces:

```ts
export interface NetworkIntentDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  effectivePolicy: SandboxNetworkPolicy;
}
```

Internal state: Stateless. It reads the turn decision and existing workspace policy.

Lifecycle: Invoked before tool/plugin/network-capable action execution.

Error handling strategy: Unknown destination or unclassified network intent is treated as external and approval-required unless workspace policy is `disabled`, where it is blocked.

### IsolationFailureRecovery

Responsibility: Defines the mid-turn recovery path when an isolation lease, provider, or snapshot fails. It routes cleanup through existing ACP close/session cleanup where needed and emits a resumable failure record.

Interfaces:

```ts
export interface IsolationFailureRecord {
  leaseId: string;
  sessionKey: string;
  turnId: string;
  phase: "prepare" | "execute" | "commit" | "rollback";
  recoveryAction: "retry-policy-light" | "rollback-files" | "close-child-session" | "ask-user" | "block";
  message: string;
}
```

Internal state: Owns no independent execution state. It delegates child-session cleanup to `cleanupFailedAcpSpawn` and workspace cleanup to `PolicyLightSnapshotter`.

Lifecycle: Called on exceptions from coordinator phases.

Error handling strategy: Prefer rollback, then ask-user, then block. Never silently continue after a failed snapshot for a destructive action.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `shared/types/sandbox.ts` | Additive only: optionally export per-turn policy aliases or keep them in new `shared/types/turn-isolation.ts`. | Preserve the workspace-level contract while reusing `SandboxRuntimeLevel`, `SandboxNetworkPolicy`, and `SandboxProviderId`. |
| `electron/utils/sandbox-policy-resolver.ts` | Add `resolveTurnIsolationPolicy(workspacePolicy, request)` beside `resolveSandboxEffectivePolicy`; no rewrite. | This file is the single effective-policy resolver, so per-turn narrowing should compose with it. |
| `electron/services/sandbox-api.ts` | Add optional `sandbox.explainTurn` diagnostic endpoint in shadow phase; no change to existing status/update behavior. | Allows UI/log inspection without changing active sandbox behavior. |
| `shared/host-api/contract.ts` | Add host-api result/payload types for turn isolation diagnostics only. | Renderer must not call runtime directly. |
| `src/lib/host-api.ts` | Add `hostApi.sandbox.explainTurn` wrapper. | Maintains Renderer/Main API boundary. |
| `openclaw_runtime/src/acp/control-plane/manager.core.ts` | Add optional turn isolation lease hooks around turn execution; keep current session actor ordering. | ACP owns session lifecycle, so lease boundaries must align with turns. This file is large, so changes must be additive hooks rather than a control-flow rewrite. |
| `openclaw_runtime/src/acp/control-plane/spawn.ts` | No behavioral change initially; reuse `cleanupFailedAcpSpawn` from recovery paths. | Existing best-effort cleanup already covers partial child sessions. |
| `openclaw_runtime/src/acp/translator.ts` | Add optional isolation metadata to session/turn presentation after shadow validation. | Existing `spawnedWorkspaceDir`/`spawnedCwd` metadata can help explain boundaries. This is additive because translator is already large. |
| `openclaw_runtime/src/plugins/trusted-tool-policy.ts` | Add isolation decision/advice fields to policy evaluation context; no direct sandbox execution. | Plugin-owned policies can advise or require approval but should not bypass core policy. |
| `openclaw_runtime/src/plugins/runtime/runtime-plugin-boundary.ts` | No change. | Plugin module boundaries are source/loading boundaries, not per-turn process isolation. |
| `docs/clawx-design-overview.md` | Add a design note if implemented later. | Documents that policy snapshots are reset/audit features, not strong isolation. |

## 5. Data Flow

Scenario: an agent turn plans to edit two workspace files and call a network-capable documentation tool.

1. Renderer requests the turn through existing session/chat flows and does not choose isolation directly.
2. Main/runtime asks `electron/utils/sandbox-policy-resolver.ts` for the workspace `SandboxEffectivePolicy`.
3. `PerTurnIsolationPolicyResolver` receives a `TurnIsolationRequest` with `risk = "write"`, the planned paths, and `networkIntent = "external"`.
4. If the workspace uses `policy-light`, the resolver selects `policy-snapshot`, keeps `effectiveRuntimeLevel = "policy"`, and maps network through the workspace `SandboxNetworkPolicy`.
5. `TurnIsolationCoordinator.begin` creates a lease and calls `PolicyLightSnapshotter` to capture expected paths. If later tool execution touches another file, the coordinator records it and snapshots before write.
6. Before the network-capable tool runs, `NetworkIntentGate` checks whether network is disabled, approval-required, or enabled.
7. Plugin policy evaluation in `openclaw_runtime/src/plugins/trusted-tool-policy.ts` receives isolation context and may require approval or block, but it cannot widen the workspace policy.
8. The ACP turn runs under normal `SessionActorQueue` ordering (`openclaw_runtime/src/acp/control-plane/session-actor-queue.ts`). The isolation lease is metadata and file reset machinery, not a second turn scheduler.
9. On success, the coordinator commits and discards snapshots. On failure or rejection, it restores captured paths and emits an `IsolationFailureRecord`.
10. If a child session was partially created and must be discarded, recovery reuses `openclaw_runtime/src/acp/control-plane/spawn.ts` cleanup.

## 6. Migration Path

- Shadow phase:
  - Compute per-turn decisions and snapshot plans, but do not enforce them.
  - Record whether a snapshot would have been required, whether the workspace policy would have degraded, and whether network approval would have changed behavior.
  - Compare predicted touched paths with actual touched paths to measure snapshot coverage.
  - Record shadow decisions through existing surfaces only: observability trace/span attributes (`openclaw_runtime/src/observability/trace-recorder.ts`) and the Main-side approval/audit log — no new persistence store in shadow phase.
- Pilot gate (follows the pattern encoded in `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts`: explicit invocation, operator gate, kill switch, disable-only rollback):
  - Fresh task spec under `harness/specs/tasks/`.
  - Explicit operator gate in config, default off.
  - Disable-only rollback: one flag turns active per-turn isolation back into workspace-only policy.
  - No schema-breaking changes; new fields must be optional.
  - Evidence that policy-light snapshot restore succeeds for common edit/delete/create cases.
- Active pilot:
  - Enforce only for destructive or external-write actions first.
  - Keep Docker/SSH optional and degraded fallback identical to existing workspace policy.
- Rollback plan:
  - Disable active enforcement.
  - Ignore orphaned leases after startup cleanup.
  - Continue to show workspace-level `sandbox.status` unchanged.
- Telemetry:
  - Decision mode, provider requested/effective, snapshot bytes, touched path misses, rollback success/failure, network approvals, and user overrides.

## 7. Design Decisions

- Decision: Per-turn isolation narrows workspace policy and never widens it. Why: `resolveSandboxEffectivePolicy` is already the app's single policy source, and widening at turn time would surprise users.
- Alternative rejected: Give tools direct control over sandbox provider selection. This would bypass Main-owned policy and make plugin/tool code a policy authority.
- Decision: `policy-light` uses file snapshots and audit, not process isolation. Why: the project explicitly documents `policy-light` as non-container/non-VM.
- Alternative rejected: Make Docker the standard per-turn executor. Docker is optional and missing Docker must not break default operation.
- Decision: ACP turn ordering remains unchanged. Why: isolation leases wrap execution; they do not replace `SessionActorQueue` or session lifecycle.
- Alternative rejected: Spawn a new ACP session for every turn. That would add high overhead and blur the distinction between session isolation and action reset.
- Future extension points: Windows-light process constraints, Docker-backed per-turn strong runtime, SSH-backed remote isolation, and ClawGraph node-level sandbox narrowing can all implement the same `TurnIsolationDecision` contract later.

## 8. Validation Approach

- Unit tests for `resolveTurnIsolationPolicy` covering provider degradation, network mapping, workspace permission modes, and risk classes.
- Snapshotter experiments for create/modify/delete/rename on Git and non-Git workspaces, including rollback after process crash.
- Shadow replay comparing predicted touched paths against actual tool-derived paths.
- Plugin policy tests proving plugin advice can narrow or request approval but cannot widen the effective policy.
- E2E diagnostics for `sandbox.explainTurn` once UI is added.
- Success metrics: zero behavior change in shadow mode, high touched-path prediction coverage, successful rollback for common file operations, no Docker dependency in default mode, and clear warnings when `policy-light` is being used as policy/audit rather than strong isolation.

## 9. Round 2 Affirmed Design Strengths

The following Round 2 decisions are affirmed and must be preserved in implementation.

### 9.1 File fingerprint ownership: A6 owns, A1 reads with Git-diff fallback

**Decision**: `PolicyLightSnapshotter` does not maintain its own fingerprint store. It reads fingerprints written by A6's `SessionContinuityCoordinator`. If A6 is inactive (feature flag off), A1 falls back to Git-diff mode.

**Why affirmed**: Clean single-ownership of shared state with an additive fallback preserving A1's independent operation. Eliminates the A1-vs-A6 fingerprint race condition and duplicate stores.

**Implementation constraint**: A1 imports fingerprint reads from A6's module; A1 must not write fingerprints. The Git-diff fallback must be behaviorally equivalent to today's snapshotter when A6 is off. This is an additive dependency — A1 works without A6.

### 9.2 writeRiskProfile four-category static declaration

**Decision**: Tool registration requires one of `no_writes | declared_paths | pattern_writes | dynamic_writes`. `dynamic_writes` triggers full fs-diff; undeclared write tools are rejected at registration.

**Why affirmed**: Covers the real spectrum of tool write behavior. Static enforceability at registration time replaces the unenforceable runtime `recordPathTouch` hook. The `dynamic_writes` category honestly acknowledges some tools cannot statically declare paths, and provides a defined fallback (full fs-diff) rather than silently missing paths.

**Implementation constraint**: Registration rejection must produce a clear error naming the missing field. Existing write-capable tools must be migrated to declare `writeRiskProfile` before A1 active pilot. The shadow phase measures `actual_fs_diff - declared_paths` (undeclared write events), not runtime hook coverage.
