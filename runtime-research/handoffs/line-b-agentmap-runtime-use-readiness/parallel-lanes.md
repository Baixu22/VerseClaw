# Line B AgentMap Runtime-Use Readiness Parallel Lanes

All lanes are default-off and readonly/shadow only. They may harden AgentMap for future runtime use, but they must not cut over TaskLoop, Gateway, provider ordering, default prompt assembly, or direct discovery tools.

## Shared Acceptance Rules

Each accepted lane must include:

- exact files read and changed;
- path/function/test/command evidence for each claim;
- proof that default runtime behavior is unchanged;
- proof that AgentMap remains default-off and non-authoritative;
- proof that TaskLoop, Gateway, provider ordering, and model prompt assembly are not cut over;
- proof that `read`, `grep`, `find`, and `ls` are not replaced;
- proof that no AST patch apply, symbol edit apply, workspace edit, rename, or safe delete was introduced;
- proof that no service, listener, daemon, always-on LSP service, or external database was introduced;
- focused unit tests and fixture evidence;
- boundary scans when touched files require them.

Use `needs_revision` for missing evidence, default-on behavior, provider ordering changes, prompt consumption, direct discovery replacement, mutation/edit/apply behavior, unisolated provider failure, cache invalidation gaps, or unverified runtime-use claims.

## Lane A: Real Repository Fixtures And Ranking Hardening

LANE_ID: `line-b-runtime-a-fixtures-ranking-hardening`

LANE_TITLE: Real repository fixtures, deterministic ranking, and readiness evidence

LANE_SCOPE:

- Add or refresh realistic AgentMap fixtures using repository-shaped TypeScript/TSX files.
- Harden deterministic ranking for active files, mentioned identifiers, path components, prompt-present exclusion, and stable tie breaks.
- Preserve scoring reasons and evidence refs.
- Do not register AgentMap by default or consume output in prompt assembly.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `tests/unit/runtime-agent-map-ranking.test.ts`
- `tests/unit/runtime-agent-map-renderer.test.ts`
- `tests/fixtures/agent-map/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-a-fixtures-ranking-hardening.md
```

## Lane B: Performance Budget, Cache, And Error Isolation

LANE_ID: `line-b-runtime-b-performance-cache-errors`

LANE_TITLE: AgentMap performance budgets, cache invalidation, and structured failures

LANE_SCOPE:

- Add measured performance budget evidence for fixture extraction/ranking/rendering.
- Add cache support only if it is local, in-process, and invalidated by file content/hash/mtime, request inputs, config, and token budget.
- Add structured diagnostics for extraction, render, budget, cache, and malformed-input failures.
- Do not add a service, listener, daemon, external database, or always-on indexer.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `tests/unit/runtime-agent-map-budget.test.ts`
- `tests/unit/runtime-agent-map-cache.test.ts`
- `tests/unit/runtime-agent-map-errors.test.ts`
- `tests/fixtures/agent-map/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-b-performance-cache-errors.md
```

## Lane C: Default-Off Provider Diagnostics

LANE_ID: `line-b-runtime-c-provider-opt-in-diagnostics`

LANE_TITLE: Explicit opt-in provider diagnostics without authority

LANE_SCOPE:

- Harden `createAgentMapContextProvider()` diagnostics and metadata for default-off opt-in/shadow runs.
- Prove `createContextProviderRegistryPilot()` default ordering remains unchanged.
- Prove provider failures are isolated and do not affect legacy context output.
- Do not add provider ordering cutover, TaskLoop/Gateway integration, or default prompt authority.

SUGGESTED_PATHS:

- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- `tests/unit/runtime-agent-map-context-provider.test.ts`
- `tests/unit/context-provider-registry.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-c-provider-opt-in-diagnostics.md
```

## Lane D: Validation And Synthesis

LANE_ID: `line-b-runtime-d-validation-synthesis`

LANE_TITLE: Runtime-use readiness validation and synthesis

LANE_SCOPE:

- Confirm Lane A-C submissions exist and have exactly one valid status line.
- Re-verify all implementation claims with focused tests and boundary scans.
- Run harness context/validate for the runtime-use readiness spec.
- Classify the phase as accepted, needs_revision, or blocked.
- Do not update runtime indexes as cutover-ready unless evidence proves only readiness and default-off shadow behavior.

SUGGESTED_PATHS:

- `harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
- `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/**`
- focused tests touched by A-C

OUTPUT_FILE:

```text
runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/submissions/line-b-runtime-d-validation-synthesis.md
```

## Execution Order

1. Lane A and Lane B may start in parallel.
2. Lane C starts after the current provider baseline is read and may run in parallel with A/B if it does not depend on new cache behavior.
3. Lane D runs after A-C submissions exist.
4. A future runtime cutover proposal must be a separate spec after Lane D synthesis.
