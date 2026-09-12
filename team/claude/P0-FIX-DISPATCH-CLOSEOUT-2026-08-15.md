# P0 Fix Dispatch Closeout (Research Report D1–D4)

**Date**: 2026-08-15
**Source**: `team/claude/CLAWX-CODING-OPTIMIZATION-RESEARCH-REPORT.md` §五 P0 (D1–D4)
**Repo**: ClawX repository root.
**Note**: The originally named `team/claude/R-SERIES-REVISE-DISPATCH-2026-08-15.md` did not
exist; per operator choice, this closeout tracks the research report's P0 fix list.

## Verdict per item

| ID | Report ask | State after this closeout |
|----|-----------|---------------------------|
| D1 | Register context_read/search/write as agent tools | **Already fixed** (verified, no code change) |
| D2 | Wire a task_phase_change producer | **Already fixed** (verified, no code change) |
| D3 | Enable at least working_memory + tool_registry flags | **Kept default-off by enforced policy**; Settings opt-in path verified |
| D4 | Content-level code understanding in CVK codebase-index | **Fixed by deletion** — orphaned module removed; FactStore tree-sitter pipeline is the canonical path |

## D1 — verified fixed

- Registration live in `createOpenClawCodingTools` (`openclaw_runtime/src/agents/agent-tools.ts:1016`)
  when BlockStore + session id present.
- Production deps wired from attempt/compact via `resolveEmbeddedDcsExtensionDeps`
  (`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:1261,1354`,
  `compact.ts:861,888`) with TASK-P0-04 degradation notices.
- Evidence: `context-agent-tools.test.ts` 19 tests green (incl. "includes three names when
  DCS deps present").

## D2 — verified fixed

- `emitTaskLoopTaskPhaseChange` (`openclaw_runtime/src/agents/task-loop-controller.ts:2720,2751`)
  is the primary producer: exactly-once per true `RuntimeTaskStatus` change via
  `taskLoopRuntimeStatusByRun` dedupe; failures logged, never thrown.
- Evidence: `task-loop-controller.dcs-phase-producer.test.ts` 2 tests green.

## D3 — kept default-off (operator decision), Settings path verified

- Defaults stay `false` for `runtime.contextBlock.working-memory.enabled` /
  `tool-registry.enabled` per DCS `[MUST]` specs v1.1–v1.6 and the machine guard
  `assertCatalogDefaultHonesty()` (green).
- Opt-in path is live: Settings → Developer → DCS Production Flags — writable specs for
  `working-memory` / `tool-registry` (`shared/dcs/prod-flags-control.ts:164-176`) and the
  "DCS Coding Preview" combo (`:423-439`) with child-ack semantics.
- Evidence: `dcs-prod-flags-control.test.ts` 9 tests green; catalog honesty 4 tests green;
  `runtime-context-block-{working-memory,tool-registry}.test.ts` 4 tests green.

## D4 — fixed by deletion

The report's D4 target (`cvk/codebase-index.ts`) had zero production callers and no call
relations. Content-level code understanding is already served by the canonical FactStore
tree-sitter pipeline: `openclaw_runtime/src/context-engine/producers/analyzers/*`
(TS/JS/Python/Go/Rust/Java) produce symbol, `calls`, `imports`, `exports`, `definitions`,
`framework_routes`, `tests` edges; baseline-on via `runtime.coding.parseOnTouch.enabled`
default true; consumed by `context_impact` / `context_reuse` / `context_understand` /
`context_verify` and rebuild providers.

Removed:

- `openclaw_runtime/src/context-engine/cvk/codebase-index.ts`
- `tests/unit/context-runtime-kit-codebase-index.test.ts`
- `docs/context-runtime-kit/phase-constraints/phase-09-codebase-index.md`

Updated:

- `docs/context-runtime-kit/README.md` (phase list + supersession note)
- `docs/context-runtime-kit/goal-progress.md` (appended removal entry; history preserved)
- `reports/agent-context-guidance-queue-current-state.md` (inventory line removed + note)

Left untouched (historical records): `harness/specs/tasks/rc01r-green-baseline.md`
(point-in-time acceptance spec), `docs/context-family/goal-progress.md`,
`artifacts/**` (generated).

## Gates

| Gate | Result |
|------|--------|
| D1/D2 focused suites (21 tests) | 0 failures |
| CRK regression minus deleted test + prod-flags-control (95 tests) | 0 failures |
| runtime dcs-prod-flags-catalog (4 tests) | 0 failures |
| analyzer tree-sitter suites (12 tests) | 0 failures |
| CRK codebase-index suite | removed with the module (no orphaned tests) |
| `git diff --check` on all touched files | clean |
| `pnpm --dir openclaw_runtime tsgo:core` | fails only on pre-existing uncommitted `shared/verseshell/*` drift (extraction.ts / facade.ts TS2835/TS7006) — unrelated to this change; zero errors reference `cvk/` |

## Residual (explicitly out of scope)

- P0 report items P1–P6 (structured retrieval, write transactions, AST locks, 5-layer
  compaction, deferred tool loading, knowledge layer) are not addressed here.
- C1 view tools remain default-off (`OPENCLAW_DCS_CONTEXT_VIEW_TOOLS`) until C1 graduation.
