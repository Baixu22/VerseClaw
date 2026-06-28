# line-b-e-validation-synthesis-readiness: validation synthesis and runtime-use handoff scaffold

## Scope Confirmation

- Lane: Line B Lane E validation, boundary audit, and next-phase readiness scaffold.
- Runtime code touched: none.
- Tests touched: none.
- Documentation/spec files created:
  - `harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
  - `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/README.md`
  - `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/parallel-lanes.md`
  - `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/window-prompts.md`
  - this submission file

## Required Reading

Read for this lane:

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/README.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/parallel-lanes.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/window-prompts.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/synthesis.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-a-agentmap-contracts-ranking.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-b-symbol-readonly-contracts.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-c-agentmap-render-budget-fixtures.md`
- `runtime-research/handoffs/line-b-agentmap-symbol-readonly-planning/submissions/line-b-d-context-provider-shadow-boundary.md`
- `openclaw_runtime/src/runtime-core/agent-map.ts`
- `openclaw_runtime/src/context-engine/agent-map-context-provider.ts`
- `tests/unit/runtime-agent-map-*.test.ts`

Tooling note: `rtk` is not available on PATH in this workspace. Direct PowerShell, `rg`, and `pnpm` commands were used after attempted `rtk` commands failed.

## Submission Audit

| Submission | Status-line count | Reclassified | Evidence |
|---|---:|---|---|
| `line-b-a-agentmap-contracts-ranking.md` | 1 | accepted | AgentMap request/result/tag/evidence contracts landed with readonly and budget guards; focused contract tests passed in the lane evidence. |
| `line-b-b-symbol-readonly-contracts.md` | 1 | accepted | Symbol overview/find/references/diagnostics/checkpoint contracts are readonly and mutation-free; focused symbol tests passed in the lane evidence. |
| `line-b-c-agentmap-render-budget-fixtures.md` | 1 | accepted | AgentMap TS/TSX extraction, ranking, rendering, deterministic fixture output, and budget shrinkage evidence landed with focused tests. |
| `line-b-d-context-provider-shadow-boundary.md` | 1 | accepted | AgentMap/Symbol providers are explicit, shadow-only, default-off factories; default registry ordering remains unchanged. |

The existing Line B synthesis also reclassified A-D as accepted and recorded focused test, typecheck, boundary scan, comms replay, and comms compare evidence for the readonly/shadow implementation. This lane closes the previously waived Lane E/Phase 0 submission gap and creates the next runtime-use readiness scaffold.

## Boundary Decision

The next phase is allowed to prepare AgentMap for runtime use only through bounded hardening and opt-in diagnostics:

- AgentMap hardening, real repository fixtures, performance budgets, error isolation, caching, and shadow diagnostics are allowed.
- A default-off explicit provider or opt-in provider path is allowed.
- Default-on behavior is forbidden.
- TaskLoop, Gateway, provider ordering cutover, and provider transport cutover are forbidden.
- Default prompt assembly cutover is forbidden.
- Replacing `read`, `grep`, `find`, or `ls` is forbidden.
- AST patch apply, symbol edit apply, workspace edit, rename, safe delete, and any mutation surface are forbidden.
- New service, listener, daemon, always-on LSP service, or external database is forbidden.

## Next-Phase Scaffold

Created `harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md` as the canonical task spec for the next phase. It keeps runtime-use readiness behind default-off opt-in/shadow boundaries and requires evidence for fixtures, performance budgets, caching behavior, failure isolation, provider default-off behavior, and boundary scans.

Created `runtime-research/handoffs/line-b-agentmap-runtime-use-readiness/` with:

- `README.md`: scope, current baseline, hard boundaries, validation expectations, and exit criteria.
- `parallel-lanes.md`: lane split for hardening/fixtures, performance/cache/error isolation, opt-in provider diagnostics, and validation synthesis.
- `window-prompts.md`: ready-to-run prompts for each lane with required reading, forbidden changes, and submission status requirements.

## Validation

Required validation for the newly created spec:

- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`

Result: passed. The command reported `Spec is valid: harness\specs\tasks\phase-line-b-agentmap-runtime-use-readiness.md`. The only additional output was pnpm's existing warning that package-level `pnpm` fields are ignored by newer pnpm versions.

## Docs Sync

No README translation updates are required for this lane because it adds docs/spec/handoff scaffolding only. It does not alter user-visible UI, CLI, Gateway, host-api, renderer, runtime prompt behavior, provider ordering, or package behavior.

Status: accepted
