# Architecture Design Prompt: Role-Driven Architecture Refinement for Verse Claw / OpenClaw Runtime

## Project Identity

This is a **personal educational software development project** called **Verse Claw** (GUI) + **OpenClaw Runtime** (AI engine). It is a single-developer desktop application for learning agent-runtime architecture design. It is NOT a commercial product, SaaS, or multi-tenant system. It processes NO third-party user data. All work happens on the developer's local machine.

The purpose of this design task is to refine and clarify the **role-driven architecture** of the system. The current implementation has functional pieces in place but their relationships and boundaries are not sharply defined, which makes the system harder to reason about and extend. Your job is to produce architecture design documents that bring clarity and propose refinements — not to write implementation code.

## Your Role

You are a software architect. Your job is NOT to write implementation code. Your job is to **read the existing codebase, understand what already exists, identify real gaps and extension points, and produce architecture design documents** that extend the existing system.

## The Critical Constraint: Design ON the Real Codebase

Generic architecture proposals are worthless here. Every design decision you make must reference **specific existing modules by path**, propose changes to **specific existing interfaces**, and integrate with **specific existing data flows**.

To make this token-efficient, a **pre-computed CodeGraph orientation map** has been prepared for you. Read it FIRST, before any other exploration:

```
team/codegraph-role-architecture.md
```

This map covers the 5 areas you will design for, with verified file paths, line numbers, type definitions, data flows, maturity markers, and hard constraints. Treat it as ground truth for what exists today. Only invoke `codegraph_*` tools when you need to go deeper than the map covers.

---

## Part 0: Language and Safety Guidelines (Read Carefully)

This is a personal educational project. All design discussion must use **constructive, refinement-oriented language**. The following guidelines are mandatory:

### 0.1 Required terminology substitutions

When describing the current state of the system, use the right column instead of the left:

| Avoid | Use instead |
|-------|-------------|
| bug | gap, limitation, opportunity for refinement, uncovered area |
| defect, flaw | area for improvement, refinement opportunity |
| broken, broken design | under-defined, loosely specified, has room for sharper definition |
| vulnerability | boundary consideration, integrity consideration |
| exploit, attack | unintended use, off-spec usage |
| bypass | circumvention path, off-spec path |
| malicious | unintended, off-spec |
| reverse engineering, 逆向安全 | boundary verification, defensive boundary design |
| inject, injection (in safety context) | unsanitized input handling (only when describing actual input validation; "context injection" as in "inject memory into prompt" is fine and encouraged) |
| leak (in data context) | unintended exposure, scope overreach |
| hijack | unintended takeover |
| security hole | boundary gap |

### 0.2 Framing principles

- The existing architecture is **functional and shipped**. Your task is **refinement and clarification**, not repair.
- Describe gaps as **"refinement opportunities"** or **"areas where the design can be sharper"**, not as failures.
- When you propose changes, frame them as **"extending what exists"** or **"adding a missing layer"**, not as fixing what is broken.
- The 8 built-in roles (`planner`, `architect`, `implementer`, `tester`, `reviewer`, `security-reviewer`, `docs-writer`, `skeptic`) are **named constants in the codebase** — you may reference them by name. The name `security-reviewer` is a codebase identifier, not a safety claim; use it as-is.
- When discussing role permissions, filesystem access, network access, and tool whitelists, frame these as **"capability boundaries"** or **"permission scope design"** — these are first-class architectural concepts in the codebase, not safety incidents.

### 0.3 Forbidden topics

Do NOT discuss: prompt injection defense, adversarial model output, jailbreak resistance, red-teaming, model unalignment, data exfiltration prevention, or any topic that frames the system as defending against active adversaries. This is a single-user local educational tool. If a design decision has boundary implications, frame it as **"capability scoping"** or **"permission boundary design"** — never as defense against adversaries.

---

## Part 1: How to Explore This Codebase

### 1.1 Start with the CodeGraph map

Open `team/codegraph-role-architecture.md` and read it completely. It is organized into 10 sections:

- Section 0: Project identity
- Section 1: Three-layer architecture
- Section 2: Area A — Role/Agent identity (3 distinct concepts, types, persistence, CRUD)
- Section 3: Area B — Chat-page role/model switching (two entry points, send flow, root-cause analysis)
- Section 4: Area C — Multi-agent role routing (orchestration modes, delegation chain, session management, shortcomings)
- Section 5: Area D — Role memory system (two independent systems, binding granularity, incomplete points)
- Section 6: Area E — Knowledge-base role player (Steward config, KB↔role relationship, optimization entry points)
- Section 7: Maturity markers (production/shadow/pilot/planned)
- Section 8: Hard constraints (must respect in any design)
- Section 9: Standard dev commands
- Section 10: CodeGraph tool reference

### 1.2 When to invoke codegraph tools

The map is pre-computed and verified. Only invoke `codegraph_*` tools when:

1. You need to verify a specific function signature that the map summarizes
2. You need to trace a data flow that the map does not cover
3. You need to find an integration point that the map does not mention
4. You need to confirm the current state of a file (the map is dated 2026-07-02)

When you do invoke, use this order:
1. `codegraph_decide` first with `operationType="locate"`, `riskLevel="medium"`
2. `codegraph_context_plan` with the specific sub-topic
3. Read files selectively: type definitions (first 50-100 lines), public API surface, integration points. Skip implementation bodies unless interface is unclear.
4. Files >500 lines: read first 100 lines + type/interface definitions only.

### 1.3 Reference docs to consult per area

| Area | Doc path |
|------|----------|
| Overall design & non-goals | `docs/clawx-design-overview.md` (sections 1.1, 1.2, 7-11 most relevant) |
| Workspace rules (hard contract) | `AGENTS.md` |
| Role-first memory planning | `harness/specs/tasks/role-first-memory-*.md` (7 specs) |
| Role-first end-to-end | `harness/specs/tasks/role-first-end-to-end.md` |
| Team orchestrate tool spec | `harness/specs/tasks/role-first-team-orchestrate-tool.md` |
| Runtime memory phase plans | `harness/specs/tasks/phase-{9..36}-runtime-memory-*.md` |
| Previous architecture prompt (different scope) | `team/fable5-architecture-prompt.md` |

---

## Part 2: The Task — 5 Architecture Design Documents

For each of the 5 areas below, produce ONE architecture design document. Each document must be grounded in the existing codebase as mapped in `team/codegraph-role-architecture.md`.

### Mandatory Exploration Phase (Do This First for Each Area)

Before designing ANYTHING for an area, you MUST:

1. Read the corresponding section of `team/codegraph-role-architecture.md` carefully.
2. Identify what's already there: list every existing module that touches this area, its maturity level (production/shadow/pilot/planned), and its explicit non-goals.
3. Identify the specific refinement opportunities (use the map's "shortcomings" / "incomplete points" / "optimization entry points" subsections as starting points).
4. Only then start designing. Your design MUST extend what exists, not replace it or ignore it.

---

### Area 1: Role-Driven Architecture Definition and Identity Model

**Context from the CodeGraph map (Section 2):**

The codebase has three distinct concepts that are all called "role" in different contexts:

1. **Agent** (`AgentSummary`, `shared/types/agent.ts:3-16`) — persistent user-facing helper identity. Stored in OpenClaw config JSON + disk dirs. Has `modelRef`, `workspace`, `agentDir`, `mainSessionKey`, `channelTypes`.
2. **AgentRoleProfile** (`AgentRoleProfile`, `shared/types/agent.ts:28-39`) — single Agent's persona/character definition. Compiled via `compileRoleProfileToMarkdown` to Chinese Markdown, written to `<workspace>/SOUL.md`. Each Agent has EXACTLY ONE.
3. **RoleContract** (`RoleContract`, `shared/types/agent.ts:72-86` and `openclaw_runtime/src/agents/role-contract.ts:33-50`) — reusable role definition for multi-agent orchestration. 8 built-in roles at `role-contract.ts:230-359`. Many-to-many with Agents.

Bridges between them:
- `RoleContract.profile?: Partial<AgentRoleProfile>` (`shared/types/agent.ts:85`)
- `compileRoleContractToSoul(role)` (`role-contract.ts:207-226`)
- `spawnRoleSubagent` (`role-spawn.ts`)

The user reports that "the current role positioning is vague" and "the architecture is fuzzy". The map shows the architecture is actually fairly complete but the three concepts are not sharply distinguished in naming, UI, or documentation.

**What to explore before designing:**
- `shared/types/agent.ts` — full type definitions for all three concepts
- `electron/utils/agent-config.ts:706-822` — SOUL.md compile/parse mechanism
- `openclaw_runtime/src/agents/role-contract.ts:230-359` — 8 built-in RoleContracts
- `openclaw_runtime/src/agents/role-registry.ts` — registry resolution order
- `openclaw_runtime/src/agents/role-spawn.ts` — RoleContract→subagent mapping
- `src/components/agents/RoleProfileEditor.tsx` — UI surface for AgentRoleProfile
- `src/pages/Agents/index.tsx` — Agents page where roles are managed

**Design prompt:**

Produce an architecture design that **defines and sharpens the role-driven identity model** for this system. Consider:

- A clear conceptual taxonomy that distinguishes Agent (persistent identity), AgentRoleProfile (persona attribute), and RoleContract (orchestration role). What naming conventions, type boundaries, and documentation would make these three concepts unambiguous to future maintainers?
- The current `AgentRoleProfile` is compiled to free-form Chinese Markdown in SOUL.md (`agent-config.ts:706-738`). Should it remain free-form, or should it gain a more structured representation? What are the trade-offs for downstream consumers (RoleContract.profile, memory binding, KB binding)?
- The bridge `RoleContract.profile?: Partial<AgentRoleProfile>` is optional and loosely typed. Should this be tightened? What would a stronger binding look like, and what migration concerns arise?
- The 8 built-in RoleContracts are hardcoded constants. The config path `cfg.agents.roles[]` allows overrides/extensions. Is this the right model for user-extensible roles, or should there be a clearer "built-in vs user-defined" split?
- How should the system represent a "role instance" — the concrete realization of a RoleContract bound to a specific Agent at orchestration time? Is `subagentRole` (written by `patchChildSession` in `subagent-spawn.ts`) sufficient, or is a richer concept needed?
- What is the relationship between "role" and "channel" (`AgentSummary.channelTypes`)? Can a role be channel-specific, or is channel binding always at the Agent level?

**Key constraint:** Do NOT propose merging the three concepts into one. They serve different lifecycles (persistent identity vs persona vs orchestration role). Your design must sharpen the boundaries, not erase them. Respect the existing SOUL.md compilation mechanism — it is production code.

---

### Area 2: Chat-Page Role/Model Switching Separation

**Context from the CodeGraph map (Section 3):**

The chat page (`src/pages/Chat/index.tsx`) currently conflates role switching and model switching:

- **Role switch** (`handleSwitchAgent`, `index.tsx:872-911`) switches `sessionKey` (`agent:<agentId>:<sessionId>`), which switches to another agent's session history + another agent's config (including its model).
- **Model switch** (`handleSelectModel`, `ChatInput.tsx:1333-1355`) calls `updateAgentModel(currentAgent.id, desiredOverride)` — writes to the current Agent's `modelRef` field. It does NOT support "send this message with model X" or "use model X for this session only".
- `sendMessage` signature (`runtime-send-actions.ts:71-80`) has NO `modelRef` parameter. `hostApi.chat.sendWithMedia` input has NO `modelRef` field.
- The Workspace Actions menu shows each agent row with `agent.name` + `agent.modelDisplay` together (`ChatInput.tsx:2546-2547`), reinforcing "select role = select a config bundle including model".

The user reports: "在对话页面切换角色而不是模型" (switching roles instead of models on the chat page).

**What to explore before designing:**
- `src/pages/Chat/index.tsx:872-911` — `handleSwitchAgent`
- `src/pages/Chat/ChatInput.tsx:2525-2554` — Workspace Actions agent switch UI
- `src/pages/Chat/ChatInput.tsx:2560-2604` — @ Agent Picker (single-message target)
- `src/pages/Chat/ChatInput.tsx:2888-2943` — Model Picker
- `src/pages/Chat/ChatInput.tsx:1333-1355` — `handleSelectModel`
- `src/stores/chat/runtime-send-actions.ts:71-270` — `sendMessage` flow
- `src/stores/agents.ts:85-89` — `updateAgentModel` action
- `electron/services/chat-api.ts` — `chat.sendWithMedia` main-side handler
- `shared/host-api/contract.ts` — chat namespace contract

**Design prompt:**

Produce an architecture design that **separates role switching from model switching on the chat page**, giving the user independent control over both. Consider:

- The current model picker writes to `Agent.modelRef` (persistent). Should there be a new "session-level model override" or "message-level model override" concept? What are the trade-offs?
- `sendMessage` and `hostApi.chat.sendWithMedia` would need a new optional `modelRef` parameter. How should this flow through the Main process to the OpenClaw Runtime? Should it become a per-turn override in the `agent` gateway method, or a session-level setting?
- The Workspace Actions menu currently bundles agent + model display. Should the UI be split into two separate selectors (role picker + model picker), or kept bundled with an explicit "use a different model for this message" affordance?
- The @ Agent Picker (`ChatInput.tsx:2560-2604`) already supports single-message target agent. Could a similar "single-message model override" pattern be added? How would it interact with the @ Agent Picker (does model override apply to the target agent or the current agent)?
- What happens to the session transcript when a one-off model override is used? Is the model choice recorded per-message for later inspection, or is it ephemeral?
- Sidebar grouping (`Sidebar.tsx`) is by workspace or time, not by role or model. If role/model switching becomes more flexible, should the sidebar gain a "by role" or "by model" grouping mode?

**Key constraint:** The `agent:<agentId>:<sessionId>` sessionKey format is a hard invariant — it's parsed in many places (see Section 3.3 of the CodeGraph map). Do NOT propose changing the sessionKey format. The model override must layer ON TOP of the existing sessionKey routing, not replace it. Respect the existing `Agent.modelRef` persistence — it remains the default; your design adds override paths above it.

---

### Area 3: Multi-Agent Role Routing Strategy Design

**Context from the CodeGraph map (Section 4):**

Multi-agent orchestration already exists with significant planning:

- 3 orchestration modes: `router` / `lead-workers` / `adversarial-review` (`role-router.ts`)
- 8 built-in RoleContracts (`role-contract.ts:230-359`)
- 3 team templates: quick-development / security-audit / refactor (`team-template.ts`)
- `createOrchestratorPlan` priority: explicit workers → team template → role-router (`orchestrator.ts`)
- Task Graph + Execution Waves for parallelism (`orchestrator-run-observed.ts`)
- Role Contract hard execution: tool hard whitelist + permission hard deny (`role-spawn.ts`)
- Failure repair: `buildRepairNodes` + `buildRerouteRecommendations`
- Observability: trace spans (orchestrator / role-router / subagent / verifier)

But there are real refinement opportunities:

- `bounded_a2a` is force-disabled (`team-orchestrate-tool.ts:178`); workers cannot communicate directly, all merging transits Lead
- Lead synthesis relies on LLM self-judgment based on Team Result Bundle events; no structured synthesis strategy
- Routing only by keyword match (`ROLE_KEYWORDS`); +2/+1 score heuristic; no ML/embedding routing
- No cross-run routing reuse; re-routes every time
- `orchestrator.run` requires approval (`workspace-permissions.ts:73-74`) — operator UI trigger limited
- Keywords only cover CN/EN

The user reports: "多agent协作之后的角色路由也没有很好的规划" (role routing after multi-agent collaboration is not well planned).

**What to explore before designing:**
- `openclaw_runtime/src/agents/role-router.ts` — `ROLE_KEYWORDS`, `resolveMode`, scoring logic
- `openclaw_runtime/src/agents/orchestrator.ts` — `createOrchestratorPlan` priority chain
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts` — `runOrchestrationObserved`
- `openclaw_runtime/src/agents/orchestration-protocol.ts` — quality/repair/communication policies
- `openclaw_runtime/src/agents/team-template.ts` — 3 built-in templates
- `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:125-281` — `team_orchestrate` tool
- `openclaw_runtime/src/agents/role-spawn.ts` — `spawnRoleSubagent`
- `openclaw_runtime/src/agents/subagent-spawn.ts` — `spawnSubagentDirect`
- `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts:224-514` — RPC methods
- `electron/services/workspace-permissions.ts:60-122` — SAFE / MUTATING patterns

**Design prompt:**

Produce an architecture design that **refines the multi-agent role routing strategy** to address the refinement opportunities above. Consider:

- The current keyword-based routing (`ROLE_KEYWORDS` + scoring) is a +2/+1 heuristic. Should it be augmented with embedding-based routing, structured task features, or a learned routing policy? What pilot/shadow evaluation would prove a new routing strategy is safe before promotion?
- `bounded_a2a` is force-disabled but the type exists. Should it remain disabled, be promoted to a pilot, or be removed? What would a controlled pilot look like (gates, rollback, telemetry)?
- Lead synthesis relies on LLM self-judgment. Should there be a structured synthesis template (e.g., per-role output schema → merger template)? How would this interact with the existing `RoleOutputSchema` (`shared/types/agent.ts:59-63`)?
- There is no cross-run routing reuse. Should routing decisions be cached, learned from, or federated across sessions? What are the privacy and freshness implications for a single-user local app?
- `orchestrator.run` requires approval. Should there be a "trusted orchestration preset" concept that pre-approves specific role combinations for specific workspaces, reducing approval friction without weakening the boundary?
- The 3 team templates are hardcoded. Should users be able to define custom team templates? Where would they live (config file, UI, KB)?
- The 8 built-in roles cover software development. Should the role registry gain domain-specific role packs (writing, research, data analysis)? How would these be authored, validated, and registered?

**Key constraint:** Do NOT propose removing the `orchestrator.run` approval gate (`workspace-permissions.ts:73-74`) — it is an intentional boundary. Your design may reduce friction (e.g., trusted presets) but must preserve the gate. Do NOT propose enabling `bounded_a2a` by default — if you propose a pilot, follow the project's pilot promotion pattern (fresh spec, explicit operator gate, default-off start, disable-only rollback, no schema change, rollback plan).

---

### Area 4: Role Memory System Completion

**Context from the CodeGraph map (Section 5):**

The codebase has TWO independent memory systems:

1. **Role Memory** (`openclaw_runtime/src/memory/`) — long-term role persona / playbook / project facts. Backed by `role-memory.sqlite`. Has full UI (Settings > Role Memory + `RolesOrchestrationPanel.tsx`). Multi-role binding model: `roleTags` + `ownerRole` + `sourceRole` + `applicableRoles` + `allowedMutators`. Has governance policy (`memory-policy.ts`). NO evaluation system.

2. **Runtime Memory** (`openclaw_runtime/src/runtime-core/memory-*.ts`) — intra-session temporal facts / episodes / relation graph. Backed by `openclaw.sqlite` state DB. Has complete evaluation system (L1-L9 + CV1-CV5 + 50+ tests + 36 phase specs). Currently **default-off + shadow-only** in production (`task-loop-controller.ts:2001`).

Refinement opportunities (from CodeGraph map Section 5.5):

1. Runtime Memory not actually wired into production — role conversations do NOT inject memory facts into LLM context
2. UserProfile layer (`memory-user-profile.ts`) not in production; v1/v2 experiments both lowered open_domain score
3. Embedding default off (`settings.ts:81` `memoryEmbeddingEnabled: false`)
4. host-api lacks dedicated memory methods — all `memory.*` go through generic gateway RPC, no type safety
5. role-memory and runtime-memory systems split — they do NOT share retrieval/injection pipeline
6. Multi-hop retrieval failure: multi_hop Recall@5 = 17.32%
7. Low extraction density: 0.3 facts/turn (target 1.0+)

The user reports: "针对现在角色的记忆系统也没有完善" (role memory system not complete).

**What to explore before designing:**
- `shared/types/memory.ts` — `MemoryCard`, `MemoryCardScope`, `ContextPack` types
- `openclaw_runtime/src/memory/memory-store.ts` — `role-memory.sqlite` schema, `getMemoryCards`, `buildContextPack`
- `openclaw_runtime/src/memory/memory-policy.ts` — `SCOPE_IMPACT`, `RETENTION_TYPE_WEIGHT`, role inference
- `openclaw_runtime/src/runtime-core/memory-store.ts` — `RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts` — persistence layer
- `openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts` — `HybridSearchIndex` (BM25 + 3-gram TF-IDF + RRF)
- `openclaw_runtime/src/runtime-core/memory-user-profile.ts` — `UserProfile` 5 dimensions
- `openclaw_runtime/src/runtime-core/memory-profile-retrieval.ts` — `openDomainRetrieval`
- `openclaw_runtime/src/runtime-core/memory-chained-retrieval.ts` — chained retrieval
- `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts` — extraction prompt
- `openclaw_runtime/src/context-engine/memory-context-provider.ts` — `RUNTIME_MEMORY_CONTEXT_PROVIDER_ID`
- `openclaw_runtime/src/agents/task-loop-controller.ts:2001-3026` — shadow integration
- `src/stores/settings.ts:25,80-81` — `roleMemoryEnabled`, `memoryEmbeddingEnabled`
- `src/components/agents/RolesOrchestrationPanel.tsx` — Role Memory UI
- `shared/host-api/contract.ts:215-216` — host-api contract (only 2 boolean fields)
- `harness/specs/tasks/role-first-memory-*.md` — 7 planning specs
- `harness/specs/tasks/phase-{9..36}-runtime-memory-*.md` — 36 phase plans

**Design prompt:**

Produce an architecture design that **completes the role memory system** by addressing the refinement opportunities above. Consider:

- The two memory systems (Role Memory + Runtime Memory) have complementary strengths (Role Memory has UI + governance; Runtime Memory has eval + retrieval). Should they be unified, federated, or kept split with a bridge? What does each option cost?
- Runtime Memory is shadow-only in production. What is the promotion path to active production use? Follow the project's pilot pattern (fresh spec, explicit operator gate, default-off start, disable-only rollback, no schema change, rollback plan). What specific gates must be satisfied?
- `host-api` lacks dedicated memory methods (`contract.ts:215-216` only has 2 booleans). Should the contract gain typed methods for `memory.list / memory.propose / memory.update / memory.search / memory.health`? How would this interact with the existing `hostApi.gateway.rpc('memory.*', ...)` calls in `RolesOrchestrationPanel.tsx`?
- The UserProfile layer experiments failed (v1 dropped open_domain 53.54%→47.24%, v2 dropped to 51.18%). Should it be revised, deferred, or removed? If revised, what design changes might overcome the failure mode (profile context adding noise)?
- Multi-hop retrieval failure (Recall@5 = 17.32%). The chained retrieval score decays too fast. Should the decay function be revised, or should a different multi-hop strategy be used (e.g., iterative query rewriting, sub-question decomposition)?
- Low extraction density (0.3 facts/turn). The extraction prompt has single few-shot, no schema constraint, no negative examples, chunk_size=100 too large. Should these be revised? What evaluation would prove a new extraction prompt is safe?
- The Role Memory UI (`RolesOrchestrationPanel.tsx`) is rich but only on the Agents page. Should memory surfaces be exposed in the chat page (e.g., "what does this role remember about this conversation")? What are the UX trade-offs?

**Key constraint:** Do NOT propose deleting either memory system. Both have valuable assets (Role Memory: UI + governance; Runtime Memory: eval + retrieval). Your design must preserve both or merge them with explicit migration. Respect the existing pilot pattern for any shadow→active promotion. The `role-memory.sqlite` schema is production code — any schema change must be additive (ALTER TABLE) with a migration plan.

---

### Area 5: Knowledge-Base Role Player Optimization

**Context from the CodeGraph map (Section 6):**

The Knowledge Hub (`src/pages/Knowledge/index.tsx`) is a wiki-style KB built on OpenClaw Runtime's memory-wiki plugin. NOT vector RAG — it's compile-style wiki + provenance tracking. Persistence is JSON/JSONL files (no DB, no vector index).

The KB has ONE fixed role: `knowledge-steward` (`knowledge-api.ts:191-208`):

```typescript
const DEFAULT_STEWARD_CONFIG: KnowledgeStewardConfig = {
  enabled: true,
  roleId: 'knowledge-steward',
  capabilities: {
    canSearch: true, canRead: true, canProposeDraft: true,
    canClassify: true, canSuggestMerge: true, canSuggestArchive: true,
    canApplyDirectly: false,   // never write directly
  },
  scope: { workspace: true, agent: false, global: false },
};
```

Refinement opportunities (from CodeGraph map Section 6.8):

1. `DEFAULT_STEWARD_CONFIG` is hardcoded; roleId fixed; capabilities/scope not configurable
2. `classifyDraft` + `stewardReviewDraft` use regex keyword classification (CN/EN hardcoded), no model involvement
3. `knowledge-steward` is NOT registered in `BUILT_IN_ROLE_CONTRACTS` (`role-contract.ts:230-359`) — it can't access role-spawn's tool whitelist, model binding, effort, permissions
4. `chat-api.ts:128-220` KB injection only injects "reference body + metadata"; does not bring steward's review conclusions/warnings into conversation context
5. KB data entry `agentId` field (`contract.ts:2308-2319`) only used for scope filtering, not linked to `BUILT_IN_ROLE_CONTRACTS` role name

The user reports: "知识库中角色的扮演者也需要进一步优化" (knowledge-base role players need optimization).

**What to explore before designing:**
- `electron/services/knowledge-api.ts:191-208` — `DEFAULT_STEWARD_CONFIG`
- `electron/services/knowledge-api.ts:615-658` — `classifyDraft` + `stewardReviewDraft`
- `electron/services/knowledge-api.ts:2021-2045` — `stewardReview` host route
- `shared/host-api/contract.ts:2290-2307` — `KnowledgeStewardConfig` type
- `openclaw_runtime/src/agents/role-contract.ts:230-359` — `BUILT_IN_ROLE_CONTRACTS` (steward NOT here)
- `openclaw_runtime/src/agents/role-spawn.ts` — `spawnRoleSubagent` (steward can't use this)
- `electron/services/chat-api.ts:128-220` — KB injection path (`applyKnowledgeMetadata`, `readSelectedKnowledgeReferences`, `applyKnowledgeReadCitations`)
- `src/pages/Chat/ChatInput.tsx:138-150` — KB slash commands (`/steward`, `/steward-audit`)
- `src/pages/Knowledge/index.tsx:633-658` — "Ask Steward" button
- `shared/i18n/locales/en/agents.json:151-218` — Role Memory i18n (for steward i18n patterns)

**Design prompt:**

Produce an architecture design that **optimizes the knowledge-base role player** (the Knowledge Steward and any future KB-bound roles). Consider:

- The current Steward is a fixed hardcoded config. Should it become config-driven, allowing multiple steward variants (e.g., `knowledge-steward`, `knowledge-curator`, `knowledge-critic`)? Where would this config live (OpenClaw config, KB-local config, electron-store)?
- The Steward is NOT in `BUILT_IN_ROLE_CONTRACTS`. Should it be registered there to gain role-spawn capabilities (tool whitelist, model binding, effort, permissions)? What capabilities should a `knowledge-steward` RoleContract have? Or should the KB define its own role registry separate from `BUILT_IN_ROLE_CONTRACTS`?
- The Steward's classification is regex-based. Should it integrate an LLM for semantic classification? What evaluation would prove this is safe? How would the existing `/steward` and `/steward-audit` slash commands change?
- The KB injection path (`chat-api.ts:128-220`) only injects reference body + metadata. Should the Steward's review conclusions, warnings, and "suggest merge/archive" opinions be injected into conversation context when relevant? What is the right shape for this injection (metadata block, separate context provider, something else)?
- The KB data entry `agentId` field is only used for scope filtering. Should it be linked to `BUILT_IN_ROLE_CONTRACTS` role names, enabling "each role binds to an independent KB slice"? What does this imply for KB organization (per-role namespaces, per-role vaults, per-role access control)?
- The KB has 5 workbench tabs (`library / inbox / drafts / review / governance`). Should the Steward surface its work in a dedicated tab, or integrate into the existing tabs? How does the Steward's work relate to the `governance` tab?
- Should users be able to define custom KB-bound roles (e.g., "research librarian", "code examples curator")? How would these be authored, validated, and registered?

**Key constraint:** The KB is explicitly NOT a vector RAG system, NOT an Obsidian clone, NOT an autonomous agent writer (per `docs/clawx-design-overview.md` section 1.2). Your design must respect these non-goals. The `canApplyDirectly: false` capability is an intentional boundary — the Steward must never write to the wiki directly; all writes pass through user review. Do NOT propose removing this boundary. The KB's JSON/JSONL persistence is a hard constraint — do NOT propose introducing a vector database or new DB.

---

## Part 3: Deliverable Format

For each of the 5 areas, produce ONE file containing the architecture design. Use this structure:

```markdown
# Area [N]. [Area Name]

## Exploration Log

Briefly document what you explored before designing:
- CodeGraph map sections read (which sections of `team/codegraph-role-architecture.md`)
- CodeGraph tool invocations (if any — list tool name and query)
- Files read beyond the map (list actual paths and what you learned from each)
- Existing modules found (list with maturity: production/shadow/pilot/planned)
- Refinement opportunities identified (from map + your exploration)
- Non-goals and constraints identified

## 1. Current State Summary

- What the existing system CAN do in this area (with specific module references and line numbers)
- What the existing system CANNOT do (the specific gap this design addresses)
- Why this gap matters for a personal agent platform
- Which existing non-goals must be respected

## 2. Architecture Overview

ASCII component diagram showing:
- Existing modules (marked [EXISTING]) on the left
- New components (marked [NEW]) on the right
- Data flow arrows between them

## 3. Component Specifications

For each NEW component:
- Responsibility (one paragraph)
- Interfaces (TypeScript-like type definitions for inputs/outputs)
- Internal state (what it owns, what it delegates)
- Lifecycle (creation, operation, teardown)
- Error handling strategy

## 4. Integration Plan

Table format:

| Existing Module | Change Required | Rationale |
|-----------------|-----------------|-----------|
| path/to/module.ts | New interface X on class Y | Why this module needs to change |

Mark modules that need NO change as well — this is equally important.

## 5. Data Flow

Walk through one complete scenario end-to-end, naming specific modules at each step.

## 6. Migration Path

If the design involves promoting shadow → active or pilot → production:
- What gates must be satisfied before promotion
- What the rollback plan is
- What telemetry to collect during shadow phase

If the design is purely additive (no shadow/pilot promotion needed), explain why.

## 7. Design Decisions

For each major architectural choice:
- The decision and why
- Alternatives considered and why rejected
- Future extension points left open

## 8. Validation Approach

How would you verify this architecture works? What experiments would you run? What metrics would prove success or failure?

## 9. Boundary Considerations

For each capability boundary this design touches (permission scopes, write boundaries, approval gates, capability whitelists):
- What boundary is affected
- How the design preserves the boundary's intent
- What new boundaries the design introduces (if any)
```

**Output file locations:**

Place each area's design document at:
- `team/role-architecture-design/area-1-identity-model.md`
- `team/role-architecture-design/area-2-chat-role-model-switch.md`
- `team/role-architecture-design/area-3-multi-agent-routing.md`
- `team/role-architecture-design/area-4-role-memory-completion.md`
- `team/role-architecture-design/area-5-kb-role-player.md`

Plus a top-level index at `team/role-architecture-design/README.md` that:
- Lists all 5 areas with one-paragraph summaries
- Calls out cross-area dependencies (e.g., Area 4 depends on Area 1's identity model)
- Identifies the recommended implementation order with rationale
- Calls out any cross-area inconsistencies the architect noticed

---

## Part 4: Working Methodology

### 4.1 Token Efficiency with CodeGraph

The CodeGraph map (`team/codegraph-role-architecture.md`) is your pre-computed orientation. Use it as the primary source. Only invoke `codegraph_*` tools when:

1. The map's summary is insufficient for your design decision
2. You need to verify a function signature or data flow the map only sketches
3. You need to find an integration point the map does not mention
4. You need to confirm the current state of a file (the map is dated 2026-07-02)

When you do invoke:
1. `codegraph_decide` first — always. It tells you whether CodeGraph navigation will help and what freshness mode to use.
2. `codegraph_context_plan` second — it builds a prioritized reading list. Trust its priority scores: files above 80 are must-read, 60-80 are useful, below 60 can be deferred.
3. Read files selectively — read the type definitions (usually first 50-100 lines), the public API surface (class declarations, exported functions), and integration points (imports from other subsystems). Skip implementation bodies unless the interface is unclear.
4. `codegraph_search` for specific symbols when the context plan mentions a symbol you haven't found yet.
5. `codegraph_find_flow` for understanding how data moves through a pipeline.

### 4.2 Quality Standards

- Every design MUST reference at least 3 existing modules by path (from the CodeGraph map or your own exploration).
- Every design MUST identify at least 1 explicit non-goal it respects (from `docs/clawx-design-overview.md` section 1.2 or `team/codegraph-role-architecture.md` Section 8).
- Every design MUST distinguish between production/shadow/pilot/planned components (per `team/codegraph-role-architecture.md` Section 7).
- Every design MUST propose a shadow-first evaluation phase before active deployment, following the project's existing pilot pattern, IF the design involves promoting shadow → active.
- If the design proposes changing a module larger than 20KB, it MUST explain why the change is additive (not a rewrite).
- Every design MUST use the language guidelines in Part 0 — constructive, refinement-oriented, no adversarial framing.

### 4.3 Cross-Area Consistency

The 5 areas have dependencies:

- Area 1 (identity model) is foundational — Areas 2, 3, 4, 5 all reference it
- Area 2 (chat switching) depends on Area 1's identity distinction
- Area 3 (multi-agent routing) depends on Area 1's RoleContract concept
- Area 4 (role memory) depends on Area 1's identity model and references Area 3's role spawning
- Area 5 (KB role player) depends on Area 1's RoleContract concept and may reference Area 4's memory binding

After completing all 5 individual designs, produce the index (`README.md`) that explicitly reconciles any cross-area inconsistencies. If Area 1 proposes a refinement to `RoleContract` that Area 3 also touches, the README must explain how they compose.

### 4.4 Order of Work

Recommended order (you may deviate with justification):

1. Area 1 (identity model) — foundational, do first
2. Area 4 (role memory) — depends heavily on Area 1, also large
3. Area 3 (multi-agent routing) — depends on Area 1, has its own depth
4. Area 5 (KB role player) — depends on Areas 1 and 4
5. Area 2 (chat switching) — most UI-focused, depends on Area 1
6. Index (`README.md`) — last, reconciles cross-area

---

## Part 5: What NOT to Do

- Do NOT write implementation code. Architecture design documents only.
- Do NOT propose replacing the three-layer architecture (Renderer/Main/Runtime).
- Do NOT propose changing the `agent:<agentId>:<sessionId>` sessionKey format.
- Do NOT propose removing the `orchestrator.run` approval gate.
- Do NOT propose enabling `bounded_a2a` by default.
- Do NOT propose deleting either memory system.
- Do NOT propose introducing a vector database or new DB for the KB.
- Do NOT propose removing the `canApplyDirectly: false` Steward boundary.
- Do NOT use adversarial-framing language (see Part 0).
- Do NOT ignore the CodeGraph map — it is your ground truth.
- Do NOT design features that contradict `docs/clawx-design-overview.md` section 1.2 non-goals.

---

## Part 6: Remember

This is a personal educational project. You are designing architecture for learning purposes — to bring clarity to a system that has functional but loosely-defined role concepts, and to identify refinement opportunities that a future implementation phase could pursue. The value is in the architectural thinking and the precise mapping of design decisions to existing code, not in shipping code.

Design ON the real codebase. Design WITH the existing patterns. Design FOR the actual refinement opportunities identified in the CodeGraph map.

The CodeGraph map is at `team/codegraph-role-architecture.md`. Start there.
