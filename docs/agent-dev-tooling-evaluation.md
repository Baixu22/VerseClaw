# Agent Dev Tooling Evaluation

This document records the implementation path for agent-focused functional testing and page development tooling.

## Selected Tools

The preferred external projects remain:

- `@axe-core/playwright` for strict accessibility scans.
- `@ladle/react` for isolated Vite/React scenario development.
- `@sinclair/typebox` plus `ajv` for host-api schema validation.
- `@argos-ci/playwright` for hosted visual regression.
- `@vitest/browser` plus `@testing-library/user-event` for browser-level component interaction tests.
- `knip` for unused dependency/export/file checks.

## Current Implementation

The repository-level supply-chain policy currently blocks a direct `pnpm add` because an existing workspace dependency resolves an exotic `libsignal` subdependency while `blockExoticSubdeps` is enabled. Until that policy is resolved, the implemented layer uses existing dependencies and keeps the external tools as optional upgrades.

Implemented now:

- Runtime TypeBox validation for `hostApi.agentDev.seedState`, `configureMockReplay`, and `setFeatureFlags`.
- Playwright basic a11y scan helper in `tests/e2e/fixtures/a11y.ts`.
- Playwright quality spec that emits a11y JSON and visual PNG artifacts.
- Generated scenario workbench via `pnpm agent-dev:workbench`.
- Quantified benefit report via `pnpm agent-dev:evaluate`.

## Measuring Benefit

Run:

```bash
pnpm agent-dev:workbench
pnpm agent-dev:evaluate
```

The evaluation writes:

- `artifacts/agent-dev-workbench/index.html`
- `artifacts/agent-dev-benefit-eval/report.json`
- `artifacts/agent-dev-benefit-eval/report.md`

The report measures deterministic scenario entry points, E2E helper count, schema assertion count, a11y rule families, `data-testid` coverage heuristics, and external tool readiness.

## External Tool Activation

Once supply-chain policy allows dependency resolution, install:

```bash
pnpm add -Dw @axe-core/playwright @ladle/react @argos-ci/playwright @vitest/browser @testing-library/user-event knip ajv --ignore-scripts
```

Then replace the fallback a11y scan with `AxeBuilder`, add a Ladle config that loads `agentDev` scenarios, wire Argos screenshots from `tests/e2e/agent-dev-quality.spec.ts`, and add a `knip` profile tuned for generated files and plugin entry points.
