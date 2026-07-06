# Phase 8 AST EditPlan Controlled Explicit Apply Pilot

Status: accepted_phase_8_ast_editplan_controlled_explicit_apply_pilot

## Scope

This phase implements the corrected AST route's fifth slice:

```text
explicit apply gate readiness
  -> controlled explicit apply pilot
  -> later separate full internal replay / boundary tightening
```

AST remains a structured code-edit planning layer. The new helper is explicit-call only and can touch only caller-owned explicit targets supplied in memory.

## Implemented

- Runtime-core helper for turning an existing `EditPlan` IR plus Phase 4 `ApplyGateReadinessReport`, current fingerprints, explicit controlled-apply operator approval, and caller-owned targets into a `ControlledApplyPilotReport`.
- Decision states: `blocked`, `dry_run_ready`, and `applied`.
- Dry-run mode that returns planned rewritten content hashes, per-file summaries, and diagnostics without writing.
- Real apply mode that writes only explicit caller-owned target file paths when every gate passes and `allowWrite: true` is present.
- Fail-closed diagnostics for invalid input, missing/invalid Phase 4 report, non-approved Phase 4 decision, missing approval, approval scope drift, source/preview/match drift, target content drift, excerpt drift, overlap, unsupported operations, operation budget excess, unresolved conflict diagnostics, authority drift, missing target, missing write permission, and write failure.
- Deterministic descending range application per file, bounded diagnostics, per-file write summaries, and explicit non-completion-evidence markers.
- Focused unit coverage for dry-run, test-owned real apply, missing approval, blocked/review-required Phase 4 decisions, drift, target/excerpt drift, overlaps, `match_only`, conflict diagnostics, missing target, write permission, bounded output, non-completion evidence, and write failure masking.

## Boundary

The helper does not scan workspaces, discover files, create files or directories intentionally, delete files, mutate symbols, execute formatter/lint/typecheck/tests/shell commands, invoke runtime loops, integrate Gateway/Main/renderer/host-api/api-client, change provider transport or ordering, insert prompt/model messages, start services/listeners/daemons, add persistence/cache/database behavior, or enable default-on AST behavior.

Only `replace_range` operations are supported. `match_only` and unknown future operation kinds fail closed.

`applied` means only that the caller-owned explicit target write path completed for the pilot. It is not task-completion evidence and does not approve any runtime, UI, Gateway, TaskLoop, or default behavior.

README.md / README.zh-CN.md / README.ja-JP.md do not require updates for this phase because there is no user-visible UI, CLI, public command, or workflow change.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-controlled-explicit-apply-pilot.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-controlled-apply-pilot.test.ts`

## Next Phase

Future work remains:

```text
controlled explicit apply pilot
  -> full internal replay / boundary tightening
```

Any TaskLoop/Gateway/Main/renderer/host-api/api-client route, provider transport change, prompt/model-message insertion, persistence/cache/database behavior, service/listener/daemon behavior, default-on behavior, broader workspace apply, or use as task-completion evidence requires a fresh accepted task spec.
