# Validation Plan

Status: validated_with_no_diff_fallback_for_unrelated_dirty_tree.

## Required Commands

```bash
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts
pnpm run typecheck
```

If full harness validation is blocked only by unrelated dirty worktree state, use:

```bash
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md --no-diff
```

## Focused Coverage

- Sanitizer rejects raw prompt/provider/tool/stdout/stderr content, env-like keys, API keys, authorization values, secrets, and unredacted Windows/POSIX paths.
- Transcript fixtures cover malformed JSONL, unknown tools, `code_mode_exec`, missing usage metadata, candidate metadata, and partial signals.
- Observation-only shadow summaries retain no active decision field and keep `activeRuntimeConsumer: false`.
- Runtime coupling readiness allows only the mutation-capable tool invocation preflight owner.
- Denied-root scans continue to cover TaskLoop, Gateway, provider, prompt/retry/approval/rollback/completion-adjacent roots, Electron, renderer, and scripts.
- Existing holdout and preflight tests continue to prove positive control blocks while deleted path alone, partial signals, false-block-corpus failing, and flag omitted/false paths allow.

## Result Log

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md`: passed.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md`: failed on unrelated dirty/untracked files outside this spec's touched areas.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-tightening-internal-optimization-runtime-coupling-readiness.md --no-diff`: passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-feature-config-schema.test.ts`: passed, 4 files and 31 tests.
- `pnpm run typecheck`: passed.
