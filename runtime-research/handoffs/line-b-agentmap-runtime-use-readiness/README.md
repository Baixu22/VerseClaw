# Line B AgentMap Runtime-Use Readiness

This handoff starts the next AgentMap phase after the accepted readonly/shadow Line B synthesis. It is not a runtime cutover plan. It prepares AgentMap for a later runtime-use decision by collecting hardening, fixture, performance, cache, error-isolation, and shadow-diagnostic evidence behind explicit default-off boundaries.

## Status

Current baseline from the prior Line B synthesis:

- AgentMap readonly contracts, TS/TSX extraction, explainable ranking, rendering, and budget fitting are implemented in `openclaw_runtime/src/runtime-core/agent-map.ts`.
- AgentMap context provider wrapping exists in `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`.
- The provider is explicit, shadow-only, and `enabledByDefault: false`.
- Default provider ordering remains legacy context engine followed by loop context pack.
- Direct `read`, `grep`, `find`, and `ls` behavior remains authoritative and unchanged.

This phase may improve readiness evidence. It must not make AgentMap authoritative by default.

## Required Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
```

Before implementation, run:

```text
pnpm harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
pnpm harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md
```

Use `pnpm --config.verify-deps-before-run=false ...` if the local pnpm ignored-builds gate blocks script execution.

## Allowed

- AgentMap hardening.
- Real repository fixtures and deterministic snapshots.
- Performance budgets and measured budget evidence.
- Error isolation for extraction, rendering, cache, and provider failures.
- Cache keys and invalidation evidence.
- Shadow diagnostics and evidence metadata.
- Default-off explicit provider or opt-in provider injection.

## Forbidden

- Default-on AgentMap behavior.
- TaskLoop cutover.
- Gateway cutover.
- Provider ordering cutover.
- Default prompt assembly cutover.
- Replacing, wrapping, discouraging, or disabling `read`, `grep`, `find`, or `ls`.
- AST patch apply.
- Symbol edit apply.
- Workspace edit, rename, safe delete, replace body, insert before/after, or any mutation operation.
- New service, listener, daemon, always-on LSP service, second Gateway/runtime service, or external database.

## Exit Criteria

The phase may be accepted only if every lane provides path/function/test/command evidence for:

- default-off and opt-in behavior;
- unchanged default registry ordering;
- unchanged direct discovery tools;
- deterministic fixture output;
- performance budget evidence;
- cache invalidation evidence if caching exists;
- provider and runtime helper failure isolation;
- no mutation/apply/edit surface;
- no service/listener/daemon/external database;
- no TaskLoop/Gateway/provider-ordering/default-prompt cutover.

A future runtime cutover still requires a fresh accepted cutover spec and synthesis.
