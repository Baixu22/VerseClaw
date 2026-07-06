# 1. Layered Execution Isolation

Dynamic per-turn isolation for individual agent actions, layered on top of the existing
workspace-level sandbox system. Core invariant: **tighten-only** — a per-turn decision may
escalate isolation above the workspace's effective policy floor, never relax below it.

Status: design proposal. No implementation exists. Everything below is additive and
shadow-first, following this codebase's pilot promotion law.

See also (siblings, written in parallel; no dependency assumed):
- `02-parallel-multi-agent-orchestration.md` — parallel workers reuse existing sandbox
  workspace-copy isolation; the broker here is a synergy (per-worker floors), not a dependency.
- `03-runtime-resilience-supervisor.md` — a future consumer of the broker's mid-turn
  failure signals (rollback escalation, Mission Control surfacing).
- `06-session-continuity.md` — pause/resume interacts with open turn journals (hot state).

---

## Exploration Log

**CodeGraph note.** This repo ships CodeGraph as a runtime extension
(`openclaw_runtime/extensions/codegraph/`) whose 15 tools (`codegraph_decide`,
`codegraph_context_plan`, ...) are registered for the runtime's own agents — they are NOT
connected to this design session. The manual equivalent of a `codegraph_context_plan` I ran
instead, in priority order: (1) full reads of the four Electron sandbox policy files (they
are the declared single source of policy truth, all < 320 lines); (2) full read of the
runtime tool-invocation interception point and its two seam files (the place any per-turn
decision must attach); (3) full reads of the risk-classification prior art (approval
classifier, tool-mutation, the destructive-operation guard pilot) because the brief forbids
a parallel taxonomy; (4) targeted Grep sweeps (`worktree`, `before_tool_call`, `-shadow`,
`ADVISORY_ONLY`, `PluginHookToolKind`, `ExecSecurity`) to locate isolation mechanics,
maturity exemplars, and exact identifiers; (5) section reads of
`docs/clawx-design-overview.md` (§1.2, §7, §7.1, §8.4.1 + promotion rule, §12.2).

**Files read** (maturity in brackets):

| File | What it taught this design |
|---|---|
| `shared/types/sandbox.ts` [production] | Full vocabulary: `SandboxProviderId`, `SandboxRuntimeLevel = 'policy'\|'light'\|'strong'\|'unavailable'`, `SandboxNetworkPolicy = 'disabled'\|'approvalRequired'\|'enabled'`, `SandboxExecPolicy`, `SandboxEffectivePolicy`, `SandboxExplanation` |
| `electron/utils/sandbox-policy-resolver.ts` [production] | `resolveSandboxEffectivePolicy()` is a pure function; degrade-to-`policy-light` semantics; warning strings; stays the single source of policy truth |
| `electron/services/sandbox-api.ts` [production] | `status` / `detectProviders` / `updateProfile` / `explain` surface; `buildSandboxExplanation` shape to mirror for `explainTurn` |
| `electron/utils/sandbox-provider-detection.ts` [production] | 15s-TTL cached provider snapshot; `docker-strong` requires cli+daemon+`openclaw-sandbox:bookworm-slim`; `ssh-strong` is `available: false` in ClawX v1 |
| `electron/utils/workspace-runtime-permissions.ts` [production] | `mapWorkspacePermissionToSandboxConfig`, `applyWorkspaceSandboxConfig` — how effective policy becomes persisted OpenClaw config (`agents.defaults.sandbox.*`, `tools.exec.*`) |
| `electron/services/workspace-permissions.ts` [production] | `WorkspaceCommandRisk = 'read'\|'write'\|'network'\|'destructive'\|'external-write'`; `classifyWorkspaceCommand`, `classifyGatewayRpcRisk`, `isApprovalRisk`, `SAFE_GATEWAY_METHODS` |
| `electron/services/workspace-runtime-sync.ts` [production] | Config is written for the **next Gateway start**; live decisions stay in Main — policy reaches the runtime as config, not per-call RPC |
| `openclaw_runtime/src/acp/control-plane/spawn.ts` [production] | **Path correction (see below)** — cleanup helpers only |
| `openclaw_runtime/src/acp/approval-classifier.ts` [production] | `AcpApprovalClass = "readonly_scoped"\|"readonly_search"\|"mutating"\|"exec_capable"\|"control_plane"\|"interactive"\|"other"\|"unknown"`; `classifyAcpToolApproval` fails closed on spoofed tool identity |
| `openclaw_runtime/src/acp/policy.ts` [production] | Config-gated availability pattern (`acp.enabled`, `acp.dispatch.enabled`) |
| `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts` [production] | THE interception point: `runBeforeToolCallHook`, `wrapToolWithBeforeToolCallHook`, `HookContext` (has `config`, `cwd`, `workspaceDir`, `sessionKey`, `runId`, `sandbox: { root, bridge }`, `toolGovernance`), `HookBlockedReason`, `buildBlockedToolResult`, fail-closed catch |
| `openclaw_runtime/src/agents/agent-tools.before-tool-call.runtime.ts` / `.state.ts` [production] | Lazy runtime seam + `adjustedParamsByToolCallId` map |
| `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts` [pilot] | The pilot pattern verbatim: flag-path constant, owner constant, `defaultOff: true` / `productionReady: false` / `defaultOnApproved: false` metadata, enumerated allow reasons, evidence-qualified triggers, sanitized provenance |
| `openclaw_runtime/src/agents/bash-tools.exec-approval-request.ts` [production] | Two-phase exec approval (`exec.approval.request` / `exec.approval.waitDecision`); `RequestExecApprovalDecisionParams` carries per-request `security`/`ask` |
| `openclaw_runtime/src/agents/tool-mutation.ts` [production] | `isMutatingToolCall`, `isLikelyMutatingToolName`, `extractFileTarget` → `FileTarget`, `FILE_MUTATING_TOOL_NAMES` (`edit`, `write`), `buildToolMutationState` |
| `openclaw_runtime/src/agents/tool-catalog.ts` [production] | `isKnownCoreToolId` (trusted-identity check used by the classifier) |
| `openclaw_runtime/src/agents/sandbox/context.ts`, `workspace.ts`, `shared.ts`, `constants.ts`, `fs-bridge.types.ts`, `network-mode.ts` [production] | The real per-session isolation mechanics: `resolveSandboxContext`, `ensureSandboxWorkspace` (seeded copy), `resolveSandboxWorkspaceDir` + `resolveSandboxScopeKey` (`'session'\|'agent'\|'shared'`), `SANDBOX_STATE_DIR`, `SandboxFsBridge`, `getBlockedNetworkModeReason` |
| `openclaw_runtime/src/local-control-plane/index.ts` [production, observe-only by flags] | `LOCAL_CONTROL_PLANE_REPORT_KINDS = ["context","model_router","capability","evidence","mission"]` is a closed MVP set — do not extend it for this feature |
| `openclaw_runtime/src/security-verification-shadow/index.ts` [shadow] | Shadow vocabulary exemplar: `SecurityShadowDecision = "allow"\|"warn"\|"would_require_approval"\|"would_block"`, bounded in-memory records, read-only gateway methods |
| `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` [shadow] | `RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY = true` constant pattern |
| `openclaw_runtime/src/infra/exec-approvals.ts` [production, partial read] | Runtime-side `ExecHost = "sandbox"\|"gateway"\|"node"\|"verseshell"`, `ExecSecurity = "deny"\|"allowlist"\|"full"`, `ExecAsk = "off"\|"on-miss"\|"always"` — note the ask vocabulary differs from Electron-side `SandboxExecPolicy.ask` (`'always'\|'dangerous'\|'off'`); mapping happens at config-write time |
| `openclaw_runtime/src/plugins/AGENTS.md`, `plugins/hook-types.ts` [production] | Plugins load **in-process**; isolation between plugin tools is policy-level (before_tool_call + `plugin.approval.*` + trusted-tool-policy), not process-level. `PluginHookToolKind = "code_mode_exec"` |
| `docs/clawx-design-overview.md` §1.2, §7, §7.1, §8.4.1, §12.2 | Non-goals and the promotion rule (quoted in Gap Analysis) |

**Path correction.** The brief stated `openclaw_runtime/src/acp/control-plane/spawn.ts`
holds "worktree isolation mechanics for spawned sessions". It does not: it contains only
`cleanupFailedAcpSpawn` / `AcpSpawnRuntimeCloseHandle` (best-effort teardown of failed ACP
spawns). A repo-wide Grep for `worktree` found no runtime worktree layer (only unrelated
hits in `skills/lifecycle/source-install.ts`, `infra/update-runner.ts`,
`agents/sessions/footer-data-provider.ts`). The actual "isolated copy of the workspace"
mechanic in the runtime is the **sandbox workspace layout**:
`agents/sandbox/context.ts` (`ensureSandboxWorkspaceLayout`) + `agents/sandbox/workspace.ts`
(`ensureSandboxWorkspace`) + `agents/sandbox/shared.ts` (`resolveSandboxWorkspaceDir`,
scope keys `'session' | 'agent' | 'shared'`). This design extends that mechanic (Section 3.4)
instead of the nonexistent worktree layer.

**Non-goals identified** (respected throughout; sources quoted in Gap Analysis):
layers share no in-process state (§1.2); policy-light is not a container/VM claim (§12.2);
LCP MVP forbids "automatic Skill/MCP enablement, isolation promotion, or permission
escalation" and "default eBPF/cgroup resource control" (§8.4.1); observe→active promotion
requires a fresh spec + separate flag + flag-off parity + rollback (§8.4.1 promotion rule).

---

## 1. Gap Analysis

**What the existing system CAN do.**

- *Workspace-level effective policy, resolved once.* `electron/utils/sandbox-policy-resolver.ts`
  [production] computes one `SandboxEffectivePolicy` per workspace from permission mode ×
  requested provider × detected providers, with honest degradation
  (`degraded: true`, `degradeReason`, fallback to `policy-light`).
  `electron/services/workspace-runtime-sync.ts` [production] persists the result into
  OpenClaw config (`agents.defaults.sandbox.mode/backend/scope/workspaceAccess`,
  `tools.exec.host/security/ask`) for the next Gateway start.
- *Per-invocation policy gating (non-spatial).* `runBeforeToolCallHook` in
  `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts` [production] already runs a
  per-tool-call chain: loop detection → destructive-operation guard preflight [pilot] →
  skill-workshop approval → trusted tool policies → plugin hooks → plugin approvals. It can
  block (`HookBlockedReason` one of `"plugin-before-tool-call" | "plugin-approval" |
  "tool-loop" | "destructive-operation-guard"`) and it fails closed when the hook chain throws.
- *Per-invocation exec approvals.* `bash-tools.exec-approval-request.ts` [production] runs
  a two-phase gateway approval per exec with per-request `security`/`ask`.
- *Risk classification prior art.* `classifyAcpToolApproval`
  (`openclaw_runtime/src/acp/approval-classifier.ts` [production]) buckets ACP tool calls
  into `AcpApprovalClass`; `isMutatingToolCall`/`extractFileTarget`
  (`openclaw_runtime/src/agents/tool-mutation.ts` [production]) classify mutation and file
  targets; `classifyWorkspaceCommand`/`classifyGatewayRpcRisk`
  (`electron/services/workspace-permissions.ts` [production]) classify Main-side risk as
  `'read' | 'write' | 'network' | 'destructive' | 'external-write'`.
- *Session-scoped filesystem isolation, when a strong provider is on.* When
  `agents.defaults.sandbox.mode !== 'off'`, `resolveSandboxContext`
  (`openclaw_runtime/src/agents/sandbox/context.ts` [production]) provisions a scope-keyed
  copied workspace (`resolveSandboxWorkspaceDir`), a backend (docker/ssh/openshell), and a
  `SandboxFsBridge`.
- *Shadow/pilot machinery.* `security-verification-shadow/index.ts` [shadow] records
  "would_*" decisions without acting; the destructive-operation guard [pilot] shows the
  promotion shape (flag path, owner, default-off, enumerated allow reasons).

**What it CANNOT do (the precise gap).**

1. *Isolation tier is frozen at config time, per workspace.* Every tool call in every turn
   runs at the same `SandboxRuntimeLevel`. A turn that only reads files carries the same
   posture as a turn running `npm install`; escalating one risky action means reconfiguring
   the whole workspace and restarting the Gateway (config sync is explicitly
   "for the next Gateway start", `electron/services/workspace-runtime-sync.ts`).
2. *No per-turn undo under policy-light.* The default `policy-light` writes
   `agents.defaults.sandbox.mode = 'off'` — no sandbox context, no copied workspace, no
   before-images. A single approved-but-wrong `edit`/`write` has no mechanical rollback;
   recovery is git hygiene or nothing.
3. *No spatial escalation ladder.* The gap between "policy gates only" and "docker-strong"
   is binary. There is nothing between approval prompts and a full container.
4. *Network policy is workspace-static.* `SandboxNetworkPolicy` lives in the profile and the
   resolver output; a turn classified as risky cannot be tightened from `enabled` to
   `approvalRequired` for just that turn.
5. *No decision record.* Nothing records "this action would have warranted journal/copy/
   container isolation" against actual approval outcomes, so there is no evidence base for
   ever enabling per-turn behavior.

**Why the gap matters for a personal agent platform.** This is a single-developer,
local-machine, educational app. Docker is optional and often absent; the honest default is
policy gates. For that user the highest-value protection is not stronger walls but *cheap,
per-action reversibility and proportionate friction*: read-only turns should be frictionless,
file-mutating turns should be undoable in one step, and the rare `exec`-heavy turn should be
offered (not forced into) a copied workspace or container. That is exactly a per-turn
tighten-only ladder over the existing floor.

**Non-goals respected** (quoted):

- §1.2: "The two layers share no in-process state; they are independent processes that
  happen to live in one repo." → the broker is runtime-side and consumes the resolver's
  output shipped as config; no per-tool-call IPC to Main.
- §12.2: "`policy-light` is a control-plane sandbox, not a container, VM, or
  kernel-equivalent isolation boundary." → the Turn FS Journal is presented as a *recovery/
  undo* layer, never as an isolation claim; resolver warning strings stay intact.
- §8.4.1 MVP non-goals: "no automatic Skill/MCP enablement, isolation promotion, or
  permission escalation" and "no default eBPF/cgroup resource control" → the shadow phase
  records only; nothing auto-promotes; no OS resource control is introduced. The active
  phase follows the §8.4.1 promotion rule (fresh spec, separate flag, flag-off parity,
  rollback) — restated in Section 6.
- §1.2 ClawGraph note: ClawGraph "is not ... a replacement for ... sandbox policy" → the
  broker likewise does not replace sandbox policy; it evaluates *within* the resolver's floor.

---

## 2. Architecture Overview

```
ELECTRON MAIN (policy truth)                      OPENCLAW RUNTIME (enforcement point)
==============================                    ==========================================

[EXISTING] workspace-permissions.ts
   WorkspaceCommandRisk, SAFE_GATEWAY_METHODS
        |
[EXISTING] sandbox-provider-detection.ts
   detectSandboxProviderSnapshot (15s TTL)
        |
        v
[EXISTING] sandbox-policy-resolver.ts ----+
   resolveSandboxEffectivePolicy()        |
        |                                 |
   [NEW additive fn]                      |
   resolveTurnIsolationFloor(policy)      |
        |                                 |
        v                                 v
[EXISTING] workspace-runtime-permissions.ts
   applyWorkspaceSandboxConfig(+ floor block)
        |
        v                       (persisted OpenClaw config: agents.defaults.sandbox.*,
[EXISTING] workspace-runtime-sync.ts      tools.exec.*,  [NEW] ...sandbox.turnIsolation.floor)
        |                                              |
        |  config write, next Gateway start            v
        +---------------------------------->  [EXISTING] HookContext.config
                                                       |
                                              [EXISTING] agent-tools.before-tool-call.ts
                                                 runBeforeToolCallHook()
                                                   1 loop detection
                                                   2 destructive-op guard   [pilot]
                                                   3 ---> [NEW] TurnIsolationBroker
                                                   4 skill-workshop approval
                                                   5 trusted policies / plugin hooks
                                                       |
                                        +--------------+----------------+
                                        | decision (tighten-only)       |
                                        v                               v
                              [NEW] TurnFsJournal            [NEW] escalation adapters
                                before-images of              fs: 'workspace-copy' reuses
                                FileTarget writes;               [EXISTING] sandbox/context.ts
                                rollback/commit                  + workspace.ts + shared.ts
                                under SANDBOX_STATE_DIR        fs: 'container' requires
                                        |                        [EXISTING] docker-strong
                                        |                      net: ExecAsk tighten via
                                        |                        [EXISTING] bash-tools.
                                        |                        exec-approval-request.ts
                                        v
                              [NEW] bounded shadow/decision records (in-memory ring)
                                        |
                                        |  read-only gateway method (pilot+)
                                        v
[EXISTING] sandbox-api.ts  <---  sandbox.turnIsolation.records
   status/detectProviders/updateProfile/explain
   [NEW] explainTurn  (mirrors explain; simulates floor x action -> decision)
        |
        v
[EXISTING] renderer permission panel / Settings (read-only inspection)
```

Data flows left-to-right at config time, right-to-left only through read-only inspection.
No new process, no sidecar, no schema change: the floor block and flags are optional config
keys; records are in-memory (shadow) plus self-contained journal files on disk.

---

## 3. Component Specifications

### 3.1 `resolveTurnIsolationFloor` — additive pure function (Electron Main)

**Responsibility.** Keep `electron/utils/sandbox-policy-resolver.ts` the single source of
policy truth by deriving, from an already-resolved `SandboxEffectivePolicy`, the compact
floor that per-turn decisions must never go below. Chosen over a per-call RPC because at
tool-call time the runtime has `HookContext.config` (see `HookContext` in
`openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`) but no channel to Main —
and §1.2 forbids sharing in-process state. The floor rides the existing config-sync path
(`applyWorkspaceSandboxConfig` → `workspace-runtime-sync.ts`).

```ts
// additive exports in shared/types/sandbox.ts
export type SandboxTurnFsTier = 'none' | 'journal' | 'workspace-copy' | 'container';

export interface SandboxTurnIsolationFloor {
  runtimeLevel: SandboxRuntimeLevel;          // existing enum, verbatim
  effectiveProviderId: SandboxProviderId;     // existing enum, verbatim
  networkPolicy: SandboxNetworkPolicy;        // existing enum, verbatim
  minFsTier: SandboxTurnFsTier;               // 'none' for policy/light; 'container' when strong
}

// additive export in electron/utils/sandbox-policy-resolver.ts
export function resolveTurnIsolationFloor(
  policy: SandboxEffectivePolicy,
): SandboxTurnIsolationFloor;
```

Mapping is total and boring by design: `runtimeLevel 'strong'` → `minFsTier: 'container'`;
`'policy' | 'light'` → `minFsTier: 'none'`. `networkPolicy` is copied verbatim (today it is
resolver-side only; this is the one genuinely new fact shipped to the runtime).

**State.** None (pure). **Lifecycle.** Called wherever `resolveSandboxEffectivePolicy` is
already called for config sync. **Errors.** Cannot fail; total function over closed enums.

### 3.2 `TurnIsolationBroker` — runtime-side evaluator (NEW, shadow-first)

**Responsibility.** For each pending tool invocation, compute a
`SandboxTurnIsolationDecision` from (floor × action risk context × availability ×
optional tighten-only override), record it, and — only at pilot/active maturity — enforce
it. Lives at `openclaw_runtime/src/runtime-core/turn-isolation-broker-shadow.ts` (shadow
phase), following the naming lineage of `failure-intelligence-passive-shadow.ts` [shadow]
and the destructive-operation guard [pilot].

**Risk context: composition, not a new taxonomy.** The broker does not invent classifiers;
it *composes* the existing ones into one record:

```ts
// runtime-side (broker module); names drawn verbatim from existing modules
export type SandboxActionRiskClass =
  | AcpApprovalClass                    // "readonly_scoped" | "readonly_search" | "mutating"
                                        // | "exec_capable" | "control_plane" | "interactive"
                                        // | "other" | "unknown"  (acp/approval-classifier.ts)
  ;                                     // no new members in v1 — extension point reserved

export interface SandboxActionContext {
  toolName: string;                       // normalized via agents/tool-policy.ts normalizeToolName
  riskClass: SandboxActionRiskClass;      // from classifyAcpToolApproval (fails closed → "unknown")
  mutating: boolean;                      // tool-mutation.ts isMutatingToolCall(toolName, params)
  fileTargets: FileTarget[];              // tool-mutation.ts extractFileTarget + derivedPaths
                                          // from plugins/host-tool-param-parsers.ts deriveToolParams
  toolKind?: PluginHookToolKind;          // "code_mode_exec" (plugins/hook-types.ts)
  sessionKey?: string; runId?: string; toolCallId?: string;
}

export interface SandboxTurnIsolationDecision {
  fsTier: SandboxTurnFsTier;              // >= floor.minFsTier  (tighten-only invariant)
  networkPolicy: SandboxNetworkPolicy;    // <= floor.networkPolicy in permissiveness
  execAskOverride?: ExecAsk;              // only ever toward "always" (infra/exec-approvals.ts)
  wouldDecision:                          // shadow vocabulary, SecurityShadowDecision lineage
    | 'allow' | 'would_journal' | 'would_copy' | 'would_container' | 'would_tighten_network';
  floorRespected: true;                   // structurally always true; recorded for audit
  reasonCodes: string[];                  // bounded, sanitized (pilot sanitizeRef precedent)
}
```

Decision table (v1, deliberately small):

| riskClass × mutation | fs tier (max with floor) | network tighten |
|---|---|---|
| `readonly_scoped`, `readonly_search` | `none` | none |
| `mutating` with `fileTargets` (`edit`/`write`/`apply_patch`) | `journal` | none |
| `exec_capable`, mutating `exec`/`bash` | `workspace-copy` *recommended*; enforcement stays with existing exec approvals in pilot | `enabled` → `approvalRequired` (as `execAskOverride: "always"`) |
| `control_plane`, `unknown`, spoofed identity | no fs change; defer to existing approval gates | `enabled` → `approvalRequired` |
| any, when floor `runtimeLevel === 'strong'` | `container` (already at max; no-op) | keep `docker.network: 'none'` |

**Insertion point.** Inside `runBeforeToolCallHook`
(`openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`), immediately after the
destructive-operation guard evaluation and before skill-workshop approval — the exact slot
where `evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent` already
runs. Shadow phase: compute + record, return nothing that alters the `HookOutcome`. Pilot
phase: may return a block/require-provision outcome with new additive
`HookBlockedReason: "turn-isolation"`.

**Config gating** (pilot-pattern constants, mirroring
`RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH`):

```ts
export const RUNTIME_SANDBOX_TURN_ISOLATION_SHADOW_FLAG_PATH =
  "runtime.toolGovernance.turnIsolation.shadow.enabled";       // default off
export const RUNTIME_SANDBOX_TURN_ISOLATION_PREFLIGHT_FLAG_PATH =
  "runtime.toolGovernance.turnIsolation.preflight.enabled";    // default off, pilot only
export const RUNTIME_SANDBOX_TURN_ISOLATION_ADVISORY_ONLY = true; // shadow module constant
export const RUNTIME_SANDBOX_TURN_ISOLATION_PREFLIGHT_OWNER =
  "file_mutation_turn_journal_preflight";                      // single allowed owner in pilot
```

The floor is read from `agents.defaults.sandbox.turnIsolation.floor` (written by Main,
Section 3.1); absence of the block means "no floor shipped" and the broker treats the floor
as `{ runtimeLevel: 'policy', networkPolicy: 'disabled', minFsTier: 'none' }` *for recording
only* and refuses to enforce (allow-reason `floor_missing`) — fail-open in shadow, fail-safe
(no enforcement without an explicit floor) in pilot.

**Internal state.** Owns: a bounded in-memory decision ring buffer (size 256, eviction like
`adjustedParamsByToolCallId`'s `MAX_TRACKED_ADJUSTED_PARAMS` precedent) and its counters.
Delegates: classification (approval-classifier, tool-mutation), journaling (`TurnFsJournal`),
provisioning (sandbox context machinery), approvals (existing exec/plugin approval flows).

**Lifecycle.** Module-scoped like the destructive guard: pure evaluation functions plus a
module-local record store; no daemon, no timers. Records die with the process (LCP §8.4.1
"no durable report index" — respected).

**Error handling.** Evaluation is wrapped so a broker bug can never take down a tool call in
shadow (catch → record `severity: 'error'`, allow). In pilot, evaluation errors follow the
existing chain's fail-closed catch in `runBeforeToolCallHook` (blocked, `kind: "failure"`).
Enumerated allow reasons (pilot pattern): `"flag_disabled" | "owner_not_preflight" |
"floor_missing" | "not_file_mutating" | "journal_unnecessary" | "already_at_or_above_tier"`.

### 3.3 `TurnFsJournal` — fast reset without containers (NEW)

**Responsibility.** Provide a per-turn filesystem undo under the `policy-light` default:
capture before-images of files a turn's file-mutating tool calls are about to touch, then
`commit` (prune) or `rollback` (restore) at turn end. This is a *recovery* mechanism inside
the Node.js process — explicitly **not** an isolation boundary (§12.2 wording preserved;
the resolver's warning "Policy-light mode relies on Verse Claw/Main permissions and
approvals; it is not a container or VM sandbox." stays untouched).

```ts
export interface TurnFsJournalEntry {
  toolCallId?: string;
  target: FileTarget;                       // tool-mutation.ts type, verbatim
  beforeImagePath?: string;                 // absent => file did not exist (creation)
  capturedAtMs: number;
  bytes: number;
  truncated: boolean;                       // beyond maxFileBytes: recorded, not captured
}

export interface TurnFsJournal {
  readonly turnKey: string;                 // `${sessionKey}:${runId}` slugified via
                                            // sandbox/shared.ts slugifySessionKey
  capture(params: { toolCallId?: string; targets: FileTarget[]; cwd: string;
                    bridge?: SandboxFsBridge }): Promise<{ ok: true } | { ok: false; reason: string }>;
  rollback(): Promise<{ restored: number; failed: TurnFsJournalEntry[] }>;
  commit(): Promise<void>;                  // prune before-images, close manifest
}
```

**Mechanics.** Capture happens at the same pre-execution moment where
`recordAdjustedParamsForToolCall` runs in `wrapToolWithBeforeToolCallHook`: resolve each
`FileTarget.path`/`oldpath` against `HookContext.cwd`/`workspaceDir` (reusing the
resolution idiom of `resolveRelativeToolPath` in that file), copy the current bytes to
`SANDBOX_STATE_DIR/turn-journal/<turnKey>/<n>.before` (constant from
`agents/sandbox/constants.ts`), and append one line to a `manifest.jsonl`. When the session
runs sandboxed (`HookContext.sandbox` present), reads/writes go through the existing
`SandboxFsBridge` (`readFile`/`writeFile`/`stat`); otherwise host `fs`. Rollback restores in
reverse capture order; creations are removed via `remove` semantics.

**Honest coverage boundary (load-bearing).** The journal covers exactly the targets the
existing extractors can name: `FILE_MUTATING_TOOL_NAMES` (`edit`, `write`) via
`extractFileTarget`, plus `apply_patch` via `derivedPaths` from `deriveToolParams`. It does
**not** cover arbitrary `exec`/`bash` side effects — which is precisely why the decision
table routes `exec_capable` to approvals/workspace-copy rather than pretending journal
coverage. Files above `maxFileBytes` (default 8 MiB) are recorded as `truncated: true` and
the broker treats the capture as failed for enforcement purposes.

**State.** Owns its directory and manifest per turn. Retention: journal dirs older than the
existing `DEFAULT_SANDBOX_MAX_AGE_DAYS = 7` lineage are pruned by the same opportunistic
sweep pattern as `agents/sandbox/prune.ts` (`maybePruneSandboxes` precedent). Delegates path
safety to the resolution idioms above; never writes outside its own directory.

**Lifecycle.** Created lazily on the first `journal`-tier decision of a turn; closed by
`commit` (default on normal turn end) or `rollback` (user action from the permission panel,
or supervisor request per sibling doc 03). Crash mid-turn: on next start, an incomplete
manifest is surfaced through the inspection surface as "restorable turn journal" — never
auto-restored (fail-closed means block-then-ask, not act-silently).

**Errors.** `capture` failure in pilot ⇒ the broker blocks the tool call
(`deniedReason: "turn-isolation"`, via the existing `buildBlockedToolResult`) — fail-closed.
`rollback` partial failure returns the failed entries, keeps their before-images on disk,
and emits a diagnostic through the existing `emitTrustedDiagnosticEvent` channel
(`tool.execution.blocked` / error events already exist in this file; the journal adds
payload-free reason codes only).

### 3.4 Turn-scoped workspace-copy escalation (adapter over EXISTING mechanics)

**Responsibility.** For `fsTier: 'workspace-copy'`, provision an isolated copied workspace
for the remainder of the turn by reusing the production sandbox workspace machinery — not a
new worktree layer. Concretely: `resolveSandboxScopeKey` today accepts
`'session' | 'agent' | 'shared'`; the adapter derives a turn scope key by passing the
composite `${sessionKey}#turn:${runId}` string through the **existing** session-scope path
(`resolveSandboxWorkspaceDir(workspaceRoot, scopeKey)` + `ensureSandboxWorkspace(dir,
seedFrom)`), so no signature change is required. Registry rows reuse `updateRegistry`
(`agents/sandbox/registry.ts` [production]) so `prune.ts` retention applies automatically.

`fsTier: 'container'` is not new machinery at all: it is only reachable when the workspace
floor is already `docker-strong` (detected via `SandboxDockerAvailability.cli && daemon &&
image`) — the broker never provisions containers on its own. On a `policy-light` floor the
ladder tops out at `workspace-copy`; that *is* the graceful degradation demanded by the
no-container-dependency constraint.

**Errors.** Provisioning failure (copy fails, docker daemon vanished mid-turn) ⇒ fail-closed
block of the triggering call with `reasonCodes: ["provision_failed"]`; **never** a silent
downgrade to a lower tier. The user's recovery choices are: retry, approve running at the
floor tier via the normal approval prompt, or abandon the action. This inverts the
resolver's workspace-level degrade-and-continue semantics deliberately — a per-turn
escalation was *demanded* by risk, so its absence must not be papered over.

### 3.5 Per-turn network tighten map (rule inside the broker, enforcement via EXISTING flows)

Mapping over `SandboxNetworkPolicy`, tighten-only:

| floor | risk-tightened result | mechanism |
|---|---|---|
| `enabled` | `approvalRequired` for `exec_capable`/network-risk actions | `execAskOverride: "always"` carried into the existing per-request `ask` of `RequestExecApprovalDecisionParams` (`bash-tools.exec-approval-request.ts`) |
| `approvalRequired` | `approvalRequired` (idempotent) or `disabled` for `destructive`-classified network actions | same; or plain block |
| `disabled` | `disabled` | nothing to do |

The reverse direction is unrepresentable: the decision type has no member that widens
`networkPolicy`, and the broker clamps with `max(floor, decision)` semantics before
recording. Docker-tier turns keep the existing `docker.network: 'none'` written by
`mapWorkspacePermissionToSandboxConfig`; `getBlockedNetworkModeReason`
(`agents/sandbox/network-mode.ts`) continues to reject `host`/`container:` joins unchanged.

### 3.6 `sandbox.explainTurn` — inspection surface (Electron Main, NEW method)

**Responsibility.** Mirror the existing `explain` in `electron/services/sandbox-api.ts`:
given a hypothetical or recorded action context, show floor, decision, tier ladder position,
and reason codes — using the same `SandboxExplanation` / `SandboxExplainItem` shapes
(`tone: 'neutral' | 'success' | 'warning' | 'danger'`) so the renderer needs no new
rendering primitives.

```ts
// additive to the sandbox block of shared/host-api/contract.ts (today: status /
// detectProviders / updateProfile / explain)
explainTurn: (payload: {
  action?: { toolName: string; mutating?: boolean; riskClass?: string };
  turnKey?: string;                      // fetch recorded decisions instead of simulating
}) => SandboxExplainTurnResult;          // { success, floor, decision?, records?, explanation }
```

Simulation mode is pure Main-side (re-runs `resolveTurnIsolationFloor` + a mirrored copy of
the v1 decision table — acceptable duplication because the table is data, versioned by a
shared `TURN_ISOLATION_DECISION_TABLE_VERSION` string asserted equal in tests). Record mode
(pilot+) reads the runtime's read-only gateway method `sandbox.turnIsolation.records`,
which must be added to `SAFE_GATEWAY_METHODS` in `electron/services/workspace-permissions.ts`
(read-only, side-effect free — same justification as the existing
`security.intercepts.list` entry).

**`SandboxTurnOverride` (user-initiated tighten).** Additive shared type for the one
override direction that is safe:

```ts
export interface SandboxTurnOverride {
  scope: 'turn';
  requestedFsTier?: SandboxTurnFsTier;            // clamped to >= decision tier
  requestedNetworkPolicy?: SandboxNetworkPolicy;  // clamped to tighter-or-equal
  reason?: string;
}
```

It travels as chat-send metadata, which §7 already defines as untrusted request metadata
that "cannot grant tools, bypass approvals, ... or change workspace permission mode" — a
tighten-only override is compatible because it can only *remove* capability. The broker
validates the clamp; a widening override is ignored and recorded (`reasonCodes:
["override_rejected_widening"]`).

---

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `electron/utils/sandbox-policy-resolver.ts` [production] | Additive: export `resolveTurnIsolationFloor()`; no change to `resolveSandboxEffectivePolicy` | Keeps the file the single source of policy truth; pure function over its existing output |
| `shared/types/sandbox.ts` [production] | Additive types: `SandboxTurnFsTier`, `SandboxTurnIsolationFloor`, `SandboxTurnOverride`, `SandboxActionRiskClass` (string union mirror), explain-turn result types | Contract home for Electron/renderer; runtime keeps its own mirrored types (layers share no code) |
| `electron/utils/workspace-runtime-permissions.ts` [production] | Additive: `applyWorkspaceSandboxConfig` also writes optional `agents.defaults.sandbox.turnIsolation.floor` block when the feature flag is set in the profile | Only existing config-write path; absent block = feature entirely dormant |
| `electron/services/workspace-runtime-sync.ts` [production] | None | Already ships whatever `applyWorkspaceSandboxConfig` produces |
| `electron/services/sandbox-api.ts` [production] | Additive: `explainTurn` method beside `explain`; no change to `status`/`detectProviders`/`updateProfile` | Mirrors the existing explain surface for per-turn inspection |
| `shared/host-api/contract.ts` [production, >20KB] | Additive only: one optional method in the existing `sandbox` service block (today `status`/`detectProviders`/`updateProfile`/`explain`) | Contract file is large; a single appended method signature is the entire diff — argued additive, never a rewrite |
| `electron/services/workspace-permissions.ts` [production] | Additive: one `SAFE_GATEWAY_METHODS` entry `sandbox.turnIsolation.records` (pilot phase) | Read-only, side-effect-free method; same category as `security.intercepts.list` |
| `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts` [production, ~46KB] | Additive: one evaluation call in `runBeforeToolCallHook` at the destructive-guard slot; one new member `"turn-isolation"` in the `HookBlockedReason` union; journal capture hook beside `recordAdjustedParamsForToolCall` | The file already hosts the pilot-evaluation precedent at exactly this slot; changes are one call + one union member + one capture call — argued additive against the >20KB rule |
| `openclaw_runtime/src/acp/approval-classifier.ts` [production] | None (consumed as-is via `classifyAcpToolApproval`) | Risk vocabulary reused verbatim; extending members is a future option, not needed for v1 |
| `openclaw_runtime/src/agents/tool-mutation.ts` [production] | None (consumed: `isMutatingToolCall`, `extractFileTarget`, `FileTarget`) | Existing mutation classification is sufficient |
| `openclaw_runtime/src/agents/sandbox/context.ts` / `workspace.ts` / `shared.ts` / `registry.ts` / `prune.ts` [production] | None (workspace-copy adapter composes their exported functions with a turn-scoped key string) | The "worktree-like" mechanic already exists; reuse beats a parallel layer |
| `openclaw_runtime/src/agents/bash-tools.exec-approval-request.ts` [production] | None (per-request `ask` is already a parameter; the exec caller passes the override) | Network tightening rides the existing two-phase approval |
| `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts` [pilot] | None | Pattern exemplar only; the broker copies its shape, not its code |
| `openclaw_runtime/src/local-control-plane/**` [production, observe-only] | None | `LOCAL_CONTROL_PLANE_REPORT_KINDS` is a closed MVP set; the broker keeps its own bounded records instead (security-verification-shadow precedent) |
| `openclaw_runtime/src/gateway/server-methods/**` [production] | Additive (pilot phase): read-only `sandbox.turnIsolation.records` handler, modeled on `security-verification-shadow.ts` | Inspection without mutation; gated by the same flag as the broker |
| NEW `openclaw_runtime/src/runtime-core/turn-isolation-broker-shadow.ts` | New module (shadow), later joined by `...-preflight-pilot.ts` | Follows shadow/pilot file lineage and keeps runtime-core ownership beside its exemplars |
| NEW `openclaw_runtime/src/agents/turn-fs-journal.ts` | New module | Journal mechanics live beside the tool layer that produces `FileTarget`s |

---

## 5. Data Flow

Scenario: workspace on the default `policy-light` floor (`permissionMode: 'acceptEdits'`),
pilot flag on, agent turn asks to `edit` `src/lib/host-api.ts` and then run `npm install`.

1. **Config time (Main).** `resolveActiveSandboxPolicyForMode('acceptEdits')`
   (`electron/services/sandbox-api.ts`) → `resolveSandboxEffectivePolicy` returns
   `effectiveProviderId: 'policy-light'`, `runtimeLevel: 'policy'`,
   `networkPolicy: 'approvalRequired'` (profile default). NEW `resolveTurnIsolationFloor`
   derives `{ runtimeLevel: 'policy', networkPolicy: 'approvalRequired', minFsTier: 'none' }`;
   `applyWorkspaceSandboxConfig` (`electron/utils/workspace-runtime-permissions.ts`) writes
   it under `agents.defaults.sandbox.turnIsolation.floor`;
   `syncActiveWorkspacePermissionToRuntime` (`electron/services/workspace-runtime-sync.ts`)
   persists the config for the next Gateway start.
2. **Tool call 1: `edit`.** The wrapped tool (`wrapToolWithBeforeToolCallHook`,
   `openclaw_runtime/src/agents/agent-tools.before-tool-call.ts`) enters
   `runBeforeToolCallHook`. Loop detection passes; the destructive-operation guard [pilot]
   returns `action: "allow"` (`reason: "candidate_missing"`). The NEW `TurnIsolationBroker`
   reads the floor from `HookContext.config`, composes the action context —
   `classifyAcpToolApproval` → `approvalClass: "mutating"`; `isMutatingToolCall("edit", …)` →
   `true`; `extractFileTarget` → `{ path: "src/lib/host-api.ts" }` — and decides
   `{ fsTier: 'journal', wouldDecision: 'would_journal' }`.
3. **Journal capture.** At the pre-execution point beside
   `recordAdjustedParamsForToolCall`, NEW `TurnFsJournal.capture` resolves the target
   against `HookContext.workspaceDir`, copies the current bytes to
   `SANDBOX_STATE_DIR/turn-journal/<turnKey>/0001.before`
   (`SANDBOX_STATE_DIR` from `agents/sandbox/constants.ts`), appends to `manifest.jsonl`.
   Capture ok → the hook chain continues (skill-workshop approval, trusted policies, plugin
   hooks — all unchanged) → `execute` runs the edit → `tool.execution.completed` diagnostic
   as today.
4. **Tool call 2: `npm install` via `exec`.** Broker composes: `approvalClass:
   "exec_capable"` (from `EXEC_CAPABLE_TOOL_IDS` in `acp/approval-classifier.ts`),
   `isMutatingToolCall("exec", …)` → `true` (not in `READ_ONLY_SHELL_COMMANDS`). Decision:
   `fsTier: 'workspace-copy'` *recommended* (pilot enforces journal tier only, so this
   records `wouldDecision: 'would_copy'`), plus network tighten `execAskOverride: "always"`.
   The exec path proceeds through the existing two-phase approval —
   `registerExecApprovalRequest` → `waitForExecApprovalDecision`
   (`bash-tools.exec-approval-request.ts`) — with `ask: "always"` instead of the floor's
   `"on-miss"`-equivalent, so the user is prompted even though `acceptEdits` +
   `security: 'allowlist'` might have auto-passed. (Main-side, the same command class is
   independently gated by `classifyWorkspaceCommand` → `'network'` → approval — two layers,
   unchanged.)
5. **Failure branch.** Suppose `capture` in step 3 had failed (disk full). Pilot behavior:
   broker returns blocked, `HookOutcome { blocked: true, kind: "veto", deniedReason:
   "turn-isolation" }` → `buildBlockedToolResult` → `tool.execution.blocked` diagnostic →
   the renderer permission panel shows the block; the turn continues (the model sees the
   blocked tool result), and `explainTurn` shows `reasonCodes: ["journal_capture_failed"]`.
   Nothing executed, nothing to roll back — fail-closed.
6. **Turn end.** User inspects the diff, dislikes it, clicks "Roll back turn" (renderer →
   `sandbox.explainTurn` record view → rollback action routes as a normal gated request).
   `TurnFsJournal.rollback` restores `0001.before` over `src/lib/host-api.ts` in reverse
   order and reports `{ restored: 1, failed: [] }`. Otherwise `commit` prunes the journal
   dir. Shadow records of both decisions remain in the ring buffer for the comparison
   telemetry (Section 6) until process exit.

---

## 6. Migration Path

Follows the pilot pattern (this codebase's law) and the §8.4.1 promotion rule: "any future
move from observe-only to active behavior must use a separate harness task …, add a separate
active feature flag, prove flag-off parity, define rollback, and run communication checks
when Gateway/Main/host-api surfaces change."

**Phase 0 — dormant (ships with types only).** Shared types + `resolveTurnIsolationFloor`
exist; no config block written; broker module absent from the hook path. Behavior identical
to today by construction.

**Phase 1 — shadow (records, never acts).**
- Fresh spec: `harness/specs/tasks/turn-isolation-shadow.md` (per §10.1 spec-driven rule).
- Flag: `runtime.toolGovernance.turnIsolation.shadow.enabled` — default **off**; enabling
  is an explicit operator action in config.
- Broker computes decisions, writes the bounded ring buffer, sets
  `RUNTIME_SANDBOX_TURN_ISOLATION_ADVISORY_ONLY = true`, and **must not** journal, provision,
  tighten, or block. `TurnFsJournal` is not instantiated in this phase.
- Telemetry collected (in-memory + optional payload-free trace events, the
  `local_control_plane.report` projection style with `payloadOmitted=true`):
  per-decision `{ wouldDecision, riskClass, mutating, floor.runtimeLevel, evaluation
  duration µs }`; joined post-hoc against actual outcomes already observable in the chain —
  `HookOutcome.approvalResolution` (`PluginApprovalResolutions`), exec approval decisions,
  `tool.execution.blocked/completed/error` diagnostics.
- Parity proof: unit tests assert byte-identical `HookOutcome` for flag-on vs flag-off
  across the existing before-tool-call test corpus (destructive-guard precedent:
  `legacyBehavior` assertions).

**Phase 2 — pilot (journal tier only).**
- Fresh spec + separate flag `runtime.toolGovernance.turnIsolation.preflight.enabled`
  (shadow flag stays independent); single `allowedOwner =
  "file_mutation_turn_journal_preflight"`; required boundaries: enforcement limited to
  `fsTier: 'journal'` on `FILE_MUTATING_TOOL_NAMES` + `apply_patch`; `workspace-copy` and
  network tighten remain record-only; `container` remains floor-driven only.
- Gateway read-only `sandbox.turnIsolation.records` + Main `explainTurn` land here →
  communication checks required (host-api/gateway surface change per the promotion rule).
- **Promotion gates (shadow → pilot), measured over ≥ 200 mutating invocations of normal
  personal use:**
  - false-escalation rate < 5% (decision said `would_journal`/`would_copy` but the action
    was approved and produced no `tool.execution.error`, no user rollback, no
    destructive-guard candidate);
  - missed-mutation rate < 1% (file actually changed — post-hoc `stat` mtime/size diff —
    with no journal-tier decision);
  - decision overhead p95 < 1 ms per call; journal capture p95 < 25 ms per file ≤ 8 MiB
    (budget: invisible inside existing approval latencies).
- **Rollback plan: disable-only.** Setting the flag off restores the `flag_disabled` allow
  path (`legacyBehavior: true`) — zero residue except inert journal directories under
  `SANDBOX_STATE_DIR/turn-journal/`, which are plain files, prunable by the existing
  retention sweep or manual deletion. **No schema change** anywhere: config keys optional,
  union member additive, no store/database migration, gateway method additive.

**Phase 3 — active (escalation ladder + network tighten).** Gated on pilot evidence
(journal rollback actually used and correct; zero tighten-only violations in records — a
structural invariant test, not just telemetry). Expands owner boundaries one tier at a time
(`workspace-copy` first, `execAskOverride` second), each behind the same flag with the same
disable-only rollback. `container` enforcement is *never* broker-initiated; it remains
"floor is docker-strong" only.

---

## 7. Design Decisions

**D1. Runtime-side evaluator consuming resolver output via config — not a per-call RPC, not
a Main-side broker.** At tool-call time the only policy-bearing object in scope is
`HookContext.config` (`runBeforeToolCallHook`); Main is a different process and §1.2 forbids
shared state; live per-call RPC to Main would add a synchronous cross-process hop to every
tool call and a new failure mode. *Alternative rejected:* pure-Main enforcement (Main
already gates files/terminal/gateway) — rejected because Main never sees runtime-internal
tool calls (`edit` on the runtime side, plugin tools, sandboxed sessions); the interception
point with full context is `runBeforeToolCallHook`. *Alternative rejected:* per-call
gateway RPC for floor lookup — the floor changes only when Main rewrites config, so shipping
it once via `applyWorkspaceSandboxConfig` is strictly better.

**D2. Tighten-only as a type-level invariant, not a runtime check alone.** The decision type
has no representation for a below-floor tier (`max(floor, decision)` clamp + no widening
members in `SandboxTurnOverride`). This is what makes "current workspace-level default
unbroken" provable: with the floor at `policy-light` and all flags off, the system is
bit-identical to today; with flags on, every reachable state is ≥ floor.

**D3. Compose existing classifiers; freeze `SandboxActionRiskClass` to `AcpApprovalClass`
members in v1.** The brief permits extending the vocabulary; exploration showed composition
(`approvalClass` × `isMutatingToolCall` × `FileTarget`) already spans the decision table, so
new enum members would be speculative. *Alternative rejected:* a fresh risk taxonomy —
directly violates the don't-duplicate rule and would drift from
`classifyAcpToolApproval`'s fail-closed spoof handling. *Extension point left open:* the
union alias exists precisely so `"destructive"`-grade members (aligned with
`WorkspaceCommandRisk` names) can be added when the destructive-operation guard [pilot]
graduates and provides evidence-qualified candidates to consume.

**D4. Journal = undo, not isolation; exec is explicitly out of journal scope.** A
policy-light "fast reset" that claimed to contain `exec` would be a lie (§12.2). Routing
`exec_capable` to approvals + (later) workspace-copy keeps every claim honest. *Alternative
rejected:* syscall/fs-watch interception to journal exec side effects — that is de facto
"native OS isolation beyond policy-light", which §12.2 lists as remaining/non-finished work
and §8.4.1 excludes ("no default eBPF/cgroup resource control"). *Alternative rejected:*
git-based snapshots (stash/worktree of the user's repo) — mutates user-visible VCS state,
requires a git repo, and collides with the user's own git usage; the journal is
self-contained under `SANDBOX_STATE_DIR`.

**D5. Reuse sandbox workspace-copy mechanics for the `workspace-copy` tier.** Path
correction established there is no runtime worktree layer; `ensureSandboxWorkspace` +
scope-keyed dirs + registry + prune already implement seeded copies with retention.
*Alternative rejected:* new overlay-fs/hardlink-farm layer — platform-fragile on Windows
(this machine's platform), duplicates `prune.ts`/`registry.ts`, and adds the "manager layer"
this repo's design culture avoids.

**D6. Own bounded record store (security-verification-shadow pattern) instead of a new LCP
report kind.** `LOCAL_CONTROL_PLANE_REPORT_KINDS` is a closed set documented as "stable for
MVP", and §8.4.1 forbids a durable report index. The broker mirrors
`security-verification-shadow`'s `would_*` vocabulary and bounded in-memory records, with
optional payload-omitted trace projection. *Extension point:* if LCP later opens its kind
set (sibling doc 04 proposes a `decision_quality` kind), broker records can be projected
into it without changing the broker.

**D7. Fail-closed on mid-turn isolation failure, including escalation-provision failure.**
The existing chain's catch already blocks on hook failure; the broker adopts the same
posture and deliberately inverts the resolver's degrade-and-continue semantics (degradation
is acceptable when *choosing* a workspace default; it is not acceptable when a specific
risky action *demanded* escalation). *Alternative rejected:* warn-and-continue — silent
downgrade is indistinguishable from no isolation and would poison the shadow-comparison data.

**D8. `explainTurn` mirrors `explain` with a versioned shared decision table.** Small
duplicated data table (Main simulation + runtime enforcement) with
`TURN_ISOLATION_DECISION_TABLE_VERSION` equality asserted in tests, because sharing code
across the process boundary is off the table (§1.2). *Alternative rejected:* Main asks the
runtime to simulate — adds a gateway round-trip to a Settings panel and couples UI
availability to runtime health.

---

## 8. Validation Approach

**Structural invariants (unit, must-pass before any flag ships):**
- Tighten-only: property-based test over all (floor × decision-table row × override)
  combinations asserting `fsTier ≥ floor.minFsTier` and network permissiveness never
  increases; widening `SandboxTurnOverride` is ignored with `override_rejected_widening`.
- Flag-off parity: replay the existing before-tool-call test corpus with the broker present
  but flags off; assert `HookOutcome` deep-equality with baseline (destructive-guard
  `legacyBehavior` precedent).
- Journal round-trip: create/modify/delete matrices over `edit`/`write`/`apply_patch`
  targets (including `oldpath` renames via `FILE_TARGET_OLDPATH_ARG_KEYS` semantics, paths
  with `~`, relative paths against `workspaceDir`, > 8 MiB truncation, missing file =
  creation) asserting byte-identical restore and correct creation-removal.
- Fail-closed: injected `capture` failure yields `blocked: true, deniedReason:
  "turn-isolation"` and no `execute` invocation (spy on the wrapped tool).

**Shadow-phase experiments (Phase 1, real personal use):**
- *Decision-vs-outcome join:* for every recorded decision, join against
  `approvalResolution`, exec approval decisions, and `tool.execution.*` diagnostics.
  Success = false-escalation < 5%, missed-mutation < 1% (gates from Section 6). Failure =
  either rate above threshold after tuning the (small) decision table twice — then the
  design is wrong, stop.
- *Overhead budget:* µs histogram around the broker call inside `runBeforeToolCallHook`
  under a scripted 500-call session. Success = p95 < 1 ms, p99 < 3 ms, zero added approval
  prompts (shadow must be invisible). A measurable slowdown of read-only turns is an
  automatic failure regardless of other results.
- *Spoof-handling regression:* replay the approval-classifier spoofed-identity fixtures;
  broker must classify all as `unknown` → no fs decision beyond floor, network tighten
  recorded (fails closed with the classifier, never around it).

**Pilot-phase experiments (Phase 2):**
- *Journal latency in situ:* capture p95 per file across real edits; success < 25 ms.
- *Rollback fire-drill:* scripted turn mutating 10 files including one rename and one
  creation, then rollback; success = `git status` clean relative to pre-turn snapshot taken
  by the test harness (git used as the *oracle*, not the mechanism).
- *Crash recovery:* kill the runtime between capture and execute; on restart the incomplete
  manifest must be surfaced (not auto-restored) via `sandbox.turnIsolation.records` and
  `explainTurn`.
- *Provision-failure drill (pre-Phase 3):* stop the Docker daemon mid-turn on a
  `docker-strong` floor; the triggering call must block with `provision_failed`, and
  `sandbox.status` must still report the workspace-level `degraded`/`degradeReason`
  unchanged (the two degradation semantics stay distinct).

**Success criteria overall:** all gates in Section 6 met; zero tighten-only violations in
recorded history (structural, so any violation is a release-blocking bug); rollback used at
least once in anger with a correct result; flag-off diffs remain zero across all phases.
**Failure criteria:** overhead or false-escalation gates missed twice after table tuning;
journal restore ever corrupts a file (immediate disable + keep before-images for manual
recovery); or the pilot requires touching more than the additive surfaces named in
Section 4 — that would mean the composition claim was wrong and the design should be
re-reviewed rather than forced.
