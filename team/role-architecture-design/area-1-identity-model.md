# Area 1. Role-Driven Architecture Definition and Identity Model

## Exploration Log

- **CodeGraph map sections read**: Sections 0, 1, 2 (full), 2.5, 2.6, 7, 8 of `team/codegraph-role-architecture.md`.
- **CodeGraph tool invocations**: none — the map plus direct file reads were sufficient.
- **Files read beyond the map**:
  - `shared/types/agent.ts` (full) — confirmed all three type definitions, `DEFAULT_ROLE_PROFILE` (role='通用助手'), and the `RoleContract.profile?: Partial<AgentRoleProfile>` bridge at line 85. Noted the runtime-side `RoleContract` in `role-contract.ts:33-50` does NOT carry the `profile` field — the two declarations have drifted.
  - `electron/utils/agent-config.ts:706-822` — verified `compileRoleProfileToMarkdown` / `parseRoleProfileFromMarkdown`: free-form Chinese Markdown with heuristic regex parse-back (`是一个`, `## 回复风格`, `## 擅长`, `## 不擅长`, `## 背景`).
  - `openclaw_runtime/src/agents/role-contract.ts:200-363` — verified `compileRoleContractToSoul` and all 8 `BUILT_IN_ROLE_CONTRACTS` entries with `capabilities`, `riskProfile`, `canModifyScope` fields (fields present runtime-side, absent in `shared/types/agent.ts:72-86`).
  - `openclaw_runtime/src/agents/role-registry.ts` (full) — verified resolution order and that the registry ALREADY tracks `configRoleNames: string[]` (line 40) distinguishing config-defined from built-in roles.
  - `openclaw_runtime/src/agents/role-spawn.ts` (full) — verified the RoleContract→subagent mapping including memory-card injection in `buildRoleSystemPrompt` (lines 116-159).
  - `openclaw_runtime/src/agents/subagent-spawn.ts:1300-1358` — verified `patchChildSession` writes `spawnDepth` / `subagentRole` / `subagentControlScope` into the child session entry.
  - `openclaw_runtime/src/agents/orchestration-protocol.ts:44,501` (via grep) — discovered `roleInstanceId` already exists with format `${orchestrationRunId}:${taskId}:${roleName}:attempt-1`; it flows through `orchestrator-run-observed.ts:336`, `team-orchestrate-tool.ts:254`, `agent-steering-queue.ts:294,398`, `subagent-registry.ts:567`.
- **Existing modules found (maturity)**:
  - Agent CRUD (`electron/utils/agent-config.ts`, `electron/services/agents-api.ts`) — production
  - SOUL.md compile/parse (`agent-config.ts:706-822`) — production
  - RoleContract + registry + spawn (`role-contract.ts`, `role-registry.ts`, `role-spawn.ts`) — production
  - `roleInstanceId` ledger fields (`orchestration-protocol.ts`) — production (orchestration-internal)
  - `cfg.agents.roles[]` config extension path — production, but no UI authoring surface (planned)
- **Refinement opportunities identified**:
  1. Three concepts share the word "role" in UI/docs with no canonical taxonomy document.
  2. Shared vs runtime `RoleContract` declarations have drifted (`profile` only in shared; `capabilities`/`riskProfile`/`canModifyScope` only in runtime).
  3. SOUL.md round-trip is lossy (heuristic parse; `customStyle` and `customRole` do not round-trip cleanly).
  4. `RoleContract.profile` bridge is untyped-loose and unused by the runtime compiler.
  5. Built-in vs config-defined origin is computed (`configRoleNames`) but not surfaced through `roles.list` or UI.
  6. "Role instance" exists as three uncorrelated fragments: `roleInstanceId` (ledger), `subagentRole` (session patch), `childSessionKey` (session key).
- **Non-goals and constraints identified**: do not merge the three concepts; respect SOUL.md compilation as production code; Renderer/Main boundary (map §8); no database; the three-layer split is fixed.

## 1. Current State Summary

**What the existing system CAN do:**

- Maintain persistent Agent identities with per-agent workspace, model binding, channel bindings, and session trees (`electron/utils/agent-config.ts:873-1110`, `shared/types/agent.ts:3-16`).
- Attach exactly one persona per Agent, edited via `RoleProfileEditor.tsx`, compiled to `<workspace>/SOUL.md` (`agent-config.ts:706-822`).
- Define reusable orchestration roles: 8 built-ins (`role-contract.ts:230-359`), config extensions via `cfg.agents.roles[]` normalized and validated by `role-registry.ts:51-85`, and spawn them as hard-scoped subagents (`role-spawn.ts:224-241`).
- Track per-attempt orchestration identity via `roleInstanceId` (`orchestration-protocol.ts:501`) and per-session role via `subagentRole` (`subagent-spawn.ts:1343`).

**What the existing system CANNOT do (the gaps this design addresses):**

- There is no single document or type-level annotation that tells a maintainer which "role" a given surface means. The user's report "role positioning is vague" is a naming/boundary observation, not a functionality gap.
- The shared and runtime `RoleContract` types are structurally divergent, so a contract authored against one may silently drop fields when crossing the layer boundary.
- SOUL.md parse-back cannot recover all `AgentRoleProfile` fields (heuristic regex; `customStyle` is written but never parsed back — see `parseRoleProfileFromMarkdown`, which has no `补充` branch).
- The `RoleContract.profile` bridge is declared but `compileRoleContractToSoul` (`role-contract.ts:207-226`) never reads it, so persona fragments on contracts are dead weight today.
- No API/UI surface distinguishes a built-in role from a user-defined role, even though the registry computes this.
- "Role instance" has no named concept; consumers correlate `roleInstanceId` / `subagentRole` / `childSessionKey` by convention.

**Why this matters:** on a personal agent platform, the same user is author, operator, and maintainer. Ambiguous naming directly costs them when extending the system — every new feature (memory binding, KB binding, chat switching) must re-decide what "role" means. Areas 2-5 all build on this taxonomy.

**Non-goals respected:** Knowledge Hub is not a knowledge graph (design-overview §1.2); the three-layer split stays; three concepts stay separate.

## 2. Architecture Overview

```
[EXISTING]                                        [NEW]
─────────────────────────────────────            ─────────────────────────────────────
shared/types/agent.ts                            shared/types/role-identity.ts
  AgentSummary ──────────────────────┐             RoleIdentityKind ('assistant' |
  AgentRoleProfile ──────────────────┤               'persona' | 'contract')
  RoleContract (drifted copy) ───────┤             RoleOrigin ('built-in' | 'config')
                                     ├──────────►  RoleInstanceDescriptor
openclaw_runtime/src/agents/         │             (correlates roleInstanceId +
  role-contract.ts (authoritative) ──┤              subagentRole + childSessionKey)
  role-registry.ts                   │
    configRoleNames ─────────────────┼──────────►  roles.list result gains
  role-spawn.ts                      │             `origin` field   [NEW field]
  orchestration-protocol.ts          │
    roleInstanceId ──────────────────┘
                                                  docs/role-identity-taxonomy.md
electron/utils/agent-config.ts                    [NEW canonical naming doc]
  compileRoleProfileToMarkdown ──────┐
  parseRoleProfileFromMarkdown ──────┼──────────►  SOUL.md structured sidecar
                                     │             (role-profile.json next to
src/components/agents/               │              SOUL.md; SOUL.md stays the
  RoleProfileEditor.tsx              │              prompt-facing artifact)
  RoleCard.tsx ──────────────────────┴──────────►  origin badge on RoleCard
```

Data flow: taxonomy doc + `role-identity.ts` are consumed at build/review time; `origin` flows registry → `roles.list` → RoleCard; the sidecar flows RoleProfileEditor → `writeAgentRoleProfile` → SOUL.md + `role-profile.json`.

## 3. Component Specifications

### 3.1 Canonical taxonomy (documentation + type vocabulary)

**Responsibility:** one authoritative naming scheme so every surface can say which concept it means. Proposed canonical names, chosen to avoid renaming any existing type (renames would churn 100+ call sites for zero behavior):

| Concept | Canonical English | Canonical Chinese | Type (unchanged) | Lifecycle |
|---|---|---|---|---|
| Agent | **Assistant** (identity) | 助手 | `AgentSummary` | user-created, persistent |
| AgentRoleProfile | **Persona** | 人设 | `AgentRoleProfile` | 1:1 attribute of an Assistant |
| RoleContract | **Role Contract** | 角色契约 | `RoleContract` | library item, M:N with Assistants |

Deliverable: `docs/role-identity-taxonomy.md` (≈2 pages) + JSDoc headers on the three types in `shared/types/agent.ts` pointing at it + i18n label review so `agents.json` locales use 助手/人设/角色契约 consistently.

**Interfaces:**

```typescript
// shared/types/role-identity.ts  [NEW]
export type RoleIdentityKind = 'assistant' | 'persona' | 'contract';
export type RoleOrigin = 'built-in' | 'config';
```

**Internal state:** none — pure vocabulary. **Lifecycle:** created once, updated with the taxonomy doc. **Error handling:** n/a.

### 3.2 Shared/runtime `RoleContract` reunification

**Responsibility:** eliminate the drift between `shared/types/agent.ts:72-86` and `role-contract.ts:33-50`. The runtime declaration is authoritative (it has the validator). The shared declaration gains the runtime-only fields; the runtime declaration gains `profile?: Partial<AgentRoleProfile>` so the bridge is honored on both sides.

**Interfaces (target unified shape):**

```typescript
export interface RoleContract {
  name: string; displayName: string; description?: string;
  rolePrompt: string;
  tools: string[];
  capabilities?: string[];          // ← add to shared
  toolRequirements?: string[];      // ← add to shared
  riskProfile?: 'low'|'medium'|'high'|'critical';  // ← add to shared
  canModifyScope?: boolean;         // ← add to shared
  permissions: RolePermissions;
  model: RoleModelBinding;
  effort: RoleContractEffort;
  outputSchema: RoleOutputSchema;
  handoff: RoleHandoffRules;
  version?: string; tags?: string[];
  profile?: Partial<AgentRoleProfile>;  // ← add to runtime (already normalized-tolerant)
}
```

**Lifecycle:** one additive type change per side; `normalizeRoleContract` already tolerates unknown keys, so config files need no migration. **Error handling:** `validateRoleContract` gains a soft check that `profile`, when present, is an object (invalid → issue, contract still loads without profile).

### 3.3 Persona structured sidecar (`role-profile.json`)

**Responsibility:** make the Persona round-trip lossless without touching the production SOUL.md mechanism. `writeAgentRoleProfile` (`agent-config.ts:816-822`) additionally writes the structured profile as JSON next to SOUL.md; `readAgentRoleProfile` (`:806-814`) prefers the sidecar when present and its `soulHash` matches the current SOUL.md, else falls back to the existing heuristic parse.

**Interfaces:**

```typescript
// stored at <workspace>/role-profile.json
type RoleProfileSidecar = {
  version: 1;
  profile: AgentRoleProfile;
  soulHash: string;      // sha256 of the SOUL.md this profile compiled to
  compiledAt: string;    // ISO timestamp
};
```

**Internal state:** owns nothing in memory; the file is the state. SOUL.md remains the only artifact the runtime reads — the sidecar is a Main-process editing aid.

**Lifecycle:** written on every `writeAgentRoleProfile`; read on `readAgentRoleProfile`; if the user hand-edits SOUL.md directly, `soulHash` mismatches and the system transparently falls back to heuristic parse (user edits win — SOUL.md stays source of truth for the prompt).

**Error handling:** sidecar read/parse failure → silent fallback to heuristic parse (identical to today's behavior). Sidecar write failure → log warning, SOUL.md write still succeeds.

**Trade-off note (free-form vs structured):** keep SOUL.md free-form. Downstream consumers (`RoleContract.profile`, memory binding in Area 4, KB binding in Area 5) should consume the *structured* `AgentRoleProfile` via `agents.getBootstrap`, never re-parse SOUL.md. The sidecar makes that structured view reliable; forcing structure into SOUL.md itself would break the "user can hand-edit their agent's soul" affordance, which is a deliberate product property.

### 3.4 `RoleInstanceDescriptor` (named correlation, not a new runtime object)

**Responsibility:** give the "concrete realization of a RoleContract at orchestration time" a name and a single shape, correlating fields that already exist. This is a *descriptor* assembled at spawn time and attached to lifecycle events/traces — no new store, no new lifecycle.

**Interfaces:**

```typescript
// shared/types/role-identity.ts  [NEW]
export type RoleInstanceDescriptor = {
  roleName: string;              // RoleContract.name
  roleOrigin: RoleOrigin;        // from registry.configRoleNames
  contractVersion?: string;      // RoleContract.version at spawn time
  roleInstanceId: string;        // existing ledger id (orchestration-protocol.ts:501)
  agentId: string;               // hosting Assistant
  childSessionKey: string;       // agent:{agentId}:subagent:{uuid}
  spawnedAt: string;
};
```

**Internal state:** none — assembled in `spawnRoleSubagent` from data it already has (`role`, `request.agentId`, `result.childSessionKey`) plus the orchestration ledger. **Lifecycle:** ephemeral; embedded in the existing `subagent-lifecycle` broadcast payload and observability trace spans so the renderer and traces can show "which contract, which version, which attempt" without joining three sources. **Error handling:** descriptor assembly is best-effort; a missing field never blocks a spawn (mirrors the `recordMemoryInjection` try/catch pattern at `role-spawn.ts:142-153`).

**Verdict on the design question:** `subagentRole` + `roleInstanceId` are *sufficient as storage*; what is missing is only the named, correlated read model. A richer runtime concept (role-instance store with its own lifecycle) is rejected — it would duplicate the subagent registry.

### 3.5 Role origin surfacing

**Responsibility:** expose the registry's existing built-in/config distinction. `roles.list` (`role-orchestration-methods.ts:225-229`) adds `origin: RoleOrigin` per role (computed from `RoleRegistry.configRoleNames`); `RoleCard.tsx` renders a small badge ("Built-in" / "Custom", i18n'd). Config-defined overrides of a built-in name display as `origin: 'config'` with an "overrides built-in" hint — that is exactly the information a maintainer needs when debugging surprising role behavior.

**Verdict on the design question:** the current "built-ins + config overrides, later wins" model is right for a single-user tool — a hard built-in/user-defined split (separate namespaces) is rejected because override-by-name is the simplest way to let the user tune a built-in role's model/effort without forking it. The refinement is visibility, not mechanics.

### 3.6 Role↔channel relationship (documentation decision)

Channel binding stays at the Assistant level (`AgentSummary.channelTypes`, bindings in `config.bindings[]`). RoleContracts get **no** channel field: a contract describes *capability*, and channels are *delivery identity* — mixing them would let an orchestration-time library item claim delivery routes, which crosses the Agent-owns-channels boundary in `agent-config.ts:1074-1110`. A user wanting "the docs-writer role answering on Discord" models that as an Assistant bound to Discord whose orchestrations use the docs-writer contract. This decision goes in the taxonomy doc.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `shared/types/agent.ts` | Add runtime-only fields to `RoleContract`; JSDoc taxonomy headers on all three types | Reunify drifted declarations; anchor taxonomy at the type level |
| `shared/types/role-identity.ts` | NEW file: `RoleIdentityKind`, `RoleOrigin`, `RoleInstanceDescriptor` | Shared vocabulary for Areas 2-5 |
| `openclaw_runtime/src/agents/role-contract.ts` | Add `profile?: Partial<AgentRoleProfile>` (as untyped passthrough record runtime-side) + soft validation | Honor the bridge both sides; keep normalizer tolerant |
| `openclaw_runtime/src/agents/role-registry.ts` | NO structural change; export a helper `roleOrigin(name, registry)` | `configRoleNames` already computed |
| `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts` | `roles.list`/`roles.get` results gain `origin` | Surface existing knowledge |
| `openclaw_runtime/src/agents/role-spawn.ts` | Assemble `RoleInstanceDescriptor`, attach to lifecycle event payload | Correlation read model |
| `electron/utils/agent-config.ts` | `writeAgentRoleProfile` writes sidecar; `readAgentRoleProfile` prefers valid sidecar | Lossless persona round-trip, additive |
| `src/components/agents/RoleCard.tsx` | Origin badge (i18n: en/zh/ja/ru) | Built-in vs custom visibility |
| `src/components/agents/RoleProfileEditor.tsx` | NO change | Editor already works on structured `AgentRoleProfile` |
| `electron/services/agents-api.ts` | NO change | `getBootstrap`/`updateBootstrap` shape unchanged |
| `src/pages/Agents/index.tsx` | NO change (badge lives in RoleCard) | — |
| `docs/role-identity-taxonomy.md` | NEW doc | Canonical naming, channel decision, concept map |

`agent-config.ts` is >20KB: the change is additive (two functions gain a sidecar step; no existing line of the compile/parse pair is modified).

## 5. Data Flow

**Scenario: user edits the persona of Assistant "研究员", then that Assistant runs an orchestration using the `reviewer` contract.**

1. User edits fields in `RoleProfileEditor.tsx` → `hostApi.agents.updateBootstrap(agentId, { roleProfile })` (`src/lib/host-api.ts:691-714`).
2. Main: `agents-api.ts:136-226` → `writeAgentRoleProfile` (`agent-config.ts:816-822`) → `compileRoleProfileToMarkdown` writes SOUL.md **and** [NEW] writes `role-profile.json` sidecar with `soulHash`.
3. Later, a chat message triggers `team_orchestrate`; `createOrchestratorPlan` selects `reviewer`; `spawnRoleSubagent` (`role-spawn.ts:224`) resolves the contract via `role-registry.ts` — registry reports `origin: 'built-in'`.
4. [NEW] `spawnRoleSubagent` assembles `RoleInstanceDescriptor { roleName: 'reviewer', roleOrigin: 'built-in', roleInstanceId, agentId: '研究员-id', childSessionKey }` and includes it in the `subagent-lifecycle` broadcast.
5. `patchChildSession` writes `subagentRole` exactly as today (`subagent-spawn.ts:1341-1348`) — unchanged.
6. Renderer receives the lifecycle event; `TeamOrchestrationCard.tsx` can now show "Reviewer (built-in, v—) · attempt 1" from one payload.
7. When the user later opens the persona editor, `readAgentRoleProfile` finds the sidecar, `soulHash` matches, returns the exact structured profile — `customStyle` no longer silently drops.

## 6. Migration Path

Purely additive — no shadow→active promotion needed:

- Type unification adds optional fields only; existing configs and built-ins validate unchanged.
- The sidecar is written on next persona save; agents without a sidecar keep today's heuristic-parse behavior indefinitely.
- `origin` and `RoleInstanceDescriptor` are new response/event fields; no consumer is required to read them.
- Rollback = stop writing the sidecar / drop the new fields; nothing depends on them for correctness.

## 7. Design Decisions

1. **Taxonomy by documentation + vocabulary types, not type renames.** Renaming `AgentSummary`→`Assistant` etc. would touch every store/service for zero behavior. Rejected alternative: full rename with deprecation aliases — cost exceeds benefit for a single-maintainer codebase. Extension point: if a rename is ever wanted, the taxonomy doc already fixes the target names.
2. **SOUL.md stays free-form; structure lives in a sidecar.** Rejected: YAML frontmatter inside SOUL.md (pollutes the prompt artifact the model reads; `readAgentSoul` consumers would need stripping logic). Rejected: making SOUL.md compiled-only/read-only (kills hand-editability). The `soulHash` staleness check is the key trick that lets both editing paths coexist.
3. **Bridge stays `Partial<AgentRoleProfile>` and optional, but becomes honored.** Tightening to required would force all 8 built-ins and every config role to author personas — busywork. Instead, Area 1 specifies (for a future implementation pass) that `compileRoleContractToSoul` appends a persona section when `profile` is present, giving the field a consumer. Migration concern: none — absent profile keeps today's output byte-identical.
4. **Role instance = descriptor over existing data, not a new store.** Rejected: a role-instance table/registry — duplicates `subagent-registry.ts` and the orchestration ledger.
5. **No channel field on RoleContract.** See §3.6.

## 8. Validation Approach

- **Round-trip property test** (Vitest): for random `AgentRoleProfile` values, `write → read` via sidecar is identity; with the sidecar deleted, `write → read` via heuristic parse preserves at least today's field set (regression guard, including the known `customStyle` drop as a documented exception until the parse gains that branch).
- **Type-drift guard**: a unit test asserting the shared and runtime `RoleContract` keysets are equal (catches future drift mechanically).
- **Registry origin test**: config override of `reviewer` reports `origin: 'config'`; fresh name reports `'config'`; untouched built-ins report `'built-in'`.
- **E2E** (per map §8 UI rule): Playwright spec asserting the RoleCard badge renders for a config-defined role.
- **Success metric**: Areas 2-5 documents can reference "Assistant / Persona / Role Contract" without re-defining them (checked in the README reconciliation).

## 9. Boundary Considerations

- **Renderer/Main boundary**: all new data flows through existing `hostApi.agents.*` and gateway `roles.list` — no new IPC surface.
- **Role permission scopes**: untouched; `RoleInstanceDescriptor` is read-only metadata and grants nothing.
- **SOUL.md write boundary**: sidecar writes happen only inside `writeAgentRoleProfile`, the same Main-process path that already owns SOUL.md; the runtime never reads the sidecar.
- **New boundary introduced**: the sidecar's `soulHash` check is itself a boundary — structured data may never override a hand-edited SOUL.md. This preserves the user's direct-edit authority.
