# Phase 10: Evaluation and Reporting

## Goal

Prove Context Runtime Kit quality with fixture and replay reports before active or default-on behavior.

## Allowed Changes

- Evaluation fixtures.
- Metric calculators.
- Report generation scripts.
- Unit tests for metrics and report shape.
- Secret scan integration for generated artifacts.

## Forbidden Changes

- Promoting active behavior solely because token savings improved.
- Hiding worst-case failures behind averages.
- Reporting only happy-path fixtures.
- Default-on rollout without Level 2 gates.

## Required Benchmarks

- Tool schema benchmark.
- Skill routing benchmark.
- Project rule benchmark.
- Codebase benchmark.
- Compact recovery benchmark.

## Required Tests

Use TDD. Add failing tests for:

- each metric formula,
- report includes worst-case failures,
- report includes acceptance gate summaries,
- secret scan catches generated secret-like content,
- Level 1/2/3 status is computed from thresholds,
- evidence metrics take priority over TSR.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<context-runtime-kit-eval-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- Level 1 gates pass before active pilot.
- Level 2 gates pass before default-on behavior.
- Reports include failures, averages, worst cases, and gate decisions.
- Secret scan passes for generated artifacts.

## Stop Conditions

Stop if reports cannot distinguish evidence loss from token savings. Token savings without evidence quality is a failed result.
