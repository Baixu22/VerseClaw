# Architecture Design Prompt: 6-Dimensional Enhancement Plan for Verse Claw / OpenClaw Runtime

## Project Identity

This is a **personal educational software development project** called **Verse Claw** (GUI) + **OpenClaw Runtime** (AI engine). It is a single-developer desktop application for learning agent-runtime architecture design. It is NOT a commercial product, SaaS, or multi-tenant system. It processes NO third-party user data. All work happens on the developer's local machine.

## Your Role

You are a software architect. Your job is NOT to write implementation code. Your job is to **read the existing codebase, understand what already exists, identify real gaps and extension points, and produce architecture design documents** that extend the existing system.

## The Critical Constraint: Design ON the Real Codebase

Generic architecture proposals are worthless here. Every design decision you make must reference **specific existing modules by path**, propose changes to **specific existing interfaces**, and integrate with **specific existing data flows**. If you don't know whether something already exists, use the CodeGraph exploration tools to find out BEFORE designing.

---

## Part 0: How to Explore This Codebase

### The Architecture at a Glance

The repo has three layers connected by JSON-RPC:

```
Renderer (React 19, Vite)  --IPC-->  Main Process (Electron)  --WS/HTTP-->  OpenClaw Runtime (Node.js, port 18789)
```

- **Renderer** (`src/`): HashRouter pages, zustand stores, host-api client. NEVER calls runtime directly.
- **Main Process** (`electron/`): Window, tray, 35 host-api service modules, gateway child-process manager, sandbox policy resolver.
- **Runtime** (`openclaw_runtime/`): 4,333 source files across 60+ sub-domains, 136 bundled extensions, owns ALL AI logic.

The three layers share type contracts under `shared/` — `shared/host-api/contract.ts` (110KB), `shared/types/*.ts`.

### Key Subsystems Already in Place

**Agent Control Plane** (`openclaw_runtime/src/acp/`):
- `control-plane/manager.core.ts` (21KB): `AcpSessionManager` — session lifecycle, turn runner, runtime handles
- `control-plane/spawn.ts`: sub-agent session spawning
- `control-plane/manager.runtime-resume-state.ts`: stale-session recovery
- `session-actor-queue.ts`: per-session turn ordering
- `translator.ts` (57KB): ACP protocol translation layer
- `event-ledger.ts` (29KB): event tracking for ACP

**Runtime Core** (`openclaw_runtime/src/runtime-core/`):
- Memory system (19 files): `memory-store.ts` (51KB), `memory-hybrid-retrieval.ts`, `memory-background-consolidation.ts`, `memory-self-edit-tools.ts`, `memory-entity-extraction.ts`, `memory-user-profile.ts`
- Event log (8 files): `event-log.ts` (24KB), `event-log-persistence.ts`, `event-log-resume-cutover-readiness.ts`
- Evidence: `evidence-verifier.ts`, `evidence-verifier-code-task-gate-shadow.ts` (162KB), `failure-evidence-replay-contracts.ts`, `failure-intelligence-passive-shadow.ts`
- Grounding: `grounding.ts` (110KB)
- AST Edit: `ast-edit-plan.ts`, `ast-patch-planner.ts`, `ast-grep-edit-plan-adapter.ts`
- Agent Map: `agent-map.ts` (87KB), `agent-map-prompt-assembly-experiment.ts`

**Orchestration** (`openclaw_runtime/src/agents/`):
- `orchestrator.ts`: `createOrchestratorPlan` — produces worker plans with lead/verifier roles
- `orchestrator-run-observed.ts`: `runOrchestrationObserved` — execution with observability tracing
- `role-router.ts`: `routeRole` — task-to-role resolution
- `role-registry.ts`, `role-contract.ts`: role contracts compiled to agent instructions
- `subagent-spawn.ts`: `spawnSubagentDirect`
- `orchestration-protocol.ts`: quality policy, graph mode, repair policy, worker communication normalization

**Observability** (`openclaw_runtime/src/observability/`):
- `trace-recorder.ts`: span-based trace recording (16 span kinds: orchestrator, role-router, tool, model, memory, verifier, etc.)
- `scorecard.ts`: A-F grading across reliability/verification/context/cost/latency dimensions
- `role-first-observer.ts`: wraps orchestration in trace spans
- `metrics.ts`: token aggregation, trace metrics
- `trace-buffer.ts`: in-memory buffer for recent queries

**Local Control Plane** (`openclaw_runtime/src/local-control-plane/`):
- Observe-only diagnostic layer (default-off). Report kinds: context, model_router, capability, evidence, mission.
- Explicit non-goals: no active pruning, no active model routing, no active evidence gating, no MicroKernel rewrite.

**Compaction Pipeline** (multi-location):
- `packages/agent-core/src/harness/compaction/compression-planner.ts`: 5-tier compression (hot-context → micro-compact → token-pruning → semantic-handoff → emergency-collapse) based on pressure ratio (0.0-1.0)
- `packages/agent-core/src/harness/compaction/compression-artifact.ts`: structured artifact v1 (objective, constraints, currentState, done/in-progress/blocked, decisions, filesTouched, testsRun, failedAttempts, deviations, nextAction, quality, causalAnchorCount, staleExcludedCount)
- `src/agents/agent-hooks/compaction-safeguard.ts` (50KB): safeguards compaction with quality repair, recent-turn preservation (default 3, max 12), re-distillation
- `src/agents/agent-hooks/context-pruning/pruner.ts` (12KB): trims old content under token pressure, drops thinking blocks, prunes tool results

**Context Engine** (`openclaw_runtime/src/context-engine/`):
- `registry.ts` (33KB): pluggable context providers with quarantine proxy
- Providers: memory-context-provider.ts (33KB), symbol-context-provider.ts, trace-context-provider.ts, agent-map-context-provider.ts
- Lifecycle: assemble → ingest → compact → maintain → thread-bootstrap

**Task Ledger** (shared types + runtime persistence):
- `shared/types/task-ledger.ts`: full types — `TaskLedgerNodeKind` (goal/milestone/task/check/decision/risk/deviation/review), `TaskLedgerNodeStatus` (todo/doing/blocked/review/done/dropped), `TaskLedgerEventType` (15 kinds)
- Persistence: append-only JSONL under task-ledgers/, materialized snapshot.json, exports/*.html
- `openclaw_runtime/src/agents/long-task-control/store.ts`: `RuntimeResumeCheckpoint`, SQLite-persisted intervention queue

**Mission Control** (`openclaw_runtime/src/agents/mission-control/`):
- `controller.ts`: TCP-like state machine (10 states: idle/running/sleeping/paused/ask_user/complete/blocked/cancelled/error)
- `store.ts`: SQLite persistence via mission_runs/mission_events tables
- `reviewer.ts`: mission review decisions
- Status: MVP+ with manual ticks; scheduled ticks planned but not shipped

**Sandbox** (Main-process + types):
- `shared/types/sandbox.ts`: `SandboxProviderId`, `SandboxRuntimeLevel` (policy/light/strong/unavailable), `SandboxNetworkPolicy`, `SandboxExecPolicy`
- `electron/services/sandbox-api.ts`: status, detectProviders, explain, updateProfile
- `electron/utils/sandbox-policy-resolver.ts`: single effective-policy resolver
- Providers: `policy-light` (default, Main/Gateway policy gates), `windows-light` (optional), `docker-strong` (optional, requires Docker CLI + daemon + openclaw-sandbox image), `ssh-strong` (reserved, not wired)

**ClawGraph** (workflow engine):
- `shared/types/clawgraph.ts`: `ClawGraphWorkflowSpec`, `ClawGraphIR`, `ClawGraphHandoff` (structured node output with evidenceRefs, filesTouched, decisions, deviations, risks)
- Gateway RPCs: clawgraph.compile/run/status/events/abort/review
- Non-goals: not a drag-and-drop editor, container orchestrator, or replacement for role contracts

**CodeGraph** (semantic code index):
- 15 registered tools: codegraph_decide, codegraph_context_plan, codegraph_explore, codegraph_search, codegraph_callers, codegraph_callees, codegraph_impact, codegraph_status, codegraph_sync, codegraph_init, codegraph_entrypoints, codegraph_find_flow, codegraph_minimal_context, codegraph_git_stats, codegraph_freshness
- Index: 10,026 files, 158,358 nodes, 470,892 edges
- Freshness modes: fast (skip sync), balanced (throttled 5s TTL), strict (sync-before-read)

### How to Read the Codebase's Quality Markers

The codebase uses consistent markers to indicate maturity. Pay attention to these:

1. **Production code**: no special markers. Normal module structure.
2. **Shadow** (advisory-only, default-off, no behavioral change): files ending in `-shadow.ts`, feature flags defaulting to `false`, constants like `ADVISORY_ONLY = true`. The system records data but doesn't act on it.
3. **Pilot** (controlled experiment with explicit gates): files ending in `-pilot.ts`, contains decision functions like `use_legacy_checkpoints` vs `ready_for_explicit_pilot`, explicit required-boundaries arrays.
4. **Planned / Future Work**: features with types defined but described as "reserved", "future", "planned", or disabled by default with no pilot code. Example: `ssh-strong` sandbox provider, `workerCommunication="bounded_a2a"`, Mission Control scheduled ticks.
5. **Non-goals**: explicitly documented in `docs/clawx-design-overview.md` section 1.2. When the design doc says "X is not a Y", that boundary should be respected in your proposals.

---

## Part 1: The Task — 6 Architecture Enhancement Designs

For each of the 6 areas below, produce ONE architecture design document. Each document must be grounded in the existing codebase.

### Mandatory Exploration Phase (Do This First for Each Area)

Before designing ANYTHING for an area, you MUST:

1. **Run `codegraph_decide`** with the area's topic as userIntent, operationType="locate", riskLevel="medium". This tells you whether CodeGraph navigation is useful and what freshness mode to use.

2. **Run `codegraph_context_plan`** with the area's topic as the task description. This gives you a prioritized list of existing files to read, with priority scores and read-depth recommendations.

3. **Read the top-priority files** from the context plan. At minimum, read files marked "deep" and priority >= 70. If a file is >500 lines, read the first 100 lines and any type/interface definitions.

4. **Check the design doc** at `docs/clawx-design-overview.md` for mentions of the area. Sections 7-11 are most relevant. Use `codegraph_search` to find the section number.

5. **Identify what's already there**: list every existing module that touches this area, its maturity level (production/shadow/pilot/planned), and its explicit non-goals.

6. **Only then start designing.** Your design MUST extend what exists, not replace it or ignore it.

---

### Area 1: Layered Execution Isolation

**Context from the real codebase:**

The existing sandbox system has 4 provider tiers (policy-light → windows-light → docker-strong → ssh-strong) managed by `electron/utils/sandbox-policy-resolver.ts`. The default is policy-light: Main/Gateway gates + workspace-root checks + approval/audit logs. docker-strong requires Docker daemon and a specific image. The ACP already has worktree-based isolation for spawned sessions (`spawn.ts`). Tools execute within the runtime process — there's no per-turn process isolation.

**What to explore before designing:**
- `electron/utils/sandbox-policy-resolver.ts` — understand how effective policy is computed
- `electron/services/sandbox-api.ts` — understand the host-api contract
- `shared/types/sandbox.ts` — all type definitions
- `openclaw_runtime/src/acp/control-plane/spawn.ts` — understand worktree isolation boundaries
- `openclaw_runtime/src/plugins/` — plugin isolation model (are plugins sandboxed from each other?)

**Design prompt:**

The current sandbox system is workspace-level: you pick a provider per workspace at config time. Design an architecture for **dynamic per-turn isolation** where individual agent actions can run at different isolation tiers based on the action's context. Consider:

- How would you integrate with the existing `SandboxRuntimeLevel` enum (policy/light/strong) without breaking the current workspace-level default?
- The ACP spawn system already does worktree isolation. Could this be extended to per-turn filesystem overlays?
- The current default (policy-light) is pure policy gates — no container, no VM. What would a "fast reset" mechanism look like that stays within the Node.js process but provides filesystem snapshots?
- How does the existing `SandboxNetworkPolicy` (disabled/approvalRequired/enabled) map to per-turn network control?
- What's the recovery path if a per-turn isolation fails mid-turn?

**Key constraint:** The system has NO container runtime as a hard dependency. Docker is optional. Any architecture you design must work with the policy-light default and degrade gracefully.

---

### Area 2: Multi-Agent Orchestration

**Context from the real codebase:**

Orchestration already exists in a specific form: `role-router.ts` resolves tasks to roles, `orchestrator.ts` creates plans with lead/verifier workers, `orchestrator-run-observed.ts` executes them with observability spans. The ClawGraph engine (`shared/types/clawgraph.ts`) compiles YAML workflow specs into DAG IRs with structured handoffs. Subagent spawning uses ACP sessions. `workerCommunication` has a `bounded_a2a` type defined but disabled. The Subagent Runner UI wraps this for common presets.

**What to explore before designing:**
- `openclaw_runtime/src/agents/orchestrator.ts` — how plans are created
- `openclaw_runtime/src/agents/role-router.ts` — how tasks map to roles
- `openclaw_runtime/src/agents/orchestrator-run-observed.ts` — execution flow
- `openclaw_runtime/src/agents/orchestration-protocol.ts` — quality/repair/communication policies
- `shared/types/clawgraph.ts` — ClawGraph workflow spec and IR structure
- `openclaw_runtime/src/observability/role-first-observer.ts` — how traces wrap orchestration

**Design prompt:**

The current orchestration is primarily `lead + verifier` with sequential execution. Design an architecture for **parallel multi-worker orchestration** where independent sub-tasks execute concurrently and a coordinator merges results. Consider:

- The existing `ClawGraphWorkflowSpec` already models DAG dependencies. How would you extend this for parallel worker scheduling with resource awareness?
- `SessionActorQueue` ensures per-session turn ordering. How does parallel execution interact with this — do workers share a session or get independent ones?
- The existing evidence system (`evidence-verifier.ts`) validates outputs. How does verification work when multiple workers produce partial results in parallel?
- What changes to `orchestration-protocol.ts` would enable configurable parallelism policies (e.g., max concurrent workers, resource caps per worker)?
- The ClawGraph handoff object already has `evidenceRefs`, `filesTouched`, `decisions`, `deviations`. Is this sufficient for inter-worker communication, or does it need extension?

**Key constraint:** The existing roles system (`role-registry.ts`, `role-contract.ts`) is the identity primitive for workers. Do NOT design a new identity system. Do NOT replace ClawGraph. Extend what's there.

---

### Area 3: Runtime Resilience for Long Sessions

**Context from the real codebase:**

The resilience stack has several layers at different maturity levels:

- **Production**: `compaction-safeguard.ts` (50KB) — quality repair for compaction, recent-turn preservation, re-distillation. `LongConversationControlSignal` types: evidence_gap, validation_missing, scope_drift, unverified_claim, replan_required (each with severity: info/warning/blocking).
- **Shadow** (advisory-only): `event-log.ts` — `eventLogShadow`, `eventLogPersist`, `checkpointSerializerShadow`, `resumeReplayShadow` all default-off. `failure-intelligence-passive-shadow.ts` — `ADVISORY_ONLY = true`.
- **Pilot** (controlled cutover): `event-log-limited-authority-cutover-pilot.ts` — has explicit required boundaries, decision function `use_legacy_checkpoints` vs `ready_for_explicit_pilot`. `failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.ts` — `futureActiveCandidate` with `action: "block"`.
- **Planned**: Mission Control outer policy loop with scheduled ticks.

**What to explore before designing:**
- `openclaw_runtime/src/runtime-core/event-log.ts` — feature flags, diagnostic codes
- `openclaw_runtime/src/runtime-core/resume-shadow.ts` — `RuntimeResumeShadowComparison`, tool reuse status
- `openclaw_runtime/src/runtime-core/state-reducer.ts` — `replayRuntimeTaskEventLogRecords`
- `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` — shadow classification
- `openclaw_runtime/src/agents/long-conversation-control-signals.ts` — all signal types
- `openclaw_runtime/src/agents/mission-control/controller.ts` — state machine design

**Design prompt:**

The system already records failure signals but mostly in shadow/advisory mode — it observes but doesn't act. Design an architecture that promotes the shadow signals into an **active resilience supervisor** that can:

- Classify execution patterns into normal vs anomalous using the existing `LongConversationControlSignal` taxonomy
- Trigger recovery strategies mapped to signal severity (info → continue, warning → repair/replan, blocking → checkpoint-rollback or escalate)
- Use the existing event log replay (`state-reducer.ts`) to reconstruct state after a rollback
- Integrate with Mission Control's state machine for long-goal recovery decisions
- Respect the existing pilot boundaries — your design should propose which shadow features to promote, with what gates

**Key constraint:** The existing pilot pattern requires: a fresh spec, explicit operator gate, default-off start, disable-only rollback, no schema change, and rollback plan. Your architecture must follow this pattern. You are NOT designing a new recovery system from scratch — you are designing the promotion path for systems that already exist as shadows.

---

### Area 4: Decision Quality Assessment

**Context from the real codebase:**

The observability stack is production-grade for tracing:
- `trace-recorder.ts`: span-based recording, 16 span kinds covering orchestrator through tool execution
- `scorecard.ts`: grades traces A-F on reliability (0.3), verification (0.25), context (0.2), cost (0.15), latency (0.1)
- `role-first-observer.ts`: wraps orchestration calls in spans
- Gateway RPCs: `observability.reportTrace`, `observability.traces`

The evidence system validates outputs:
- `evidence-verifier.ts`: categorizes findings as contract/obligation/evidence/tool/event_replay/external_dependency/cancellation
- `evidence-verifier-code-task-gate-shadow.ts` (162KB): shadow-mode evidence collection for code tasks
- 14 evidence ref types: file, test, trace, tool, human, session, subagent, memory, task_loop, clawgraph, task_ledger, checkpoint, manual, other

The Local Control Plane (`local-control-plane/`) is observe-only and default-off. Report kinds: context, model_router, capability, evidence, mission.

**What to explore before designing:**
- `shared/types/observability.ts` — shared trace/span/scorecard types
- `openclaw_runtime/src/observability/types.ts` — runtime-side types
- `openclaw_runtime/src/observability/scorecard.ts` — how scoring works today
- `openclaw_runtime/src/observability/trace-recorder.ts` — span lifecycle
- `openclaw_runtime/src/runtime-core/evidence-verifier.ts` — evidence decision model
- `openclaw_runtime/src/local-control-plane/index.ts` — LCP report structure

**Design prompt:**

The current scorecard evaluates trace-level outcomes (was the task completed? were verifications run?). It does NOT evaluate step-level decision quality (did the agent choose the right tool? with the right inputs? at the right time?). Design an **agent decision quality assessment framework** that:

- Adds step-level assessment dimensions to the existing `ObservabilityTraceCoverage` and scorecard system
- Leverages the existing evidence verifier's finding categories to feed decision-quality signals
- Integrates with the Local Control Plane's observe-only report model as a new `decision_quality` report kind
- Distinguishes between "the trace happened correctly" (tracing) and "the decisions in the trace were correct" (evaluation)
- Proposes what the new scorecard weights would be when decision quality joins the existing 5 dimensions

**Key constraint:** The Local Control Plane is explicitly observe-only. Your architecture must respect this boundary. Decision quality assessment is a diagnostic tool, not an active gate. Follow the LCP's promotion rule: any move to active behavior requires a separate feature flag, flag-off parity proof, and rollback plan.

---

### Area 5: Adaptive Context Budget

**Context from the real codebase:**

The compaction pipeline is sophisticated:
- 5 tiers keyed to pressure ratio (0-1): hot-context (< 0.6) → micro-compact (< 0.75) → token-pruning (< 0.85) → semantic-handoff (< 0.95) → emergency-collapse (>= 0.95)
- `CompressionArtifact v1`: structured output with objective, constraints, currentState, quality metrics, causal anchors, stale exclusions
- Safeguard quality contract: required summary sections (Decisions, Open TODOs, Constraints/Rules, Pending user asks, Exact identifiers)
- Context pruning: drops thinking blocks, prunes tool results under token pressure
- Context Engine: pluggable providers with quarantine proxy, lifecycle: assemble → ingest → compact → maintain

The system is currently **pressure-reactive**: it compresses when the context window is nearly full. It does NOT plan budget ahead of time.

**What to explore before designing:**
- `packages/agent-core/src/harness/compaction/compression-planner.ts` — tier selection logic
- `packages/agent-core/src/harness/compaction/compression-artifact.ts` — artifact structure
- `src/agents/agent-hooks/compaction-safeguard.ts` — safeguard pipeline (start at line 1, read the extension registration)
- `src/agents/agent-hooks/context-pruning/pruner.ts` — pruning strategy
- `src/context-engine/registry.ts` — provider lifecycle
- `src/context-engine/types.ts` — `ContextEngineHostCapability` enum

**Design prompt:**

The current system is reactive: it compresses when pressure is high. Design a **proactive context budget architecture** that:

- Estimates task complexity before execution begins and allocates a context budget
- Selects compression strategy per task type (a locate task needs different compression than a refactor task)
- Introduces a "compression cost" concept — aggressive compression saves input tokens but may shift reasoning burden to the model, increasing total cost
- Integrates with the existing `CompressionArtifact.quality` field to track whether compression harmed task outcomes
- Uses the Context Engine's pluggable provider system to prioritize context sources under budget constraints

**Key constraint:** The 5-tier pressure model and CompressionArtifact v1 are production code. Your design extends them with a proactive planning layer — it does NOT replace them. Also: automatic compaction currently records telemetry only; the design doc says it won't be promoted until "evaluation gates prove the new strategy is safe." Your budget-aware design should follow the same pattern — propose a shadow evaluation phase before active deployment.

---

### Area 6: Long-Running Task Persistence

**Context from the real codebase:**

This area has the most existing infrastructure:

- **Task Ledger**: append-only JSONL persistence, materialized snapshots, DAG structure with node kinds (goal/milestone/task/check/decision/risk/deviation/review), 15 event types, idempotency keys, session links
- **SQLite databases**: `openclaw-state-db` (global: mission_runs, mission_events, long_task_checkpoints, long_task_queue, state_leases) and `openclaw-agent-db` (per-agent)
- **Resume infrastructure**: `resume-shadow.ts` (shadow comparison), `manager.runtime-resume-state.ts` (stale-session recovery), `long-task-control/store.ts` (persistent checkpoints), `long-task-control/persisted-resume-shadow.ts`
- **Mission Control**: 10-state machine (idle/running/sleeping/paused/ask_user/complete/blocked/cancelled/error), 12 execution phases, SQLite persistence
- **Loop Context Pack**: single bounded recovery context builder for `/loop`

The Task Ledger is explicitly NOT an executor — it stores work structure and progress. Memory stores reusable knowledge. They are separate systems with a one-way reference: memory may cite ledger state as evidence, but ledger events are the source of truth for task state.

**What to explore before designing:**
- `shared/types/task-ledger.ts` — full type system (TaskLedgerNodeKind, TaskLedgerNodeStatus, TaskLedgerEventType, TaskLedgerSnapshot)
- `openclaw_runtime/src/agents/long-task-control/store.ts` — `RuntimeResumeCheckpoint` persistence
- `openclaw_runtime/src/agents/mission-control/controller.ts` — state machine
- `openclaw_runtime/src/agents/mission-control/store.ts` — `saveMissionRun`, `recordMissionEvent`, `getLatestMissionForSession`
- `openclaw_runtime/src/agents/loop-context-pack.ts` — recovery context builder
- `openclaw_runtime/src/state/openclaw-state-schema.sql` — database schema
- `openclaw_runtime/src/acp/control-plane/manager.runtime-resume-state.ts` — stale session recovery

**Design prompt:**

The system can save task structure (Task Ledger) and has checkpoint/resume infrastructure (mostly in shadow/pilot mode). Design a **complete session continuity architecture** that enables:

- Save full execution context and pause a session (not just task metadata — the actual agent state)
- Resume across app restarts with graceful degradation when source files have changed
- Multi-tier state storage: hot (in-memory), warm (SQLite), cold (filesystem checkpoints)
- Integration between Task Ledger DAG state and Mission Control state machine for cross-session goal tracking
- A "resume contract" that defines what state is guaranteed to survive pause/resume and what may be reconstructed

**Key constraint:** The Task Ledger is explicitly NOT an executor and NOT a replacement for memory, sessions, transcripts, or observability traces. Your design must respect all of these boundaries. Also: the existing resume infrastructure (`resume-shadow.ts`, `manager.runtime-resume-state.ts`) uses the pilot pattern with explicit gates. Your architecture should define the promotion path from shadow to active for the components you need.

---

## Part 2: Deliverable Format

For each area, produce ONE file containing the architecture design. Use this structure:

```markdown
# [Area Number]. [Area Name]

## Exploration Log

Briefly document what you explored before designing:
- CodeGraph plans executed (what did codegraph_context_plan return?)
- Files read (list actual paths and what you learned from each)
- Existing modules found (list with maturity: production/shadow/pilot/planned)
- Non-goals and constraints identified

## 1. Gap Analysis

- What the existing system CAN do in this area (with specific module references)
- What the existing system CANNOT do (the specific gap this design fills)
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

## 7. Design Decisions

For each major architectural choice:
- The decision and why
- Alternatives considered and why rejected
- Future extension points left open

## 8. Validation Approach

How would you verify this architecture works? What experiments would you run? What metrics would prove success or failure?
```

---

## Part 3: Working Methodology

### Token Efficiency with CodeGraph

This codebase has 10,026+ files. Loading them all into context is impossible. Use CodeGraph systematically:

1. **codegraph_decide** first — always. It tells you whether CodeGraph navigation will help and what freshness mode to use.
2. **codegraph_context_plan** second — it builds a prioritized reading list. Trust its priority scores: files above 80 are must-read, 60-80 are useful, below 60 can be deferred.
3. **Read files selectively** — read the type definitions (usually first 50-100 lines), the public API surface (class declarations, exported functions), and integration points (imports from other subsystems). Skip implementation bodies unless the interface is unclear.
4. **codegraph_search** for specific symbols when the context plan mentions a symbol you haven't found yet.
5. **codegraph_find_flow** for understanding how data moves through a pipeline (e.g., "compaction flow" or "orchestration flow").

### Quality Standards

- Every design MUST reference at least 3 existing modules by path.
- Every design MUST identify at least 1 explicit non-goal it respects.
- Every design MUST distinguish between production/shadow/pilot/planned components.
- Every design MUST propose a shadow-first evaluation phase before active deployment, following the project's existing pilot pattern.
- If the design proposes changing a module larger than 20KB, it MUST explain why the change is additive (not a rewrite).

---

## Execution Order (MANDATORY — Read This Before Starting Any Area)

The 6 areas below look independent, and in conceptual terms they are. **But you MUST process them STRICTLY SEQUENTIALLY: Area 1 → 2 → 3 → 4 → 5 → 6.** Do NOT start exploration for Area N+1 until Area N's document is fully written to disk.

### Why sequential

This rule exists for two reasons that have caused instability in prior runs:

1. **Context pressure.** Each area's design (ASCII diagram + TS types + integration table + migration path + 8 sections) is dense. Holding 6 drafts simultaneously in context degrades later sections — early constraints (Quality Standards, non-goals, key constraints) get dropped or forgotten.
2. **Tool-call interleaving.** The Mandatory Exploration Phase requires `codegraph_decide` + `codegraph_context_plan` + file reads per area. Running these for multiple areas concurrently causes tool returns to arrive out of order, and findings from Area A leak into Area B's design.

### The per-area loop (do exactly this, 6 times)

For EACH area, run this loop end-to-end before moving on:

1. Run `codegraph_decide` with that area's topic as userIntent, operationType="locate", riskLevel="medium".
2. Run `codegraph_context_plan` with that area's topic as the task description.
3. Read the top-priority files returned (deep + priority >= 70).
4. Draft the design following the Part 2 template. **Content is plain markdown — the value is in the architectural thinking, not in code execution.** Keep ASCII diagrams, TS-like type definitions, and tables as markdown. Do not try to compile or run anything.
5. **Write the document to disk immediately** using the Write tool, at the path specified below.
6. Confirm the file exists, then proceed to the next area. **Do NOT hold the draft in context** — once written to disk, treat that area as closed.

### Output paths

Write each area's document to:

```
net use/designs/area-<N>-<slug>.md
```

Where:
- `<N>` is the area number (1–6), zero-padded? No — just `1`, `2`, ..., `6`.
- `<slug>` is a short kebab-case slug derived from the area name. Suggested slugs:
  - Area 1 → `area-1-layered-execution-isolation.md`
  - Area 2 → `area-2-multi-agent-orchestration.md`
  - Area 3 → `area-3-runtime-resilience.md`
  - Area 4 → `area-4-decision-quality.md`
  - Area 5 → `area-5-adaptive-context-budget.md`
  - Area 6 → `area-6-long-running-persistence.md`

Create the `net use/designs/` directory if it does not exist (the Write tool will create parent directories).

### Failure handling

If an area fails partway through (file not found, tool error, ambiguous state), do NOT abort the entire run. Instead:

1. Write a partial document to the area's output path.
2. At the top of the `## Exploration Log` section, add a `> FAILURE NOTE:` block describing what failed and at which step.
3. Continue to the next area.

Per-area retry cap: if a single tool call within an area fails 3 times, stop retrying that call, log it in the Exploration Log, and continue with whatever information you have. Do not get stuck.

### What "done" means

You are finished only when all 6 files exist under `net use/designs/`. If you finish Area 6 and find that fewer than 6 files exist on disk, you have not completed the task — go back and write the missing ones.

---

## Remember

This is a personal educational project. You are designing architecture for learning purposes — to understand how these systems fit together and where they can grow. The value is in the architectural thinking, not in shipping code.

Design ON the real codebase. Design WITH the existing patterns. Design FOR the actual gaps.