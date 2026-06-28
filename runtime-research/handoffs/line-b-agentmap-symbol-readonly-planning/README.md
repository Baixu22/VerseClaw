# Line B Planning: AgentMap + Symbol Tool Readonly Foundation

This is a docs-only planning handoff for the next AgentMap and Symbol Tool Layer work. It does not implement runtime code, does not change default behavior, and does not cut over TaskLoop, Gateway, provider ordering, or patch application.

## Planning Status

Line B should be split into four sequential stages, with parallel lanes inside each stage:

1. AgentMap readonly foundation.
2. Symbol Tool readonly foundation.
3. Context Provider shadow integration.
4. Validation and synthesis.

This ordering keeps the higher-risk provider integration behind proven readonly data contracts and fixtures. AgentMap can use Symbol data as an input, but the first AgentMap foundation should also have a fallback tag provider so it does not depend on live LSP availability.

For the implementation-phase document layout, use `development-phases.md`. It expands the plan into Phase 0 through Phase 5 with per-phase boundaries, allowed files, forbidden changes, deliverables, validation, and prompt handoff order.

## Required Reading Completed

Read and used for this plan:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/implementation-roadmap.md`
- `runtime-research/migration-execution-plan.md`
- `runtime-research/aider/algorithms.md`
- `runtime-research/aider/contracts.md`
- `runtime-research/aider/clawx-mapping.md`
- `runtime-research/aider/useful-tests.md`
- `runtime-research/serena/symbol-api.md`
- `runtime-research/serena/clawx-mapping.md`
- `runtime-research/serena/useful-tests.md`
- Selected current code entries under `openclaw_runtime/src/runtime-core`, `openclaw_runtime/src/context-engine`, `openclaw_runtime/src/agents`, and related tests.

Tooling note: `rtk` was not available on PATH in this planning window, so direct no-profile PowerShell was used after the attempted `rtk` calls failed.

## Current Verified Baseline

- `AgentMap` remains planned. Current search did not find a named `AgentMap`, `RepoMap`, PageRank, or AgentMap provider implementation in production code.
- Runtime provider contracts now exist in `openclaw_runtime/src/runtime-core/registries.ts`.
- `ContextItem` already supports `kind: "symbol"` in `openclaw_runtime/src/runtime-core/types.ts`.
- Compatibility context providers exist in `openclaw_runtime/src/context-engine/provider-registry.ts` for `LegacyContextEngine` and `LoopContextPack`, behind explicit shadow/pilot flags.
- Default context provider registry ordering is still `legacy-context-engine` then `loop-context-pack`; memory/trace providers are explicit extras only.
- `openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts` already exposes session-scoped LSP hover/definition/references tools by position, but not Serena-style overview/find-by-name/namePath/diagnostics.
- Runtime discovery still has direct `read`, `grep`, `find`, and `ls` tools under `openclaw_runtime/src/agents/sessions/tools`. These are comparison surfaces for shadow, not targets to remove in this phase.

## Non-Negotiable Boundaries

Allowed for the next implementation phase:

- readonly contracts, ranking, fixtures, diagnostics, and shadow outputs;
- explicit provider injection for tests or diagnostics;
- deterministic unit fixtures and evidence metadata;
- config/task-spec work only when it preserves default-off behavior.

Rejected for this phase:

- default runtime behavior changes;
- TaskLoop, Gateway, provider ordering, or model prompt cutover;
- renderer direct IPC or direct Gateway HTTP/WS calls;
- AST patch apply, symbol edit apply, rename, safe delete, or workspace edit;
- new service, listener, daemon, external database, or always-on LSP service;
- claims about code understanding without path/test/command evidence.

## Stage 1: AgentMap Readonly Foundation

Goal: build a deterministic, budgeted repository map over TypeScript/TSX symbols without feeding it into default prompt assembly.

Allowed changes:

- Add AgentMap contracts for request, ranked file, ranked symbol, scoring reason, render result, and evidence metadata.
- Add a readonly TypeScript/TSX tag provider using TypeScript parser, tree-sitter, or existing LSP symbol data as input.
- Implement Aider-inspired ranking over definition/reference tags, active files, mentioned files, mentioned identifiers, and path components.
- Implement token-budget fitting by selecting fewer symbols and re-rendering, not by blindly truncating prompt text.
- Add fixture tests for deterministic ranking, budget shrinkage, prompt-file exclusion, active-file references, and mentioned identifiers.

Forbidden changes:

- Do not register AgentMap as a default provider.
- Do not change runtime `read`/`grep`/`find`/`ls` behavior.
- Do not inject AgentMap into TaskLoop, Gateway, chat, provider ordering, or model messages.
- Do not make PageRank or scoring opaque; each selected item needs scoring reasons.

Suggested target files:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `openclaw_runtime/src/runtime-core/index.ts` only if exporting pure contracts after tests exist
- `tests/unit/runtime-agent-map-contracts.test.ts`
- `tests/unit/runtime-agent-map-ranking.test.ts`
- `tests/fixtures/agent-map/tsx-electron-workspace/**`

Exit evidence:

- Fixture map is deterministic.
- Active file references lift related definitions.
- Mentioned identifiers lift matching symbols.
- Files already in the prompt/request are excluded or marked as already-present.
- Smaller budgets produce monotonic shrinkage and never partial symbol blocks.

## Stage 2: Symbol Tool Readonly Foundation

Goal: expose Serena-inspired symbol overview/find/references/diagnostics as readonly structured capability, with graceful fallback when LSP is unavailable.

Allowed changes:

- Add `SymbolQuery`, `SymbolResult`, `SymbolReference`, `SymbolDiagnostic`, `SymbolCheckpoint`, and structured error contracts.
- Implement readonly `getSymbolsOverview`, `findSymbol`, `findReferences`, and diagnostics wrappers for TypeScript/TSX.
- Reuse existing session-scoped bundled LSP infrastructure only as an explicit, disposable lower-level client. No always-on daemon or listener.
- Return file, namePath, range, bodyRange, kind, signature, children, snippets, and evidence refs.
- Add checkpoint relocation or drift detection by file + namePath + range.

Forbidden changes:

- Do not implement or expose rename, replace body, insert before/after, safe delete, workspace edit, or patch apply.
- Do not make LSP tools default-on beyond existing configured behavior.
- Do not treat LSP server state as durable checkpoint evidence.
- Do not fallback silently to grep/read without structured reason metadata.

Suggested target files:

- `openclaw_runtime/src/runtime-core/symbols.ts` for pure contracts
- `openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts` only if extending existing explicit LSP request support
- `openclaw_runtime/src/context-engine/symbol-context-provider.ts` only in the later shadow stage
- `tests/unit/runtime-symbol-tool-contracts.test.ts`
- `tests/unit/runtime-symbol-tool-readonly.test.ts`
- `tests/fixtures/symbol-tool/tsx-renderer-main-shared/**`

Exit evidence:

- Document symbols include top-level and nested symbols.
- Same-name and nested symbols disambiguate by namePath/range.
- Cross-file references are grouped by file and include snippets.
- LSP unavailable returns structured fallback/error without crashing.
- Checkpoint relocation succeeds after light drift or reports explicit drift.

## Stage 3: Context Provider Shadow Integration

Goal: wrap AgentMap and Symbol outputs as readonly context provider shadow results while legacy prompt/tool behavior remains authoritative.

Allowed changes:

- Add explicit `createAgentMapContextProvider` and/or `createSymbolContextProvider` factories after Stages 1 and 2 have contracts and tests.
- Use `RuntimeContextProvider` and `RuntimeContextProviderResult` from `openclaw_runtime/src/runtime-core/registries.ts`.
- Register providers only through explicit extra-provider injection in tests or a new flag-gated helper.
- Emit diagnostics and evidence refs showing legacy-authoritative, shadow-only, provider-ordering-unchanged behavior.
- Compare shadow outputs against direct read/grep/find/ls or LoopContextPack inputs only as diagnostics.

Forbidden changes:

- Do not add AgentMap/Symbol providers to default `createContextProviderRegistryPilot()` ordering without a later accepted cutover spec.
- Do not consume provider output in TaskLoop, Gateway, chat, or model messages.
- Do not add renderer/Main host API routes for this stage unless a fresh task spec accepts the boundary.
- Do not bypass `src/lib/host-api.ts`, `src/lib/api-client.ts`, Main-owned Gateway proxy policy, or existing transport policy.

Suggested target files:

- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
- `openclaw_runtime/src/context-engine/symbol-context-provider.ts`
- `tests/unit/context-provider-registry.test.ts`
- `tests/unit/runtime-agent-map-context-provider.test.ts`
- `tests/unit/runtime-symbol-context-provider.test.ts`
- `tests/unit/context-shadow-adapter.test.ts`

Exit evidence:

- Flag-off emits no provider result and preserves legacy output.
- Flag-on shadow emits only diagnostics/context evidence.
- Default registry ordering remains unchanged.
- Provider failures are isolated as diagnostics.
- No renderer direct IPC/Gateway bypass and no service/listener additions.

## Stage 4: Validation And Synthesis

Goal: classify the readonly/shadow implementation evidence and decide whether a later cutover spec is justified.

Allowed changes:

- Add or validate a harness task spec before implementation work starts.
- Run focused unit tests, typecheck, boundary scans, and docs/index updates only after accepted evidence exists.
- Write synthesis under this handoff directory.

Forbidden changes:

- Do not accept unverified lane claims.
- Do not classify readonly/shadow as runtime cutover readiness unless tests prove flag-off parity and default behavior preservation.
- Do not update `agent-runtime-index.md` as implemented unless code and tests actually land.

Suggested validation:

- `pnpm harness context --spec <future-line-b-spec>`
- `pnpm harness validate --spec <future-line-b-spec>`
- Focused Vitest files for AgentMap, Symbol Tool, context provider registry, and config schema if flags change.
- Renderer IPC/Gateway bypass scan if any renderer/Main files are touched.
- Service/listener/daemon scan on touched files.
- Comms replay/compare only if Main/Gateway/host-api/api-client/provider transport paths change.

## Aider Reuse Decision

Reuse:

- tag abstraction: file, line/range, name, kind, definition/reference;
- reference-to-definition graph ranking;
- ranking signals from active files, mentioned files, mentioned identifiers, and path components;
- deweight common/generic names and expose scoring reasons;
- budget fit by reducing symbol count and re-rendering;
- rendered source context around symbol lines with stable ranges.

Do not reuse:

- Aider CLI/chat flow;
- a single model-specific token counter as a hard dependency;
- Markdown-only internal output;
- opaque PageRank output without per-item reasons;
- multi-language parity claims before fixtures exist;
- any behavior that directly replaces ClawX runtime context by default.

## Serena Reuse Decision

Reuse:

- relative path + line/column symbol location;
- namePath-based lookup and disambiguation concepts;
- overview/find/references/diagnostics tool shape;
- structured LSP fallback/error behavior;
- symbol checkpoint relocation by file + namePath + range;
- evidence-first structured results instead of only text.

Do not reuse in this phase:

- rename, replace body, insert, safe delete, workspace edit, or any editing tool;
- full multi-language promise before TypeScript/TSX fixtures pass;
- treating a live language server as durable state;
- grep/read discouragement hooks as user-visible behavior;
- automatic provider ordering or prompt cutover.

## Existing Code Landing Matrix

| Area | Current verified path | Use in Line B |
|---|---|---|
| Runtime context/tool contracts | `openclaw_runtime/src/runtime-core/types.ts`, `openclaw_runtime/src/runtime-core/registries.ts` | Reuse `ContextItem`, provider manifest/result, diagnostics, evidence refs. |
| Context provider pilot | `openclaw_runtime/src/context-engine/provider-registry.ts` | Add only explicit extra-provider factories after readonly contracts exist. |
| Legacy context engine | `openclaw_runtime/src/context-engine/legacy.ts` | Parity baseline only. |
| Loop context pack | `openclaw_runtime/src/agents/loop-context-pack.ts` | Budget/evidence pattern and parity baseline, not AgentMap replacement. |
| LSP lower layer | `openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts`, `openclaw_runtime/src/agents/embedded-agent-lsp.ts`, `openclaw_runtime/src/plugins/bundle-lsp.ts` | Possible disposable LSP client/reference for Symbol Tool; no new daemon. |
| Direct discovery tools | `openclaw_runtime/src/agents/sessions/tools/read.ts`, `grep.ts`, `find.ts`, `ls.ts` | Shadow comparison surfaces only. |
| Runtime config gates | `openclaw_runtime/src/config/types.openclaw.ts`, `zod-schema.ts`, `schema.help.ts` | Touch only if a future spec accepts new default-off flags. |
| Existing tests | `tests/unit/runtime-provider-tool-registry.test.ts`, `context-provider-registry.test.ts`, `context-shadow-adapter.test.ts`, `loop-context-pack.test.ts` | Extend for provider shadow parity where relevant. |

## Recommended Parallel Lanes

Use `parallel-lanes.md` for the full split. Suggested lane groups:

- `line-b-a-agentmap-contracts-ranking`
- `line-b-b-symbol-readonly-contracts`
- `line-b-c-agentmap-render-budget-fixtures`
- `line-b-d-context-provider-shadow-boundary`
- `line-b-e-validation-synthesis-readiness`

Lane A and Lane B can start in parallel because AgentMap contracts can define a fallback tag provider while Symbol readonly researches/implements LSP-backed symbol retrieval. Lane C depends on Lane A contracts. Lane D depends on at least one readonly result shape from A or B. Lane E runs last.

## Open Questions

| Question | Why it matters | Blocking |
|---|---|---|
| Should AgentMap contracts live in `runtime-core` or a dedicated `openclaw_runtime/src/agent-map` package? | `runtime-core` keeps contracts canonical; a dedicated package keeps file/LSP IO away from core. | no for planning, yes before code. |
| Should Symbol readonly extend existing bundled LSP runtime or create a separate pure wrapper? | Avoids duplicating JSON-RPC, but existing runtime is tool/session oriented. | yes before Symbol implementation. |
| Which token estimator should AgentMap use first? | Existing providers use char/4 estimates; Aider-style budget may need a shared estimator later. | no for fixtures. |
| Should future AgentMap shadow compare against direct runtime tools, LoopContextPack, or both? | Determines instrumentation scope and risk. | no for readonly foundation. |

## Conclusion

Line B is ready to proceed as a readonly/shadow-only next phase after a task spec is written and validated. The accepted plan is to build AgentMap and Symbol Tool foundations first, then wrap them as explicit context provider shadows, and only then run validation/synthesis. Runtime cutover and patch application remain out of scope.

Status: accepted
