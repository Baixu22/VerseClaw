# Area 3. Multi-Agent Role Routing Strategy Design

## Exploration Log

- **CodeGraph map sections read**: Sections 4 (full: 4.1-4.13), 2.4, 7, 8.
- **CodeGraph tool invocations**: none.
- **Files read beyond the map**:
  - `openclaw_runtime/src/agents/role-router.ts` (full) — verified `ROLE_KEYWORDS` (8 roles, CN/EN), the +2 keyword / +1 tag / file-hint bonus / implementer default +1 scoring, and `resolveMode` regexes.
  - `openclaw_runtime/src/agents/orchestrator.ts:1-120` — verified `createOrchestratorPlan` request shape: explicit `workers[]` → `templateId` → router priority; `OrchestratorPlan` already carries `routeDiagnostics`, `capabilityGaps`, `taskGraph`, `executionWaves`.
  - `openclaw_runtime/src/agents/orchestration-protocol.ts:1-120` — verified `RouteDiagnostics` (difficulty, confidence, reasons, rejectedRoles, capabilityGaps), `OrchestrationTaskLedgerEntry.roleInstanceId`, `WorkerQualityScore` (overall / schemaCompliance / evidenceCoverage / scopeDiscipline). The protocol layer is much richer than "keyword heuristic" suggests — diagnostics and quality scoring exist; what's thin is the *scoring input* and *post-run reuse*.
  - `openclaw_runtime/src/agents/team-template.ts` (full) — verified 3 built-ins AND that `getTeamTemplateSnapshot` **already merges config-defined teams from `cfg.agents.teams`** (lines 67-90) — custom team templates are already supported at the config layer; what's missing is UI/docs.
  - `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts:125-281` — verified `bounded_a2a` downgrade (line 177-178), `boundedA2aEnabled: false` (line 271), and the full result payload (routeDiagnostics, repairNodes, rerouteRecommendations, resultPolicy).
  - `electron/services/workspace-permissions.ts:60-122` — verified `orchestrator.plan` is SAFE; `orchestrator.run` intentionally absent.
  - `openclaw_runtime/src/agents/role-registry.ts` — config roles merge (relevant to role packs).
- **Existing modules found (maturity)**:
  - role-router keyword scoring — **production**
  - createOrchestratorPlan priority chain + Task Graph + Execution Waves — **production**
  - runOrchestrationObserved + trace spans + repair/reroute — **production**
  - WorkerQualityScore scoring vocabulary — **production types**, scoring populated per-run
  - Config-defined team templates (`cfg.agents.teams`) — **production (no UI)**
  - `bounded_a2a` — **planned/force-disabled** (`team-orchestrate-tool.ts:178`)
  - `RoleOutputSchema` per contract — **production** (markdown sections; JSON schema slot mostly unused)
- **Refinement opportunities identified** (map §4.13 + exploration):
  1. Routing signal is keyword-only, CN/EN-only; no reuse across runs.
  2. Lead synthesis unstructured (LLM self-judgment over Team Result Bundle).
  3. `bounded_a2a` in limbo (typed, requested-but-downgraded).
  4. `orchestrator.run` approval friction for the operator UI path.
  5. Team templates and role packs extensible in config but invisible in product.
- **Non-goals and constraints identified**: `orchestrator.run` approval gate stays; `bounded_a2a` must not default-on; pilot promotion pattern; sessionKey format fixed; ClawGraph is not a replacement for role contracts (design-overview §1.2).

## 1. Current State Summary

**What the existing system CAN do:**

- Route a task to a lead role + supporting roles with explainable scoring (`role-router.ts:43-76`), select among 3 modes (`resolveMode`, `:78-93`), and emit `RouteDiagnostics` with confidence, reasons, rejected roles, and capability gaps (`orchestration-protocol.ts:29-37`).
- Plan with explicit workers > team template > router priority (`orchestrator.ts`), execute in parallel waves with hard tool/permission scoping per role (`role-spawn.ts`), repair failures (`buildRepairNodes`), and score worker output quality (`WorkerQualityScore`).
- Accept user-defined team templates via `cfg.agents.teams` (`team-template.ts:67-90`) and user-defined roles via `cfg.agents.roles[]`.

**What the existing system CANNOT do:**

- Learn anything from a completed run: routing decisions, quality scores, and repair outcomes are recorded in traces but never consulted by the next `routeRole` call.
- Route tasks phrased outside the CN/EN keyword lists (falls to implementer default +1).
- Synthesize worker results against a declared structure — the Lead free-forms it, so two identical runs can produce differently-shaped summaries.
- Let workers exchange anything directly (`bounded_a2a` downgraded to `none`).
- Reduce approval friction for orchestrations the user runs repeatedly.

**Why this matters:** the user's pain "角色路由没有很好的规划" is, per map §4.12, partially a *visibility* gap (much planning exists) and partially real: no routing reuse, no structured synthesis, no growth path beyond keywords. For a single-user tool, the highest-value refinement is making routing *learn from this user's history* and making results *predictably shaped* — not ML infrastructure.

**Non-goals respected:** approval gate preserved; `bounded_a2a` stays default-off; no removal of any orchestration mode.

## 2. Architecture Overview

```
[EXISTING]                                     [NEW]
────────────────────────────────               ────────────────────────────────
role-router.ts                                 Routing Memo Store (per-workspace
  ROLE_KEYWORDS + scoreRole ────────┐            JSON, .clawx/orchestration/
  resolveMode                       │            routing-memos.jsonl)
                                    ├────────►   • record: task digest → plan +
orchestrator.ts                     │              quality outcome
  createOrchestratorPlan            │            • recall: similar-task boost
  (workers → template → router) ────┤              feeding scoreRole as one
                                    │              more additive signal
orchestrator-run-observed.ts        │
  runOrchestrationObserved          │          Structured Synthesis Contract
  WorkerQualityScore ───────────────┼────────►   • per-role outputSchema.sections
  Team Result Bundle                │              already declared → Lead gets a
                                    │              synthesis template assembled
orchestration-protocol.ts           │              from worker contracts
  RouteDiagnostics                  │
  RoleOutputSchema (sections) ──────┘          Trusted Orchestration Presets
                                                 (workspace-scoped pre-approval
team-template.ts                                  for named template+role sets;
  cfg.agents.teams merge [EXISTS] ──────────►     approval gate itself unchanged)
                                    
workspace-permissions.ts                       Role Pack convention
  orchestrator.run gated [KEEP] ────────────►    (cfg.agents.roles[] + teams[]
                                                  authored as a documented YAML
team-orchestrate-tool.ts                          bundle; registry unchanged)
  bounded_a2a downgrade [KEEP] ─────────────►  bounded_a2a: keep disabled;
                                                 typed handoff artifacts instead
```

## 3. Component Specifications

### 3.1 Routing Memo Store [NEW] — cross-run routing reuse

**Responsibility:** record every orchestration's routing decision and outcome; on the next plan, surface "you routed a similar task this way and it went well/poorly" as (a) an additive scoring signal and (b) a human-readable reason in `RouteDiagnostics.reasons`. This is deliberately a *memo*, not a learned policy — a single-user local app has tens-to-hundreds of runs, far below ML sample sizes.

**Interfaces:**

```typescript
// openclaw_runtime/src/agents/routing-memo.ts [NEW]
export type RoutingMemo = {
  id: string;
  createdAt: string;
  workspaceDir?: string;
  taskDigest: string[];        // normalized keyword/file-token set (no raw task text needed)
  mode: RoleRouteMode;
  leadRole: string;
  workerRoles: string[];
  templateId?: string;
  outcome: {                   // filled post-run from existing data
    graphStatus: OrchestrationGraphStatus;
    qualityOverall?: 'good' | 'needs_attention' | 'poor_attempt';  // worst worker score
    repairCount: number;
  };
};

export function recordRoutingMemo(memo: RoutingMemo): void;                 // append JSONL
export function recallRoutingMemos(taskDigest: string[], limit?: number): RoutingMemoMatch[];
export type RoutingMemoMatch = { memo: RoutingMemo; similarity: number };   // Jaccard over digests
```

**Internal state:** append-only JSONL under the workspace (`.clawx/orchestration/routing-memos.jsonl`), capped (e.g., last 500 memos, compact on load). No DB (map §8 constraint). Reuses `WorkerQualityScore` and `graphStatus` that `runOrchestrationObserved` already computes.

**Integration into scoring:** `scoreRole` gains one additive input: if the top recalled memo (similarity ≥ 0.5) succeeded with role R as lead, R gets +2 with reason `memo:similar-task-success`; if it went `poor_attempt`, R gets −1 with reason `memo:similar-task-poor`. Bounded magnitudes keep keyword evidence dominant — memos nudge, never dictate.

**Lifecycle:** memo recorded at run completion inside `runOrchestrationObserved` (best-effort try/catch); recalled inside `createOrchestratorPlan` before `routeRole`. Teardown: file deletion = clean reset.

**Error handling:** unreadable/corrupt memo file → skip recall entirely, plan proceeds exactly as today.

**Privacy/freshness (design question):** memos stay per-workspace on disk, never leave the machine, and store token digests rather than raw task text; staleness self-corrects because newer memos on the same digest outweigh older ones (recency-weighted similarity).

### 3.2 Structured Synthesis Contract [NEW] — replacing pure LLM self-judgment

**Responsibility:** give the Lead a deterministic *skeleton* for synthesis, assembled from the worker contracts' existing `outputSchema.sections`. Every built-in role already declares sections (planner: Goal/Plan/Risks/Acceptance; reviewer: Findings/Evidence/Recommendation; skeptic: Verdict/Refutations/Required Fixes — `role-contract.ts:243,307,355`). The synthesis contract turns the Team Result Bundle from "here are N blobs" into "here are N blobs, each expected to contain these sections; produce a merged report with this shape".

**Interfaces:**

```typescript
// openclaw_runtime/src/agents/synthesis-contract.ts [NEW]
export type SynthesisContract = {
  perWorker: Array<{
    roleName: string;
    roleInstanceId: string;
    expectedFormat: RoleOutputSchema['format'];
    expectedSections: string[];        // from the worker's RoleContract.outputSchema
  }>;
  mergeTemplate: {
    sections: string[];                // e.g. ["Summary", "Per-role findings", "Conflicts", "Open items", "Verdict"]
    conflictRule: 'surface';           // conflicts are listed, never silently resolved
  };
};
export function buildSynthesisContract(plan: OrchestratorPlan, cfg?: RoleRegistryConfigCarrier): SynthesisContract;
```

**How it reaches the Lead:** appended to the Lead's orchestration framing (the `extraSystemPrompt` slot that `team_orchestrate` already composes) and echoed in the tool result next to `resultPolicy`. The Lead still *writes* the synthesis (LLM judgment stays in the loop for content); the contract fixes the *shape* and forces per-worker section coverage — missing sections become explicit "worker did not report X" lines rather than silent omissions.

**Interaction with `RoleOutputSchema`:** this is the first consumer that makes `sections` load-bearing beyond the worker's own prompt. `WorkerQualityScore.schemaCompliance` (already computed) becomes the measurable link: workers that skip sections score `weak/fail`, and the synthesis marks those sections as gaps.

**Error handling:** contract assembly failure → omit it; Lead synthesizes as today (degrade to current behavior).

### 3.3 Trusted Orchestration Presets [NEW] — friction reduction that preserves the gate

**Responsibility:** let the user pre-approve *specific, named* orchestration shapes per workspace, so the operator-UI path (`gateway.rpc('orchestrator.run')`) doesn't prompt every time for a combination they run daily — while `orchestrator.run` itself stays out of `SAFE_GATEWAY_METHODS`.

**Interfaces:**

```typescript
// electron-store 'workspace-orchestration-presets' [NEW, Main-owned]
export type TrustedOrchestrationPreset = {
  id: string;
  workspaceId: string;
  label: string;                       // "Daily review team"
  templateId?: string;                 // must resolve at approval time
  allowedRoles: string[];              // exact role-name set
  maxWorkers: number;
  approvedAt: string;                  // user approved via a normal approval dialog
  revokedAt?: string;
};
```

**Mechanism:** the check lives in the existing approval path in `gateway-api.ts` — when `decideGatewayRpc('orchestrator.run', ...)` returns requires-approval, Main first checks whether the request's `templateId` + role set + `maxWorkers` is *within* an unrevoked preset for the active workspace; if yes, it auto-resolves the approval and records an audit line ("approved by preset X"). If the request exceeds the preset in any dimension (extra role, higher maxWorkers, different template), the normal dialog appears. Creating a preset is itself an approval act: the first approval dialog gains a "trust this combination for this workspace" checkbox.

**Internal state:** electron-store JSON (Main-owned, consistent with workspace permission ownership). **Lifecycle:** created from an approval dialog; listed/revoked in workspace settings UI. **Error handling:** store read failure → treat as no presets → normal approval flow.

**Boundary preservation:** the gate is not weakened — every `orchestrator.run` still passes through the same decision function; a preset is a *user-granted standing approval with a precise scope*, narrower than switching the workspace to fullAccess (which already bypasses the prompt today, so presets strictly reduce the incentive to over-broaden permission mode).

### 3.4 `bounded_a2a`: keep disabled; add typed handoff artifacts instead

**Verdict on the design question:** keep the type, keep the force-disable, do **not** pilot direct worker↔worker messaging now. Reasoning: the concrete collaboration need ("worker B needs worker A's output") is better served *through the existing graph* — `OrchestrationTaskEdge.type: 'handoff'` already exists (`orchestration-protocol.ts:21`), and the ledger already sequences dependencies. The refinement: when a `handoff` edge connects A→B, `runOrchestrationObserved` includes A's (schema-shaped, §3.2) output section in B's spawn `extraSystemPrompt`. This delivers most of the value of `bounded_a2a` (data flows between workers) with none of its risks (no new communication channel, no Lead bypass — the orchestrator mediates, all flow remains observable in traces).

If a true a2a pilot is ever wanted, it must follow the pilot pattern (fresh spec, operator gate, default-off, disable-only rollback) — but this design recommends deferring it until handoff-artifact injection proves insufficient, which it likely won't for a single-user tool.

### 3.5 Role Packs and custom teams — surface what exists

`cfg.agents.roles[]` and `cfg.agents.teams` already support user-defined roles and templates with validation (`role-registry.ts:61-77`, `team-template.ts:73-85`). The refinement is packaging, not mechanics:

- **Role Pack convention** [NEW docs + example]: a documented YAML bundle shape (`docs/role-packs.md` + `docs/role-packs/writing-pack.example.yaml`) containing `roles:[...]` and `teams:[...]` entries the user pastes/merges into OpenClaw config. Domain packs (writing: outliner/drafter/line-editor/fact-checker; research: searcher/synthesizer/critic) ship as *examples*, not new built-ins — keeping `BUILT_IN_ROLE_CONTRACTS` a stable software-dev core.
- **Validation**: existing `validateRoleContract` + `normalizeTeamTemplate` already reject malformed entries with issues; the pack doc points at `roles.list` `issues` output for debugging.
- **UI**: Area 1's origin badge marks pack roles as `config`; a later Agents-page "import role pack" affordance is an extension point, not in scope here.
- **Keyword coverage for pack roles**: `ROLE_KEYWORDS` is keyed by built-in names, so config roles currently score only via `tags`. Refinement: `RoleContract` config entries may carry `routingKeywords?: string[]` (additive optional field, normalized like `tags`), which `scoreRole` reads with the same +2 weight. This also answers the CN/EN-only limitation for user-authored roles — users write keywords in their own language.

### 3.6 Embedding/learned routing — explicitly deferred

Rejected for now: embedding-based routing needs an embedding provider on every plan call (`memoryEmbeddingEnabled` defaults false, map §5.5), adds latency to a currently-synchronous scoring pass, and has no training signal at single-user scale. The memo store (§3.1) + `routingKeywords` (§3.5) capture the achievable gains. Extension point: `scoreRole` is already a pure function taking additive signals; an embedding similarity term can slot in later behind the same shadow evaluation as any routing change (§6).

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `openclaw_runtime/src/agents/routing-memo.ts` | NEW file (record/recall, JSONL) | Cross-run reuse |
| `openclaw_runtime/src/agents/role-router.ts` | `scoreRole` accepts optional memo signal + `routingKeywords` from contract | Additive scoring inputs; keyword logic untouched |
| `openclaw_runtime/src/agents/orchestrator.ts` | `createOrchestratorPlan` recalls memos (flagged), passes matches to router; plan result includes memo reasons | Diagnostics-visible reuse |
| `openclaw_runtime/src/agents/orchestrator-run-observed.ts` | Record memo at completion; inject handoff artifacts along `handoff` edges | Both reuse writes and §3.4 |
| `openclaw_runtime/src/agents/synthesis-contract.ts` | NEW file | Structured synthesis |
| `openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts` | Include `synthesisContract` in Lead framing + result payload | Delivery path; a2a downgrade untouched |
| `openclaw_runtime/src/agents/role-contract.ts` | Optional `routingKeywords?: string[]` normalized field | Pack-role routability |
| `openclaw_runtime/src/agents/team-template.ts` | NO change | Custom teams already merge |
| `electron/services/gateway-api.ts` | Preset check inside existing approval branch + audit line | Friction reduction at the right layer |
| `electron/services/workspace-permissions.ts` | NO change | Gate classification untouched |
| `openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts` | NO change to method set; `orchestrator.plan` result carries memo/synthesis fields | Read-side stays SAFE |
| `docs/role-packs.md` + example packs | NEW docs | Surface existing extensibility |

`orchestrator-run-observed.ts` and `team-orchestrate-tool.ts` are sizable modules: all changes are additive hooks (record-at-completion, extra framing string, extra result field) — no existing control flow is rewritten.

## 5. Data Flow

**Scenario: user runs "review the sessions-api refactor for regressions" for the third time this week via the Subagent Runner UI.**

1. Renderer triggers `gateway.rpc('orchestrator.run', { task, templateId: 'quick-development', ... })`.
2. Main `gateway-api.ts`: `decideGatewayRpc` → requires approval → [NEW] preset check finds "Daily review team" preset covering `quick-development` + {planner, implementer, tester, reviewer} + maxWorkers 4 → auto-approves, writes audit line.
3. Runtime `role-orchestration-methods.ts:297` → `createOrchestratorPlan`: [NEW] `recallRoutingMemos(digest('review sessions-api refactor regressions'))` finds Monday's memo (similarity 0.7, outcome good, lead=reviewer) → `scoreRole` gives reviewer +2 `memo:similar-task-success` → reviewer leads (previously implementer's default +1 could tip ambiguous tasks). `RouteDiagnostics.reasons` now shows the memo reason.
4. Plan proceeds: template workers, task graph, waves — all existing code.
5. [NEW] `buildSynthesisContract(plan)` collects each worker's `outputSchema.sections`; the Lead's framing includes the merge template.
6. `runOrchestrationObserved` spawns workers per waves (`spawnRoleSubagent` unchanged). Tester's node has a `handoff` edge from implementer → [NEW] implementer's "Changes/Verification" sections are injected into tester's `extraSystemPrompt`.
7. Workers complete; Lead synthesizes into the contract's shape: Summary / Per-role findings (one per worker, gaps marked) / Conflicts / Verdict.
8. [NEW] Completion hook records a `RoutingMemo` with `graphStatus: completed`, worst `WorkerQualityScore: good`, `repairCount: 0`.
9. Renderer's `TeamOrchestrationCard.tsx` renders the (now predictably-shaped) result; traces carry memo + synthesis fields for inspection.

## 6. Migration Path

Routing behavior changes user-visible outcomes, so memo-influenced routing ships shadow-first per the pilot pattern:

- **Fresh spec**: `harness/specs/tasks/role-first-routing-memo-pilot.md`.
- **Shadow phase**: memos are *recorded* and *recalled*, and the would-be score adjustment is written into `RouteDiagnostics.reasons` as `memo-shadow:...` — but does NOT alter scores. Telemetry: for each run, did the shadow recommendation match the actual keyword-routed lead? Did runs where they diverged end worse (repairCount, quality)?
- **Gate to active**: ≥20 shadow runs; shadow-divergent recommendations would have equaled-or-improved outcomes in ≥70% of divergences (manual review acceptable at these volumes).
- **Rollback**: disable-only flag; memo file untouched (it is inert data).
- **Purely additive, no promotion needed**: synthesis contract (degrades to today when absent), presets (user opt-in per workspace, revocable), `routingKeywords` (optional field), role pack docs, handoff-artifact injection (flagged, default-on defensible since it only adds already-observable sibling output to a dependent worker's context — but ship default-off first ride along with the memo flag for one release).
- **Telemetry**: memo hit rate, preset auto-approval count (audit log), `schemaCompliance` distribution before/after synthesis contract.

## 7. Design Decisions

1. **Memo recall over ML routing.** Single-user scale makes learned policies data-starved; a recency-weighted memo with bounded score influence gets the "stop re-deciding solved routings" value at JSONL cost. Rejected: embedding router (latency + disabled-by-default embeddings + no eval story). Extension point: `scoreRole`'s additive-signal shape accepts an embedding term later.
2. **Synthesis = skeleton, not automation.** A fully mechanical merger would need reliable JSON output from all workers (today's contracts are markdown-first). Fixing the shape while keeping LLM content judgment is the right altitude; `schemaCompliance` scoring already exists to measure worker adherence. Rejected: forcing `outputSchema.format: 'json'` on all roles (breaks the human-readable trace value of markdown sections).
3. **Presets in Main, not a runtime SAFE-list change.** The approval decision lives in `gateway-api.ts` today; scoping standing approvals to (workspace × template × role-set × maxWorkers) keeps the runtime gate untouched and the trust decision where workspace permission state already lives. Rejected: adding `orchestrator.run` to SAFE when a config flag is set (weakens the gate structurally).
4. **Handoff artifacts instead of a `bounded_a2a` pilot.** Delivers inter-worker data flow through the already-mediated graph. Rejected: enabling bounded a2a as a pilot now (new channel, new failure modes, and the dependency-edge mechanism already encodes who-needs-what). The type stays for future work, as documented in `docs/clawx-design-overview.md:1260-1366`.
5. **Domain role packs as documented config examples, not new built-ins.** Keeps the built-in registry a stable dev-focused core and exercises the existing config path. Rejected: shipping writing/research roles in `BUILT_IN_ROLE_CONTRACTS` (bloats every registry consumer; users can't remove built-ins).

## 8. Validation Approach

- **Router unit tests**: memo signal bounded (±2 max), keyword dominance preserved (a strong keyword match always outranks a memo nudge), `routingKeywords` scoring parity with built-in keywords.
- **Shadow-phase analysis** (§6): divergence-outcome table over ≥20 runs.
- **Synthesis contract**: fixture Team Result Bundles → assert Lead prompt contains per-worker expected sections; post-ship, compare `schemaCompliance` pass-rate and count of "worker did not report X" flags (should replace silent omissions).
- **Preset boundary tests**: request exceeding preset in any single dimension (role, count, template) must fall through to the dialog; revoked preset must not auto-approve; audit line present for every preset approval.
- **Handoff injection test**: dependent worker's prompt contains predecessor sections only when a `handoff` edge exists.
- **Success metric**: repeated-task orchestrations reach the same (good) routing without re-approval and produce structurally identical synthesis sections across runs.

## 9. Boundary Considerations

- **`orchestrator.run` approval gate**: preserved verbatim in `workspace-permissions.ts`; presets are scoped standing approvals recorded with audit trail, revocable, workspace-bound — the gate's intent (user consents to subagent spawning) is honored per-shape rather than per-click.
- **`bounded_a2a` boundary**: force-disable untouched; handoff artifacts flow orchestrator-mediated along declared graph edges, visible in traces.
- **Role tool/permission scoping**: `spawnRoleSubagent` hard allowlist/deny unchanged; handoff artifact injection adds prompt text only, never tools or permissions.
- **New boundaries introduced**: (1) preset scope tuple — anything outside it prompts; (2) memo influence cap (±2) — routing evidence hierarchy is keywords > memos by construction; (3) memo store is workspace-local, digest-only.
