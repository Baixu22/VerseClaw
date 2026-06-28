# Line B Window Prompts

Use these prompts for future implementation or validation windows. They preserve readonly/shadow boundaries. This planning handoff did not run these lanes.

## Lane A Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B Lane A: AgentMap contracts and ranking.

Goal:
Build or prepare the readonly AgentMap foundation: TypeScript/TSX symbol tags, explainable ranking, and evidence-bearing result contracts. Do not implement provider cutover, TaskLoop/Gateway integration, provider ordering changes, or patch apply.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read runtime-research/agent-runtime-index.md.
- Read runtime-research/implementation-roadmap.md.
- Read runtime-research/migration-execution-plan.md.
- Read runtime-research/aider/algorithms.md.
- Read runtime-research/aider/contracts.md.
- Read runtime-research/aider/clawx-mapping.md.
- Read runtime-research/aider/useful-tests.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md.
- Read openclaw_runtime/src/runtime-core/types.ts and registries.ts.

Boundary:
- readonly only.
- No default runtime behavior change.
- No context provider registration by default.
- No TaskLoop/Gateway/provider ordering cutover.
- No AST patch apply.
- No new service/listener/daemon/external database.

Suggested files:
- openclaw_runtime/src/runtime-core/agent-map.ts
- tests/unit/runtime-agent-map-contracts.test.ts
- tests/unit/runtime-agent-map-ranking.test.ts
- tests/fixtures/agent-map/**

Required evidence:
- Active file reference raises related definitions.
- Mentioned identifier raises matching symbols.
- Files already in request/prompt are excluded or marked as already present.
- Ranking reasons are visible per file/symbol.
- Output is deterministic on fixtures.

Write:
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-a-agentmap-contracts-ranking.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane B Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B Lane B: Symbol Tool readonly contracts.

Goal:
Build or prepare Serena-inspired readonly symbol overview/find/references/diagnostics contracts for TypeScript/TSX. Do not implement rename, replace body, insert, safe delete, workspace edit, patch apply, provider cutover, or default LSP behavior changes.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read runtime-research/agent-runtime-index.md.
- Read runtime-research/serena/symbol-api.md.
- Read runtime-research/serena/clawx-mapping.md.
- Read runtime-research/serena/useful-tests.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md.
- Read openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts.
- Read openclaw_runtime/src/agents/embedded-agent-lsp.ts.
- Read openclaw_runtime/src/plugins/bundle-lsp.ts.
- Read openclaw_runtime/src/runtime-core/types.ts and registries.ts.

Boundary:
- readonly only.
- Structured fallback if LSP is unavailable.
- No persistent LSP checkpoint claims.
- No new always-on LSP service, listener, or daemon.
- No edit/apply capability.

Suggested files:
- openclaw_runtime/src/runtime-core/symbols.ts
- openclaw_runtime/src/agents/agent-bundle-lsp-runtime.ts only if reusing existing explicit LSP request support
- tests/unit/runtime-symbol-tool-contracts.test.ts
- tests/unit/runtime-symbol-tool-readonly.test.ts
- tests/fixtures/symbol-tool/**

Required evidence:
- Overview returns top-level and nested symbols.
- findSymbol handles same-name and nested namePath disambiguation.
- findReferences groups cross-file references and snippets.
- diagnostics returns structured results.
- LSP unavailable returns structured error/fallback, not a crash.
- Symbol checkpoint relocation or drift detection is tested.

Write:
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-b-symbol-readonly-contracts.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane C Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B Lane C: AgentMap render, budget, and fixtures.

Goal:
Build or prepare AgentMap rendering and token-budget fit over Lane A contracts. Preserve stable symbol blocks, line/range evidence, and deterministic snapshots. Do not feed rendered AgentMap into runtime prompts by default.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read Lane A submission when it exists.
- Read runtime-research/aider/algorithms.md.
- Read runtime-research/aider/useful-tests.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md.
- Read openclaw_runtime/src/agents/loop-context-pack.ts for existing budget/evidence patterns.

Boundary:
- readonly only.
- No prompt cutover.
- No provider ordering change.
- No read/grep/find/ls behavior change.
- No partial symbol-block truncation.

Suggested files:
- openclaw_runtime/src/runtime-core/agent-map.ts
- tests/unit/runtime-agent-map-renderer.test.ts
- tests/unit/runtime-agent-map-budget.test.ts
- tests/fixtures/agent-map/**

Required evidence:
- File grouped output has relative paths, line/range metadata, and symbol names.
- Smaller token budgets monotonically reduce included symbols.
- Renderer does not truncate in the middle of a symbol block.
- Snapshot fixture remains stable.
- Cache invalidation is tested if caching is introduced.

Write:
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-c-agentmap-render-budget-fixtures.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane D Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B Lane D: context provider shadow boundary.

Goal:
Wrap AgentMap and/or Symbol readonly outputs as explicit RuntimeContextProvider shadow results. Do not register them by default or consume them in TaskLoop, Gateway, chat, or model prompt assembly.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read runtime-research/agent-runtime-index.md.
- Read runtime-research/handoffs/phase-3-provider-tool-registry-pilot/submissions/lane-b-context-provider-registry-pilot.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md.
- Read Lane A and/or Lane B submissions when they exist.
- Read openclaw_runtime/src/runtime-core/registries.ts.
- Read openclaw_runtime/src/context-engine/provider-registry.ts.
- Read tests/unit/context-provider-registry.test.ts.

Boundary:
- explicit provider factory only.
- Flag-off/default ordering parity required.
- No TaskLoop/Gateway/provider ordering/default cutover.
- No renderer direct IPC or Gateway bypass.
- No service/listener/daemon/external database.

Suggested files:
- openclaw_runtime/src/context-engine/provider-registry.ts
- openclaw_runtime/src/context-engine/agent-map-context-provider.ts
- openclaw_runtime/src/context-engine/symbol-context-provider.ts
- tests/unit/context-provider-registry.test.ts
- tests/unit/runtime-agent-map-context-provider.test.ts
- tests/unit/runtime-symbol-context-provider.test.ts

Required evidence:
- Flag-off emits no AgentMap/Symbol provider output.
- Flag-on shadow emits diagnostics/context evidence only.
- Default `createContextProviderRegistryPilot()` ordering remains unchanged unless an accepted spec says otherwise.
- Provider failures are isolated as diagnostics.
- Legacy prompt/message/tool behavior is unchanged.
- Boundary scans pass if renderer/Main/Gateway paths are touched.

Write:
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-d-context-provider-shadow-boundary.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Lane E Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B Lane E: validation and synthesis readiness.

Prerequisite:
Only continue when Lane A-D submissions exist. If any are missing, stop and report missing submissions.

Goal:
Validate the AgentMap + Symbol readonly/shadow evidence. Re-verify claims; do not accept unproven lane text.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read runtime-research/agent-runtime-index.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/parallel-lanes.md.
- Read all Lane A-D submissions.
- Read touched source and test files.

Required checks:
- Confirm A-D each has exactly one valid Status line.
- Reclassify A-D as accepted / needs_revision / blocked.
- Run future Line B harness context/validate if a spec exists; otherwise mark missing spec as a synthesis prerequisite.
- Run focused AgentMap, Symbol Tool, context-provider, and config tests touched by A-D.
- Run typecheck if code changed.
- Run renderer IPC/Gateway bypass scan if renderer/Main paths changed.
- Run service/listener/daemon scan over touched files.
- Run comms replay/compare only if Main/Gateway/host-api/api-client/provider transport paths changed.

Write:
runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-e-validation-synthesis-readiness.md

Include exactly one final Status line: Status: accepted / needs_revision / blocked
```

## Synthesis Owner Prompt

```text
Workspace: C:\Users\27933\Desktop\clawx\ClawX

You are Line B synthesis owner: AgentMap + Symbol Tool readonly/shadow synthesis.

Prerequisite:
Only continue when Lane A-E submissions exist. If any are missing, stop and report missing submissions.

Goal:
Synthesize Line B evidence for AgentMap readonly, Symbol Tool readonly, Context Provider shadow, and validation readiness. Do not accept runtime cutover, provider ordering cutover, TaskLoop/Gateway integration, or patch apply.

Required first:
- Read AGENTS.md.
- Read C:\Users\27933\.codex\RTK.md and use rtk if available; if unavailable, record the fallback.
- Read runtime-research/agent-runtime-index.md.
- Read runtime-research/implementation-roadmap.md.
- Read runtime-research/migration-execution-plan.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md.
- Read runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/parallel-lanes.md.
- Read all Lane A-E submissions.
- Read touched source and test files.

Tasks:
1. Confirm A-E each has exactly one Status line.
2. Reclassify A-E as accepted / needs_revision / blocked.
3. Re-run focused tests and scans needed to verify lane claims.
4. Write runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/synthesis.md.
5. Update runtime-research/agent-runtime-index.md only if implementation evidence landed and synthesis accepts it.

Must preserve boundaries:
- readonly/shadow only.
- no default runtime behavior change.
- no TaskLoop/Gateway/provider ordering/default cutover.
- no AST patch apply or symbol edit apply.
- no new service/listener/daemon/external database.
- no renderer/Main/host-api/api-client boundary bypass.
- no unverified code understanding claims.

Final conclusion must contain exactly one:
Status: accepted / needs_revision / blocked
```
