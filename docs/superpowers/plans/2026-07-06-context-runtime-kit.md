# Context Runtime Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local agent runtime context layer where persistent facts are addressable through CVK resources/selectors, dynamic conversation state is preserved through `CompressionArtifact`, and prompt assembly exposes only the context needed for the current turn.

**Architecture:** CVK owns persistent truth (`resource_id`, selector, chunk, checksum, compact view). Existing Compact / `CompressionArtifact` owns dynamic state and references CVK evidence instead of absorbing long facts. The Context Router assembles a budgeted prompt projection, while Verifier gates selector resolution, checksum validity, hard claims, tool schema expansion, and compact recovery.

**Tech Stack:** TypeScript, Node.js, OpenClaw runtime context engine, existing compaction harness, JSON/JSONL, SQLite where a local index is required, Vitest, existing context-compression eval runner, harness specs.

## Global Constraints

- Do not create a parallel `.trellis/` or independent durable policy source; reusable policy belongs under `harness/specs/**`.
- Preserve the renderer/Main/runtime boundary: renderer must use host-api/api-client and must not call Gateway HTTP endpoints directly.
- Keep automatic behavior shadow-first until evaluation gates prove safety; existing prompt text remains authoritative during pilot phases.
- Do not replace `CompressionArtifact v1`, `LoopContextPack`, Task Ledger, ClawGraph, Observability, or Memory; integrate through explicit references and projections.
- Compact artifacts must not mutate Task Ledger, ClawGraph, Memory, Knowledge, or durable workflow state automatically.
- Summary, view, and compact projection are navigation/recovery surfaces only; hard facts require `resource_id + selector + checksum`.
- Prefer structured parsers for tool schema, skill manifests, project rules, and code symbols; do not rely on LLM extraction for deterministic hard constraints.
- Any user-visible UI change requires i18n coverage and Electron E2E coverage in the same development branch.
- Backend communication or host-api changes require a task spec under `harness/specs/tasks/` and harness validation before review.
- Documentation updates must consider `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after functional or architecture changes.

---

## 1. Product Intent

Context Runtime Kit is a base-layer upgrade for long-running local agents. Its purpose is not to make shorter prompts for their own sake. Its purpose is to turn context into a set of verifiable runtime assets:

- **Persistent facts** are stored as addressable resources.
- **Dynamic state** is stored as compact, structured recovery state.
- **Prompt text** becomes a per-turn projection, not the source of truth.
- **Tools, skills, plugins, rules, docs, code, traces, and memory** are exposed lazily through compact views and exact selectors.
- **Evaluation** proves token savings did not degrade hard-constraint recall, selector resolution, or recovery quality.

The expected end state is that an agent can work across long conversations without carrying every skill, tool schema, project rule, transcript, or code chunk in the context window. It should carry a stable resource map, a short set of relevant views, current recovery state, and only the chunks needed for the next action.

## 2. Non-Goals

- Do not build a generic hosted RAG platform.
- Do not introduce a vector database as the primary source of truth.
- Do not make summary text authoritative for hard claims.
- Do not expose all skills or all MCP tools to the model by default.
- Do not replace existing compaction, memory, observability, Task Ledger, ClawGraph, or ContextPack systems.
- Do not promote automatic prompt changes before shadow evidence and explicit gates are green.
- Do not attempt a full code call graph, full semantic memory rewrite, GUI, or cross-language SDK in the first version.

## 3. Core Model

The runtime must keep three layers separate:

```text
Layer A: Persistent Truth
  Owned by CVK.
  Includes skills, tool schemas, MCP descriptors, plugin manifests, AGENTS.md,
  harness specs, docs, code indexes, trajectories, memory references, and traces.

Layer B: Dynamic State
  Owned by Compact / CompressionArtifact.
  Includes current objective, phase, progress, decisions, failed attempts,
  active resources, next action, unverified claims, and evidence references.

Layer C: Prompt Projection
  Owned by Context Router.
  Includes instruction kernel, resource map, compact views, compact recovery
  projection, prefetched chunks, current user task, and output/reserve budget.
```

Hard rule:

```text
Persistent Truth must not be absorbed into Compact as unverified prose.
Compact can carry state, decisions, pointers, retrieval traces, and evidence refs.
```

## 4. Existing System Integration Points

Use these existing surfaces instead of creating a second runtime:

- `openclaw_runtime/src/context-engine/**`: provider registry, context item contracts, shadow provider pattern.
- `openclaw_runtime/packages/agent-core/src/harness/compaction/**`: compression planner, telemetry, and `CompressionArtifact`.
- `openclaw_runtime/src/memory/context-pack.ts`: current role-aware ContextPack budget buckets and injection explain logs.
- `shared/host-api/contract.ts`: host API types for compression artifact, recovery context, compaction history, and future read-only surfaces.
- `scripts/context-compression-eval-runner.mjs`: existing compression evaluation runner, fact recall metrics, judge integration, continuation/recovery checks.
- `tests/unit/context-compression-eval.test.ts`: existing regression shape for compression evidence and recovery behavior.
- `docs/enhancements/05-adaptive-context-budget.md`: current adaptive budget design and shadow-first constraints.
- `docs/clawx-design-overview.md`: product boundaries for long conversation control, Task Ledger, ClawGraph, Observability, ContextPack, and compaction.

## 5. Component Boundaries

### 5.1 CVK Compiler

Responsibility:

- Compile persistent sources into resources, chunks, views, selector indexes, checksums, and build reports.

Initial source types:

- `toolset`: OpenAPI / JSON schema / MCP tool descriptors.
- `skill`: Codex/OpenClaw skill files and required workflows.
- `project_rule`: AGENTS.md and harness rule/spec references.
- `document`: Markdown docs and structured design documents.
- `codebase`: file index and symbol/range index.

Does not own:

- Dynamic conversation state.
- Tool execution.
- Task completion truth.
- Prompt rendering policy.

### 5.2 Artifact Store

Responsibility:

- Store CVK resources and selector indexes in a local, inspectable format.

Initial format:

```text
.cvk/
  manifest.json
  resources.json
  chunks.jsonl
  views.json
  selector-index.json
  checksums.json
  build-report.json
```

SQLite may be introduced when selector lookup or query performance requires it. JSON/JSONL remains the debugging and reproducibility baseline.

### 5.3 Selector Resolver

Responsibility:

- Resolve `resource_id + selector -> chunk`.
- Validate checksum.
- Report missing, stale, or ambiguous selectors.

Initial selector grammar:

```text
skill:<section>
schema:tool.<tool_name>.required
schema:tool.<tool_name>.field.<field_name>
schema:tool.<tool_name>.enum.<field_name>
doc:sec.<section_id>
doc:heading.<slug>
code:file.<path>#L<start>-L<end>
code:symbol.<symbol_name>
rule:<rule_name>
trace:<run_id>.<event_id>
```

### 5.4 View Generator

Responsibility:

- Generate short navigation-only views for the model.
- Include `hard_selectors` or `must_expand_before_call` where exact chunks are required.

Views must be:

- Short.
- Stable.
- Explicitly navigation-only.
- Backed by source chunk references.
- Safe to show without leaking secrets.

### 5.5 Context Router

Responsibility:

- Assemble prompt bundles under token budget.
- Decide which views and chunks are included.
- Reserve budget for output and later retrieval.
- Record retrieval plans and retrieval traces.

Prompt assembly order:

```text
1. Instruction Kernel
2. Resource Map
3. Compact Views
4. CompressionArtifact Projection
5. Prefetched / Selected Chunks
6. Current User Task
```

The router's most important job is deciding what not to inject.

### 5.6 Compact / CompressionArtifact

Responsibility:

- Compress dynamic state into a structured recovery artifact.
- Preserve evidence refs, unverified claims, failed attempts, and next action selectors.
- Project itself into smaller prompt-ready recovery summaries.

Compact does not:

- Store large raw facts when those facts can be addressed through CVK.
- Become the source of truth for project rules, tool schemas, code, docs, memory, or task completion.
- Auto-mutate Task Ledger or other durable workflow state.

### 5.7 Verifier

Responsibility:

- Enforce resolution and evidence gates.

Initial gates:

- Selector Resolution Gate.
- Checksum Gate.
- Hard Claim Gate.
- Tool Call Gate.
- Recovery Gate.
- Compression Quality Gate.

The first implementation can validate reference-chain completeness without full semantic entailment. Later versions can add claim-evidence entailment.

## 6. Expected Runtime Flow

```text
1. Project opens or context changes.
2. CVK compiler builds or refreshes persistent resource artifacts.
3. Agent starts a turn.
4. Context Router selects resource map, compact views, compact projection, and prefetched chunks.
5. Model plans work using views as navigation.
6. If a tool is needed, router/verifier ensures required schema selectors are expanded.
7. If docs/code/rules are needed, search may find candidates but final evidence comes from resolved chunks.
8. Tool/file/test outputs produce retrieval and execution traces.
9. Compact updates dynamic state as a reducer.
10. Recovery uses CompressionArtifact + CVK resources/selectors, not full transcript replay.
```

## 7. Lazy Exposure Strategy

Expose skills and tools in three levels:

```text
Level 0: Registry View
  Names, short purpose, trigger hints, resource_id.

Level 1: Compact View
  Entry points, key fields, required workflows, must-expand selectors.

Level 2: Raw Chunk
  Original required workflow, schema required fields, enum/type constraints,
  permission notes, side effects, and exact source spans.
```

Default prompt should include Level 0 and only the most relevant Level 1 views. Level 2 chunks are included only when required by task, prefetch policy, or verifier gate.

## 8. CompressionArtifact Extensions

Future artifacts should preserve the existing v1 shape while adding CVK-compatible references through additive fields.

Recommended additive fields:

```ts
type CvkEvidenceRef = {
  resource_id: string;
  selector: string;
  checksum?: string;
  label?: string;
  kind?: "skill" | "toolset" | "document" | "project_rule" | "codebase" | "trace" | "memory" | "other";
};

type RetrievalTraceEntry = {
  resource_id: string;
  selector: string;
  chunk_id?: string;
  checksum?: string;
  token_count?: number;
  reason: "prefetch" | "tool_call_gate" | "hard_claim" | "recovery" | "user_requested" | "model_requested";
};
```

Recommended artifact sections:

- `retrievedContext`: selectors actually fetched during the compacted window.
- `requiredSelectors`: selectors required for next action or recovery.
- `capabilityActivations`: skills/tools/project rules activated during the session.
- `unverifiedClaims`: claims that must remain visibly uncertain after compaction.
- `staleReferences`: evidence refs that no longer match the current resource version.

Compatibility rule:

```text
Existing CompressionArtifact consumers must continue working when these fields are absent.
```

## 9. Metrics and Acceptance Standards

### 9.1 Core Metrics

- **TSR, Token Saving Rate:** `1 - T_cvk / T_baseline`.
- **CRR, Context Repetition Reduction:** reduction in repeated context across turns.
- **ER, Expansion Ratio:** retrieved raw tokens divided by total raw resource tokens.
- **SC, Source Coverage:** covered source spans divided by eligible source spans.
- **SS, Selector Stability:** selectors unchanged across identical input builds.
- **AR, Artifact Reproducibility:** identical artifact hashes across repeated builds.
- **RRR, Reference Resolution Rate:** resolvable refs divided by total refs.
- **HCR, Hard Constraint Recall:** correctly used hard constraints divided by required constraints.
- **UCR, Unsupported Claim Rate:** hard claims without valid evidence divided by hard claims.
- **ERR, Evidence Retention Rate:** preserved required evidence refs after compact.
- **RFS, Recovery Fidelity Score:** recovery tasks resumed correctly after transcript removal.
- **Tool Call Validity:** valid tool calls divided by total tool calls.
- **Skill Routing Accuracy:** correct skill selected and required workflow expanded.

### 9.2 Level 1: Usable

```text
TSR >= 40%
CRR >= 60%
SC >= 99%
RRR >= 99%
HCR >= 95%
ERR >= 95%
RFS >= 90%
Tool Call Validity >= 95%
```

### 9.3 Level 2: Reliable

```text
TSR >= 60%
CRR >= 80%
SC = 100%
SS = 100%
AR = 100%
RRR = 100%
HCR >= 98%
UCR <= 1%
ERR = 100%
RFS >= 95%
Tool Call Validity >= 98%
```

### 9.4 Level 3: Strict

```text
TSR >= 70%
CRR >= 90%
SC = 100%
SS = 100%
AR = 100%
RRR = 100%
HCR = 100%
UCR <= 0.5%
ERR = 100%
RFS >= 98%
Tool Call Validity >= 99%
```

Priority rule:

```text
SC / SS / AR / RRR / HCR / ERR / RFS take priority over TSR.
Saving tokens by losing evidence is a failed result.
```

## 10. Benchmark Coverage

### 10.1 Tool Schema Benchmark

Tests:

- Correct tool selection.
- Required field expansion.
- Enum/type/default/nullable expansion.
- Permission and side-effect awareness.
- Error code retrieval.

Primary metrics:

- Tool Call Validity.
- Required Missing Rate.
- Enum Error Rate.
- HCR.
- TSR.

### 10.2 Skill Routing Benchmark

Tests:

- 50+ skills available as registry view only.
- Correct skill selected.
- Required workflow expanded before action.
- Irrelevant skill content not injected.

Primary metrics:

- Skill Routing Accuracy.
- Workflow Expansion Rate.
- Unnecessary Skill Exposure Tokens.
- RRR.

### 10.3 Project Rule Benchmark

Tests:

- AGENTS.md and harness rules compiled.
- Coding task follows required rules.
- Violations are detected or avoided.
- Rules are cited through selectors.

Primary metrics:

- Rule Recall.
- Rule Violation Rate.
- Evidence Ref Rate.
- HCR.

### 10.4 Codebase Benchmark

Tests:

- Locate symbol.
- Explain call relationship.
- Modify code through patch.
- Select related tests.
- Recover after failed test trace.

Primary metrics:

- Symbol Hit Rate.
- Patch Correctness.
- Test Pass Rate.
- Unnecessary Context Ratio.
- RFS for recovery tasks.

### 10.5 Compact Recovery Benchmark

Tests:

- Start a long task.
- Generate compact artifact.
- Remove transcript context.
- Resume using compact projection plus CVK selectors.
- Avoid repeating known failed attempts.

Primary metrics:

- RFS.
- ERR.
- Failed Attempt Repetition Rate.
- Next Action Accuracy.
- Unverified Claim Retention.

## 11. Implementation Roadmap

### Phase 0: Specification and Harness Entry Point

Purpose: freeze the minimum protocol before implementation.

Deliverables:

- Task spec under `harness/specs/tasks/context-runtime-kit.md`.
- Rule specs for selector stability, evidence references, and compact boundaries.
- Development docs linking this plan to existing compaction and context-engine boundaries.

Acceptance:

- `pnpm harness context --spec harness/specs/tasks/context-runtime-kit.md` returns the intended reading list.
- `pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md` passes.
- The spec states shadow-first rollout and forbids replacing existing compaction paths.

### Phase 1: Protocol Types and Artifact Shape

Purpose: define stable data contracts without changing runtime prompt behavior.

Files likely touched:

- `shared/types/context-runtime-kit.ts` or an equivalent shared type module.
- `openclaw_runtime/src/context-engine/**` for type-only integration if needed.
- `tests/unit/**` for pure contract tests.

Deliverables:

- `ResourceId`.
- `Selector`.
- `Chunk`.
- `CompactView`.
- `CvkEvidenceRef`.
- `RetrievalTraceEntry`.
- `PromptBundle`.
- `VerificationResult`.

Acceptance:

- Pure unit tests validate stable JSON serialization.
- Invalid resource IDs and selectors are rejected with explicit errors.
- No runtime prompt behavior changes.

### Phase 2: Toolset / Skill / Project Rule Compiler

Purpose: prove that hard constraints can be selectorized before addressing broad documents or code.

Files likely touched:

- `openclaw_runtime/src/context-engine/cvk/**` or a similarly scoped runtime module.
- `tests/unit/context-engine/**`.
- Example fixtures under `tests/fixtures/context-runtime-kit/**`.

Deliverables:

- Tool schema compiler for required fields, enum values, field types, defaults, nullable, permissions, and side effects.
- Skill compiler for summary, triggers, required workflow, safety rules, examples, and full source.
- Project rule compiler for AGENTS.md and selected harness rule references.
- Build report with source coverage and artifact hash.

Acceptance:

- SC = 100% for eligible fixture sources.
- RRR = 100% for generated selectors.
- AR = 100% for repeated fixture builds.
- No LLM dependency.

### Phase 3: Selector Resolver and Checksum Verifier

Purpose: make selector references enforceable.

Deliverables:

- `resolveSelector(resourceId, selector)`.
- `getChunk(resourceId, selector)`.
- Batch `getChunks`.
- Checksum validation.
- Missing/stale selector diagnostics.

Acceptance:

- Resolver tests cover valid, missing, stale, and wrong-resource selectors.
- Batch resolution preserves order and reports per-item errors.
- Checksums fail closed.

### Phase 4: View Generator and Lazy Exposure

Purpose: replace all-at-once skill/tool exposure with registry and compact views.

Deliverables:

- Registry view for skill/tool/project rule resources.
- Compact view with `hard_selectors` and `must_expand_before_call`.
- Navigation-only marker in every view.
- Token estimates for each view.

Acceptance:

- Fixtures with 50 skills expose only registry view by default.
- Selected skill expands only required workflow selectors.
- Tool compact view includes every required selector needed for Tool Call Gate.

### Phase 5: Context Router Shadow Provider

Purpose: connect to existing context-engine as shadow-only output.

Files likely touched:

- `openclaw_runtime/src/context-engine/provider-registry.ts`.
- New provider module under `openclaw_runtime/src/context-engine/**`.
- Context-engine tests.

Deliverables:

- Shadow provider that emits resource map, compact views, budget report, and retrieval plan.
- Diagnostics proving legacy prompt text remains unchanged.
- Feature flags default off.

Acceptance:

- Existing prompt rendering tests are unchanged.
- Shadow provider diagnostics include `shadowOnly: true` and `legacyAuthoritative: true`.
- Budget report identifies omitted resources and reasons.

### Phase 6: Tool Call Gate

Purpose: enforce schema hard constraints before tool calls.

Deliverables:

- Gate policy that maps tool name to required selectors.
- Verification that required/enum/type/default/nullable/permission/side-effect selectors were retrieved.
- Structured blocked result for missing selectors.

Acceptance:

- Tool calls without required selectors are blocked in tests.
- Tool calls with all required selectors pass.
- Missing selectors are returned in deterministic order.
- Gate can run in report-only mode before active enforcement.

### Phase 7: CompressionArtifact Integration

Purpose: make compact artifacts carry state plus CVK evidence references.

Files likely touched:

- `openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact.ts`.
- Shared host API contract types if exposed to UI or Main.
- Existing compression artifact tests.

Deliverables:

- Additive evidence/ref fields.
- Retrieval trace preservation.
- Required selectors for next action.
- Stale reference diagnostics.
- Projection logic that preserves blockers, failed attempts, unverified claims, and required selectors under minimal budget.

Acceptance:

- Existing artifact consumers pass unchanged.
- ERR = 100% in compact recovery fixtures.
- Unverified claims survive compact and projection.
- Long raw chunks are not embedded when selector refs are available.

### Phase 8: Recovery Context Integration

Purpose: recover from compact + CVK instead of transcript replay.

Deliverables:

- Recovery projection that includes resource map, required selectors, unresolved claims, failed attempts, and next action.
- Recovery verifier that checks refs are resolvable and current.
- Stale code/doc resource handling.

Acceptance:

- Compact recovery benchmark reaches Level 1 thresholds.
- Recovery fails visibly when required selectors are missing.
- Stale references are marked, not silently trusted.

### Phase 9: Codebase Index MVP

Purpose: provide enough code indexing for practical coding tasks without full graph complexity.

Deliverables:

- File index.
- Symbol index.
- Line-range selectors.
- Import dependency hints.
- Related-test mapping where cheap and deterministic.

Acceptance:

- Symbol lookup fixtures have RRR = 100%.
- Changed commit/hash creates a new resource or marks old refs stale.
- Code selectors do not drift within identical input builds.

### Phase 10: Eval and Reporting

Purpose: prove the system is not just architecture theater.

Deliverables:

- Eval fixtures for tool schema, skill routing, project rules, code symbol, and compact recovery.
- Metrics report compatible with existing output style.
- Acceptance gate summaries.

Acceptance:

- Level 1 gates pass before active pilot.
- Level 2 gates pass before default-on behavior.
- Reports include worst-case failures, not just averages.
- Secret scan passes for generated artifacts.

## 12. Verification Commands

Use targeted commands during implementation:

```powershell
pnpm exec vitest run tests/unit/context-compression-eval.test.ts
pnpm exec vitest run tests/unit/context-engine
pnpm run typecheck
pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
```

Use broader gates when changing host API, renderer UI, or Agent Dev control-plane behavior:

```powershell
pnpm agent-dev:fast
pnpm run harness:ci
pnpm run test:e2e tests/e2e/<relevant-spec>.ts
```

For communication-path changes, also run:

```powershell
pnpm run comms:replay
pnpm run comms:compare
```

## 13. Rollout Plan

```text
Shadow:
  Build artifacts and router diagnostics.
  Do not change prompt text or tool-call behavior.

Report-only:
  Run Verifier gates and emit would-block diagnostics.
  Do not block live calls.

Pilot:
  Enable lazy exposure and gates for selected fixtures/tasks.
  Keep disable-only rollback flag.

Active:
  Use CVK views and selected chunks in prompt assembly.
  Enforce tool-call hard gates for supported toolsets.

Default-on:
  Only after Level 2 metrics pass and operator docs are updated.
```

Rollback must be disable-only:

```text
If CVK artifacts, router, or verifier fail, fall back to existing ContextPack and compaction behavior.
Do not require data migration to disable the feature.
```

## 14. Future Outlook

When the base layer is stable, the expected gains are:

- Large skill libraries become navigable without prompt bloat.
- MCP/tool packages can be discovered and expanded lazily.
- Long conversations rely less on transcript replay and more on compact state plus verifiable references.
- Coding tasks can recover by reopening exact code selectors, failed test traces, and next-action selectors.
- Project rules and harness specs become auditable runtime resources instead of fragile prompt text.
- Token savings become measurable alongside quality and recovery metrics.
- The runtime can support larger local agent ecosystems without making every agent carry every available capability.

Longer-term extensions:

- SQLite FTS5 or Tantivy-backed search for selector discovery.
- Tree-sitter/LSP code symbol graph.
- MCP adapter for dynamic toolset resource compilation.
- Skill marketplace registry view with versioned resource IDs.
- Claim-evidence entailment after reference-chain gates are reliable.
- UI evidence inspector for resource/selector/chunk/checksum trails.
- Budget planner that optimizes stable prefix, dynamic suffix, cache reuse, and retrieval reserve.

## 15. Design Bottom Lines

- Summary cannot be a fact source.
- Selector stability is non-negotiable.
- Checksum must travel with evidence references.
- Compact must preserve uncertainty instead of flattening it into confidence.
- Tool calls must verify schema hard constraints before execution.
- Search discovers candidates; resolved chunks provide evidence.
- Prompt is a projection. It is not the durable context store.

## 16. Execution Options

Plan complete and saved to this file. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per phase/task, review between tasks, and keep each deliverable independently testable.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Implementation should begin with Phase 0 only: create the harness task spec and validation reading list, then stop for review before touching runtime behavior.
