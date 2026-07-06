# Role-Driven Architecture Refinement — Design Index

> Verse Claw (GUI) + OpenClaw Runtime (AI engine). Personal educational project; single-developer desktop app. These five documents refine and clarify the role-driven architecture on the real codebase, grounded in `team/codegraph-role-architecture.md` (verified 2026-07-02). Design documents only — no implementation code.

## The 5 Areas

### [Area 1 — Role Identity Model](area-1-identity-model.md)

Sharpens the three concepts currently all called "role": **Assistant** (`AgentSummary` — persistent identity), **Persona** (`AgentRoleProfile` — 1:1 attribute compiled to SOUL.md), **Role Contract** (`RoleContract` — reusable orchestration library item). Delivers a canonical taxonomy doc + vocabulary types (`RoleIdentityKind`, `RoleOrigin`, `RoleInstanceDescriptor`), reunifies the drifted shared/runtime `RoleContract` declarations, makes the Persona round-trip lossless via a `role-profile.json` sidecar (SOUL.md stays free-form and hand-editable), surfaces built-in vs config role origin, and names the "role instance" as a descriptor over the existing `roleInstanceId`/`subagentRole`/`childSessionKey` triple. Channel binding stays Assistant-level by explicit decision. Purely additive.

### [Area 2 — Chat Role/Model Switching Separation](area-2-chat-role-model-switch.md)

Separates "switch Assistant" from "switch model" with a three-tier model override: **turn** (new `modelRef` on the send path, landing on the runtime's *existing* `request.model` override in `agent.ts:1111`), **session** (exposing the runtime's *existing* `SessionEntry.modelOverride`), and **persistent** (today's `updateAgentModel`, now honestly labeled). Per-message model provenance is recorded in transcript metadata. The sessionKey format and `Agent.modelRef` default are untouched. Key discovery: both override layers already exist runtime-side; the work is transport + UI. Purely additive.

### [Area 3 — Multi-Agent Role Routing Strategy](area-3-multi-agent-routing.md)

Refines routing with single-user-scale mechanisms rather than ML: a **Routing Memo Store** (workspace JSONL recording plan→outcome, feeding a bounded ±2 signal back into `scoreRole`, shadow-first), a **Structured Synthesis Contract** assembled from workers' existing `outputSchema.sections` so Lead synthesis has a deterministic shape, **Trusted Orchestration Presets** (workspace-scoped standing approvals checked inside the existing `gateway-api.ts` approval path — the `orchestrator.run` gate itself is untouched), **handoff-artifact injection** along existing graph `handoff` edges instead of a `bounded_a2a` pilot (which stays disabled), and **role packs** as documented config examples plus an optional `routingKeywords` contract field (custom teams via `cfg.agents.teams` already work — the gap was packaging).

### [Area 4 — Role Memory System Completion](area-4-role-memory-completion.md)

**Federates** the two memory systems at the context-provider seam instead of merging stores: Role Memory's `buildContextPack` gets exposed as a new `RoleMemoryContextProvider`, peer of the existing (unwired) `runtime-memory` provider; a single `runtimeMemory.injectPilot` operator gate wires both into ordinary chat turns — Role Memory first (governed, production-proven for subagents), Runtime Memory only after its quality gates pass (extraction density ≥1.0, multi_hop Recall@5 ≥40% via sub-question decomposition, maturity ≥0.7). Adds a typed `hostApi.memory.*` facade over the existing gateway RPCs, a Role Memory eval pack (closing the governance-without-evaluation gap), and a read-only "memory used this turn" chat disclosure. UserProfile is deferred with explicit re-entry conditions. Both stores, both schemas preserved.

### [Area 5 — Knowledge-Base Role Player Optimization](area-5-kb-role-player.md)

Turns the Steward from a hardcoded regex constant into a **config-driven KB role registry** (`knowledge/steward-roles.json`, variants like curator/critic, all under the same literal-`false` apply ceiling), adds an opt-in **semantic review pass** by registering `knowledge-steward` as a **config-defined RoleContract** (not a built-in — keeping it out of dev orchestration routing) so it gains role-spawn's mechanical tool/permission enforcement (`tools: ['read']`, network none), lets the Steward **speak in conversation** via a third persisted-state metadata block beside the existing two in `chat-api.ts`, and shapes role↔KB relevance with an additive `roleTags` field (deliberately NOT overloading `agentId`, and explicitly ranking-only — no per-role ACLs). Steward work surfaces in the existing `review` tab. `canApplyDirectly: false` and JSON/JSONL persistence untouched.

## Cross-Area Dependencies

```
Area 1 (identity taxonomy)
  ├─► Area 2: "switch Assistant ≠ switch model" is the taxonomy applied to the chat page;
  │           Workspace Actions labeling uses Area 1's Assistant/Persona vocabulary.
  ├─► Area 3: RoleContract gains `routingKeywords` — an Area 1 §3.2 unified-type field;
  │           RoleInstanceDescriptor's roleInstanceId is Area 3's ledger id, surfaced.
  ├─► Area 4: RoleMemoryContextProvider.resolveRoleName maps a turn to role identity
  │           using Area 1's taxonomy (Assistant persona role vs RoleContract name).
  └─► Area 5: the "steward as config RoleContract, not built-in" decision and the
              "don't overload agentId with role names" decision are both direct
              applications of Area 1's type boundaries.

Area 3 ──► Area 4: role-spawned workers are where Role Memory injection is already
                    production; Area 4's pilot deliberately scopes to main sessions
                    to avoid double-injection with Area 3's spawn path.
Area 4 ──► Area 5: `roleTags` on KB entries reuses Role Memory's binding vocabulary
                    (MemoryCard.roleTags) so "role-scoped" means one thing in both.
Area 3 ──► Area 5: the steward RoleContract rides Area 3's role-pack convention
                    (config-defined roles as documented bundles).
```

## Recommended Implementation Order

1. **Area 1** — foundational and cheapest (types, docs, sidecar, origin badge). Every other area references its vocabulary; the `RoleContract` type unification must land before Area 3's `routingKeywords` and Area 5's steward contract.
2. **Area 2** — self-contained, high user-visible value, purely additive, and it exercises the send-path comms checklist early. Depends on Area 1 only for labeling vocabulary.
3. **Area 4 facade + Role Memory provider + eval pack** — the federation seam and typed memory API; hold the injection pilot flag off until the Role Memory eval pack is green.
4. **Area 3** — synthesis contract and presets first (additive), routing-memo shadow next (needs ≥20 runs of shadow data, so start it early relative to when you want it active).
5. **Area 5** — steward registry + notes injection (additive) any time after Area 1; the semantic pass last, since it depends on the role-pack convention (Area 3) and benefits from Area 4's injection learnings.
6. Runtime Memory injection promotion (Area 4's second provider) — last, gated on its quality workstreams.

Rationale: additive-and-visible work front-loads value; the two shadow pilots (routing memos, semantic steward) and the injection pilot need calendar time to accumulate evaluation data, so their *infrastructure* ships early while their *activation* comes late.

## Cross-Area Reconciliations (inconsistencies noticed and resolved)

1. **`RoleContract` is touched by Areas 1, 3, and 5.** Composition: Area 1 unifies the shared/runtime declarations and adds `profile` runtime-side; Area 3 adds optional `routingKeywords`; Area 5 authors one config *instance* (the steward). All three are additive optional fields / data entries on the same normalized type — no conflict, but Area 1's unification should merge first so the others edit one declaration, not two.
2. **Two injection pipelines meet in the prompt.** Area 4 injects memory (runtime-side context providers); Area 5 injects KB metadata + steward notes (Main-side message blocks). These are deliberately different layers per existing ownership (memory is runtime-owned; Knowledge Hub is a Verse Claw product layer). Reconciliation: each has its own token cap (`injectPilot.totalTokenBudget` vs `CONTEXT_FRAGMENT_LIMITS`), and neither reads the other's budget. Acceptable for now; a unified prompt-budget ledger across both layers is flagged as future work.
3. **"Role name" resolution for a main-agent chat turn.** Area 4's provider needs a role name for `getMemoryCards({ roleName })`; Area 1 defines the taxonomy but a main chat turn has a Persona, not a RoleContract. Resolution adopted in Area 4: main turns resolve to `'main'` (or a persona-derived name) — this mapping is the one place the Persona↔RoleContract bridge (`RoleContract.profile`) may eventually earn a real consumer; noted as an extension point in both docs.
4. **Approval-friction mechanisms.** Area 3's presets (orchestration) and Area 4's pilot flag (injection) are both "reduce ceremony without weakening a gate" patterns but intentionally different: presets are *user-granted standing approvals* in Main; the pilot flag is an *operator gate* in runtime config. They should not be merged — they guard different boundaries.
5. **Shadow-evaluation pattern reuse.** Areas 3, 4, and 5 each propose a shadow phase (routing memos, injection pilot, semantic steward). All three follow the same project pilot pattern (fresh spec, operator gate, default-off, disable-only rollback, no schema change) — spec names are proposed in each doc under `harness/specs/tasks/`.

## Constraints Honored Across All Areas

- Three-layer architecture, sessionKey format, transport policy, Renderer/Main boundary — untouched everywhere.
- `orchestrator.run` approval gate preserved (Area 3); `bounded_a2a` stays disabled (Area 3); both memory systems preserved (Area 4); no vector DB and `canApplyDirectly: false` preserved (Area 5); SOUL.md compilation preserved (Area 1); `Agent.modelRef` remains the default model tier (Area 2).
- Every schema/contract change proposed is additive; every promotion follows the pilot pattern; every UI change carries the i18n (en/zh/ja/ru) and Playwright E2E obligations from the workspace rules.
