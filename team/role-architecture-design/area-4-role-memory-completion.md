# Area 4. Role Memory System Completion

## Exploration Log

- **CodeGraph map sections read**: Sections 5 (full: 5.1-5.6), 7, 8; Section 2.4 (role-spawn memory injection).
- **CodeGraph tool invocations**: none.
- **Files read beyond the map**:
  - `shared/types/memory.ts` (full) — verified `MemoryCard` multi-role binding fields (`roleTags`, `ownerRole`, `sourceRole`, `applicableRoles`, `allowedMutators`), `ContextPack` bucket model, and the full governance vocabulary (proposals, gatekeeper, retention, utility reports, injection explanations). Role Memory's *governance* surface is far richer than the map's summary suggests.
  - `openclaw_runtime/src/memory/memory-store.ts:1-80` — confirmed the store header comment: "intentionally separate from memorySearch/QMD/MEMORY.md"; `role-memory.sqlite`; card row schema.
  - `openclaw_runtime/src/agents/role-spawn.ts:116-177` — verified the ONLY production injection path for Role Memory: `buildRoleSystemPrompt` builds a `ContextPack` and injects "## Memory Context" into *role-spawned subagent* prompts. Main-agent chat turns get NO role-memory injection.
  - `openclaw_runtime/src/context-engine/memory-context-provider.ts:1-110` — verified `RUNTIME_MEMORY_CONTEXT_PROVIDER_ID = "runtime-memory"`, DEFAULT_TOKEN_BUDGET=256, type-aware retrieval slots (semantic 4 / episodic 2 / procedural 2 with redistribution).
  - `openclaw_runtime/src/agents/task-loop-controller.ts:1990-2050` — verified shadow gate: `runtimeMemoryShadowPersistenceEnabled` requires `flags.shadow === true && flags.persist === true`; episode writes are try/catch-swallowed.
  - `electron/services/workspace-permissions.ts:60-113` — verified 16 `memory.*` read methods are in `SAFE_GATEWAY_METHODS`; writes (`memory.propose/update/supersede`) go through the approval gateway.
- **Existing modules found (maturity)**:
  - Role Memory store + governance + ContextPack (`src/memory/*`) — **production**
  - Role Memory injection into role-spawned subagents (`role-spawn.ts:116-159`) — **production**
  - Role Memory UI (`RolesOrchestrationPanel.tsx`, Settings toggle) — **production**
  - Runtime Memory store/persistence/retrieval (`runtime-core/memory-*.ts`) — **shadow** (default-off, `task-loop-controller.ts:2001`)
  - Runtime Memory context provider (`context-engine/memory-context-provider.ts`) — built, **not wired to production chat**
  - UserProfile layer (`memory-user-profile.ts`) — **pilot-failed** (v1: 53.54%→47.24%, v2: →51.18% open_domain)
  - Eval harness (L1-L9 + CV1-CV5, `run-runtime-memory-eval.mjs`) — production *tooling* for a shadow feature
- **Refinement opportunities identified** (map §5.5 plus exploration):
  1. Runtime Memory shadow-only; no production context injection.
  2. Role Memory injects only into role-*spawned subagents*, never into ordinary chat turns — an injection asymmetry the map implies but doesn't state crisply.
  3. Two systems have no shared retrieval/injection pipeline.
  4. host-api has no typed memory methods (`contract.ts:215-216` = 2 booleans).
  5. Multi-hop Recall@5 = 17.32%; extraction density 0.3 facts/turn; UserProfile lowered scores.
  6. Role Memory has zero evaluation coverage despite having the governance apparatus Runtime Memory lacks.
- **Non-goals and constraints identified**: neither memory system may be deleted; `role-memory.sqlite` schema changes must be additive; pilot promotion pattern (fresh spec, operator gate, default-off, disable-only rollback, no schema change); Knowledge Hub does not replace role memory (design-overview §1.2); Renderer/Main boundary.

## 1. Current State Summary

**What the existing system CAN do:**

- Role Memory: full CRUD + governance lifecycle (propose → gatekeeper → review → apply, `memory-store.ts`, `gatekeeper.ts`), scope/retention policy (`memory-policy.ts`: SCOPE_IMPACT, RETENTION_TYPE_WEIGHT), budgeted `ContextPack` assembly with per-bucket token budgets and injection explain logs, and production injection into role-spawned subagent prompts (`role-spawn.ts:116-159`).
- Runtime Memory: fact/episode/relation store with hybrid retrieval (BM25 + 3-gram TF-IDF + RRF, `memory-hybrid-retrieval.ts`), type-aware slot allocation in a registered context provider (`memory-context-provider.ts:99+`), full persistence (`memory-persistence.ts`, SCHEMA_VERSION=1 in `openclaw.sqlite`), and a 16-layer eval harness.
- UI: `RolesOrchestrationPanel.tsx` operates the entire Role Memory lifecycle via `hostApi.gateway.rpc('memory.*')`; Settings exposes `roleMemoryEnabled` / `memoryEmbeddingEnabled`.

**What the existing system CANNOT do:**

- Inject any memory into an **ordinary chat turn**. Role Memory reaches only role-spawned subagents; Runtime Memory reaches nothing (shadow). The user's main conversations — the bulk of usage — run memory-free. This is the concrete substance of "记忆系统没有完善".
- Evaluate Role Memory quality (no eval coverage), or govern Runtime Memory facts (no proposal/review path).
- Offer type-safe memory access to the renderer.
- Answer multi-hop questions (Recall@5 17.32%) or extract facts densely (0.3/turn).

**Why this matters:** for a personal agent, memory is the feature that makes an assistant *personal*. The system has built two half-pipelines: one with governance and no evaluation, one with evaluation and no wiring. Completing means connecting, not rebuilding.

**Non-goals respected:** both systems preserved; KB stays separate from role memory; no new database.

## 2. Architecture Overview

```
[EXISTING]                                          [NEW]
──────────────────────────────                      ──────────────────────────────
Role Memory (production)                            Memory Access Facade
  memory/memory-store.ts  ──────────┐                 shared/host-api contract:
  memory/memory-policy.ts           │                 hostApi.memory.{list, search,
  memory/context-pack.ts            │                 propose, update, health}
  role-spawn.ts §buildRole-         │                 (typed wrapper over existing
    SystemPrompt (subagent          │                  gateway RPC — no new runtime
    injection)          ────────────┼──────────►      methods)
                                    │
Runtime Memory (shadow)             │               Unified Retrieval Bridge
  runtime-core/memory-store.ts      │                 context-engine/
  runtime-core/memory-hybrid-       ├──────────►      role-memory-context-provider.ts
    retrieval.ts                    │                 (Role Memory ContextPack exposed
  context-engine/memory-context-    │                  as a RuntimeContextProvider,
    provider.ts (built, unwired) ───┤                  peer of "runtime-memory")
                                    │
task-loop-controller.ts:2001        │               Chat-turn injection pilot
  shadow episode writes ────────────┼──────────►      flag: runtimeMemory.injectPilot
                                    │                 (default OFF; wires BOTH
Eval harness (L1-L9, CV1-CV5) ──────┼──────────►      providers into chat turns
                                    │                  behind one operator gate)
RolesOrchestrationPanel.tsx ────────┘
                                                    Role Memory eval pack
                                                      (reuses L-layer harness against
                                                       role-memory ContextPack output)
```

## 3. Component Specifications

### 3.1 Federate, don't unify: the two-system decision

The design keeps both systems and **federates them at the context-provider seam**. Cost comparison:

- **Unify (merge stores)**: requires migrating `role-memory.sqlite` governance tables into `openclaw.sqlite` or vice versa — schema changes on production data, violates the additive-only constraint, months of churn, and conflates two genuinely different data shapes (curated cards vs extracted facts). Rejected.
- **Keep split, no bridge**: today's state; injection asymmetry persists. Rejected.
- **Federate**: each system keeps its store, policy, and lifecycle; both expose their retrieval as `RuntimeContextProvider` instances; the context engine composes them per-turn under one token budget. Cost: one new provider file + one wiring flag. Chosen.

### 3.2 `RoleMemoryContextProvider` [NEW]

**Responsibility:** expose Role Memory's existing `buildContextPack` output as a `RuntimeContextProvider` (the same interface `memory-context-provider.ts` implements), so ordinary chat turns can receive role-memory cards through the identical seam Runtime Memory will use. It does *not* re-implement retrieval — it calls `getMemoryCards` + `buildContextPack` exactly as `role-spawn.ts:116-159` does today, then adapts `ContextPack` buckets into `ContextItem`s.

**Interfaces:**

```typescript
// openclaw_runtime/src/context-engine/role-memory-context-provider.ts [NEW]
export const ROLE_MEMORY_CONTEXT_PROVIDER_ID = "role-memory";

export type RoleMemoryContextProviderOptions = {
  // Resolves which role identity applies to this turn (Area 1 taxonomy):
  // for a main-agent chat turn, the Agent's persona-derived role name or 'main';
  // for a role-spawned subagent, RoleContract.name (already available).
  resolveRoleName: (query: RuntimeContextProviderQuery) => string | undefined;
  defaultTokenBudget?: number;   // reuse ContextPackBudget.total, default 512
};

export function createRoleMemoryContextProvider(
  opts: RoleMemoryContextProviderOptions,
): RuntimeContextProvider;
```

**Internal state:** none — delegates storage to `memory-store.ts`, budgeting to `context-pack.ts`, and records injections via the existing `recordMemoryInjection` (so `memory.explainInjection` keeps working for chat-turn injections too).

**Lifecycle:** registered at runtime startup alongside `RUNTIME_MEMORY_CONTEXT_PROVIDER_ID`; activation is governed by the pilot flag (§3.4). Teardown: none (stateless).

**Error handling:** mirror `role-spawn.ts:142-153` — any store/pack failure returns an empty provider result and never blocks the turn.

### 3.3 Typed host-api memory namespace [NEW facade]

**Responsibility:** give the renderer type-safe access to the memory operations `RolesOrchestrationPanel.tsx:613-773` already performs via stringly `gateway.rpc(...)`. This is a *facade* in Main (`electron/services/memory-api.ts` [NEW]) that forwards to the same gateway methods — no new runtime RPC, no permission change (reads stay SAFE-listed, writes stay approval-gated because the facade calls through the same `gateway-api.ts` decision path).

**Interfaces:**

```typescript
// shared/host-api/contract.ts — additions to the registry
memory: {
  list: (payload: MemoryListPayload) => MemoryListResult;           // → memory.list
  search: (payload: MemorySearchPayload) => MemoryListResult;       // → memory.list w/ query
  detail: (payload: { id: string }) => MemoryDetailResult;          // → memory.detail
  propose: (payload: MemoryProposal) => MemoryProposeResult;        // → memory.propose (gated)
  update: (payload: MemoryUpdatePayload) => MemoryUpdateResult;     // → memory.update (gated)
  health: () => MemoryHealthReport;                                 // → memory.health
  explainInjection: (payload: { injectionId?: string; sessionKey?: string })
    => MemoryInjectionExplainResult;                                // → memory.explainInjection
};
```

Payload/result types already exist in `shared/types/memory.ts` (`MemoryCard`, `MemoryProposal`, `MemoryHealthReport`, `MemoryInjectionRecord`) — the contract addition is mostly re-export plumbing.

**Migration of existing callers:** `RolesOrchestrationPanel.tsx` migrates incrementally, one RPC at a time; `gateway.rpc('memory.*')` keeps working throughout (the facade is additive).

**Error handling:** identical HostSuccess/error envelope as every other service module.

### 3.4 Chat-turn injection pilot (shadow → active promotion)

**Responsibility:** the single operator gate that turns memory injection on for ordinary chat turns. One flag, two providers:

```typescript
// config (runtime): runtimeMemory.injectPilot
type MemoryInjectPilotConfig = {
  enabled: boolean;              // default false
  providers: Array<'role-memory' | 'runtime-memory'>;  // default ['role-memory']
  totalTokenBudget: number;      // default 512 (role) + 256 (runtime) capped
  sessions?: 'all' | 'main-only';// default 'main-only' (agent:<id>:main sessions)
};
```

Wiring point: the `agent` gateway method's context assembly (where `extraSystemPrompt` composition happens today) queries registered providers when the flag is on. Role Memory first (curated, governed, lower risk — it is already production for subagents), Runtime Memory second (only after its gates pass, §6).

**Why Role Memory goes first:** its injection path is already production-proven in `role-spawn.ts`; extending the *same packs* to main-session turns is a small delta. Runtime Memory injection is the genuinely new behavior and keeps its own gate.

### 3.5 Retrieval/extraction quality workstreams (Runtime Memory)

These are eval-side workstreams, prerequisites for the Runtime Memory half of §3.4 — specified here as design direction, executed under the existing phase-spec pattern:

1. **Extraction density** (0.3 → ≥1.0 facts/turn): revise `memory-extraction-prompt.ts` with (a) JSON-schema-constrained output, (b) 3-5 few-shots including negative examples ("do not extract pleasantries"), (c) chunk_size 100 → 40 turns. Gate: L-layer extraction score improves with no precision regression >2pp.
2. **Multi-hop** (Recall@5 17.32%): replace chained-score decay with **sub-question decomposition** — decompose the query, run hybrid retrieval per sub-question, merge via RRF (the RRF machinery already exists in `memory-hybrid-retrieval.ts`). Rationale: decay tuning fights a structural problem (hop-2 candidates score against the wrong query); decomposition fixes the query. Gate: multi_hop Recall@5 ≥ 40% with single-hop unchanged.
3. **UserProfile**: **defer, don't delete.** Both experiments show profile context is noise at current extraction quality. Revisit only after extraction density ≥1.0, and then as a *retrieval router hint* (select which dimensions to query) rather than injected context — the failure mode was injected noise, so the revision must not inject.

### 3.6 Role Memory eval pack [NEW]

**Responsibility:** close the "governance without evaluation" gap by reusing the L-layer harness against Role Memory: fixture cards + role/task queries → `buildContextPack` → precision/recall of bucket selection, budget adherence, conflict-exclusion correctness. This makes the two systems symmetric (each has store + policy + eval) and gives §3.4's Role Memory path a measurable gate rather than just "already production for subagents".

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `openclaw_runtime/src/context-engine/role-memory-context-provider.ts` | NEW file | Federation seam |
| `openclaw_runtime/src/context-engine/memory-context-provider.ts` | NO change | Already provider-shaped; just gets registered |
| `openclaw_runtime/src/memory/memory-store.ts` | NO schema change; export existing fns for provider use | Additive-only constraint |
| `openclaw_runtime/src/agents/role-spawn.ts` | NO behavior change now; later may delegate `buildRoleSystemPrompt` memory step to the provider (pure refactor, output-identical) | One injection code path eventually |
| Runtime `agent` method context assembly | Read `runtimeMemory.injectPilot` flag; query providers when on | The single wiring point |
| `openclaw_runtime/src/agents/task-loop-controller.ts` | NO change | Shadow episode writes continue as-is |
| `shared/host-api/contract.ts` | Add `memory` namespace (types re-exported from `shared/types/memory.ts`) | Type safety |
| `electron/services/memory-api.ts` | NEW facade service forwarding to gateway RPC via existing permission path | Renderer/Main boundary preserved |
| `src/lib/host-api.ts` | Add `memory` namespace | Single renderer entry rule |
| `src/components/agents/RolesOrchestrationPanel.tsx` | Incremental migration from `gateway.rpc` strings to `hostApi.memory.*` | No big-bang; old path keeps working |
| `src/stores/settings.ts` | NO change (`roleMemoryEnabled` / `memoryEmbeddingEnabled` stay) | Pilot flag is runtime config, not a settings toggle, until promotion |
| `electron/services/workspace-permissions.ts` | NO change | Read/write gating already correct |
| `memory-extraction-prompt.ts`, `memory-chained-retrieval.ts`, `memory-user-profile.ts` | Eval-side revisions per §3.5 (each under its own phase spec) | Quality gates before injection promotion |

`RolesOrchestrationPanel.tsx` and `memory-store.ts` are >20KB: both changes are additive (new call targets / new exports; no rewrite of existing logic).

**Chat-page memory surface (design question from the prompt):** add a *read-only* affordance, not a management surface — a "Memory used this turn" disclosure on assistant messages, backed by `hostApi.memory.explainInjection({ sessionKey })` (the injection records already exist per `memory-store.ts:1772`). Full management stays in `RolesOrchestrationPanel.tsx`; duplicating card CRUD in chat would double the governance UI for no benefit. Deferred until §3.4 is on (before that, chat turns have no injections to explain).

## 5. Data Flow

**Scenario: pilot ON (`providers: ['role-memory']`, `sessions: 'main-only'`). User asks their main agent "上次我们决定用哪种迁移方案？"**

1. Renderer `sendMessage` (`runtime-send-actions.ts:71`) → `hostApi.chat.sendWithMedia({ sessionKey: 'agent:main:main', ... })` — unchanged.
2. Main `chat-api.ts` → `gatewayManager.rpc('chat.send', ...)` — unchanged.
3. Runtime `agent` method assembles context; sees `injectPilot.enabled && session is main` → queries registered context providers.
4. [NEW] `RoleMemoryContextProvider.resolveRoleName` maps the turn to role identity `'main'` (or the Agent's persona role per Area 1) → `getMemoryCards({ roleName })` → `buildContextPack({ memories, roleName, taskState: userMessage, openConflicts })` (`memory/context-pack.ts`) → adapts buckets (`hardConstraints`, `projectFacts`, `recentEpisodes`...) into ContextItems within budget.
5. Provider calls `recordMemoryInjection` — the injection is explainable via `memory.explainInjection` exactly like subagent injections today.
6. The decision card ("决定使用双写迁移方案", scope=project, type=decision) lands in the prompt; the model answers grounded.
7. Renderer message renders a [NEW] "Memory used" disclosure; clicking calls `hostApi.memory.explainInjection({ sessionKey })` → typed facade → `memory.explainInjection` (SAFE-listed read).
8. Shadow Runtime Memory episode write for the turn proceeds unchanged (`task-loop-controller.ts:2006`).

## 6. Migration Path

This design involves a shadow→active promotion (chat-turn injection), following the pilot pattern:

- **Fresh spec**: `harness/specs/tasks/role-first-memory-inject-pilot.md` (new), referencing `gateway-backend-communication`.
- **Explicit operator gate**: `runtimeMemory.injectPilot.enabled`, default false; not exposed in Settings until promotion.
- **Default-off start**: flag-off parity — with the flag off, prompt bytes are identical to today (assertable in comms replay: `pnpm run comms:replay` / `comms:compare` per map §8).
- **Gates before enabling `role-memory` provider**: Role Memory eval pack (§3.6) green: bucket precision ≥ 0.8 on fixtures, budget adherence 100%, conflict-exclusion 100%.
- **Gates before adding `runtime-memory` provider**: maturity score ≥ 0.7 (existing `runtime-memory-maturity-score.ts` threshold); extraction density ≥ 1.0; multi_hop Recall@5 ≥ 40%; open_domain not below the 53.54% baseline.
- **Telemetry during pilot**: injection records (already stored) + per-turn token overhead + `MemoryFeedbackRecord` outcomes via the existing feedback table; weekly `memory.utilityReport` review.
- **Rollback**: disable-only — flip the flag; no schema was changed, no data migrates, injections simply stop. UserProfile stays out of scope entirely.

The facade (§3.3) and provider registration (§3.2) are purely additive and need no promotion.

## 7. Design Decisions

1. **Federate at the context-provider seam** — see §3.1. Alternatives (store merge, status quo) rejected. Extension point: a future shared re-ranker across both providers' candidates.
2. **Facade over new RPC surface.** Adding runtime-side typed methods would duplicate 16 existing `memory.*` methods. The type-safety gap is renderer-side, so the fix is Main-side. Rejected alternative: generating types from the gateway schema — heavier tooling than the problem warrants.
3. **Role Memory leads the injection pilot.** It is governed (gatekeeper, review, retention) and production-proven for subagents; Runtime Memory has known quality gaps (17.32% multi-hop). Sequencing de-risks the user-visible step.
4. **UserProfile deferred with a stated re-entry condition** (extraction density ≥1.0, router-hint-only design). Rejected: removal (the Memobase-inspired structure is sound; the inputs were noisy). Rejected: immediate v3 (would repeat the failure with the same noisy inputs).
5. **Sub-question decomposition over decay tuning** for multi-hop — fixes the query, not the score. Reuses existing RRF.
6. **Chat memory surface is read-only explain, not management** — governance stays in one place.

## 8. Validation Approach

- **Flag-off parity**: comms replay comparison proves byte-identical prompts with pilot off.
- **Role Memory eval pack** (§3.6): fixture-based precision/budget/conflict metrics; run in CI alongside the existing 50+ runtime-memory tests.
- **Runtime Memory gates**: existing L1-L9 + CV1-CV5 harness; maturity score ≥ 0.7; the three §3.5 workstreams each carry their own before/after eval.
- **Pilot-phase product metric**: `MemoryFeedbackRecord` helpful-rate ≥ 60% and harmful-rate ≤ 5% over the pilot window (the feedback schema already computes these in `MemoryUtilityReport.aggregate`).
- **Failure criterion**: any open_domain or task-success regression attributable to injection → disable, analyze injection explain logs, iterate.

## 9. Boundary Considerations

- **Write boundary**: memory writes remain proposal-gated through the gatekeeper (`memory.propose` is approval-gated in `gateway-api.ts`); the facade does not create an ungated write path.
- **Permission scopes**: SAFE vs mutating classification in `workspace-permissions.ts:60-122` is unchanged; facade reads map to SAFE-listed methods.
- **Injection budget boundary**: the pilot's `totalTokenBudget` is a new explicit boundary — providers cannot exceed it, preserving the context engine's budget discipline (`ContextPackBudget`, provider DEFAULT_TOKEN_BUDGET=256).
- **`allowedMutators` boundary**: card-level mutator restrictions are enforced in the store regardless of entry path (facade or gateway RPC) — the facade adds no circumvention path.
- **New boundary introduced**: `injectPilot.sessions: 'main-only'` scopes the pilot away from subagent sessions (which already have their own injection path), preventing double-injection during the pilot.
