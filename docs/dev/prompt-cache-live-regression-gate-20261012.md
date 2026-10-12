# Live prompt-cache regression gate (#165)

## What was broken

The repository contained `LIVE_CACHE_REGRESSION_BASELINE` and
`live-cache-regression-runner.ts`, but the runner imported a missing
`live-cache-test-support.ts` and was explicitly excluded from
`openclaw_runtime/tsconfig.core.json`. No workflow called
`openclaw_runtime` `test:live:cache`, so the floors were not executable.

The missing support module was restored from the upstream OpenClaw source whose
runner blob exactly matches this repository (`db2d4632c86850147ef13967a4fe7becd410021d`).
The runner is now included in the core typecheck again.

## Execution contract

- `.github/workflows/live-cache-regression.yml` runs manually through
  `workflow_dispatch` and weekly on the first Monday slot (`0 7 * * 1`).
- Credentials come only from repository secrets:
  `OPENCLAW_LIVE_ANTHROPIC_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
  Optional model selections come from repository variables.
- The workflow calls `pnpm --dir openclaw_runtime run test:live:cache` and
  uploads `artifacts/prompt-cache-live-cache` with `if: always()`.
- Missing environment credentials fail closed before profile discovery: the report is marked
  `measured: false`, `result.passed: false`, and the command exits `1`. Set
  `OPENCLAW_LIVE_ALLOW_PROFILE_AUTH=1` only for a deliberate local profile-auth run.
- The workflow has no `pull_request` trigger and is not a PR hard gate.

## Report

`check-live-cache.ts` writes
`artifacts/prompt-cache-live-cache/report.json`. The report carries:

- `threshold`: the existing `LIVE_CACHE_REGRESSION_BASELINE`
- `perTurn` and `promptCache`: the runner's per-lane summary
- `result.measured`, `result.passed`, regressions and warnings
- `artifactSafety.apiKeyCaptured: false`

It never writes provider keys or raw credential material. The runner remains
responsible for real provider calls; this gate only makes its output executable
and auditable.

## Verification

- Unit tests cover report shape, unmeasured fail-closed status, Anthropic hard
  floor injection, OpenAI warn-only injection and workflow wiring.
- `pnpm --dir openclaw_runtime exec node scripts/run-tsgo.mjs -p tsconfig.core.json` verifies the restored runner and
  support module compile without relying on the local incremental build-info cache.
- The local no-prerequisite invocation must exit non-zero while still writing a
  readable JSON report.

## Boundaries

- No baseline `observedHitRate` refresh or manual metric edit.
- No external telemetry upload.
- No hit-rate, throughput or cost improvement claim.
- No PR blocking dependency on live providers.
