---
id: agent-dev-ecosystem-regularization
title: Agent Dev Ecosystem Regularization
type: task
intent: Regularize Agent Dev scaffolds, contracts, scenarios, conformance, trace, cost, and sandbox evidence.
scenarios:
  - agent-dev-composable-scenarios
requiredRules:
  - contract-first-boundary
  - i18n-locale-coverage
  - agent-dev-conformance-evidence
  - renderer-main-boundary
  - docs-sync
touchedAreas:
  - shared/agent-dev/**
  - shared/host-api/**
  - src/lib/host-api.ts
  - electron/services/agent-dev-api.ts
  - scripts/**
  - harness/specs/**
  - tests/unit/**
---

# Agent Dev Ecosystem Regularization

## Objective

Regularize Agent Dev feature development so scaffolds, contracts, scenarios, i18n, quality checks, conformance reports, trace/cost reports, and sandbox evidence are discoverable through the existing harness and host-api boundaries.

## Required Rules

- `harness/specs/rules/contract-first-boundary.md`
- `harness/specs/rules/i18n-locale-coverage.md`
- `harness/specs/rules/agent-dev-conformance-evidence.md`
- `harness/specs/rules/renderer-main-boundary.md`
- `harness/specs/rules/docs-sync.md`

## Scope

- Shared Agent Dev scenario registry and composer.
- `contract:check`, `i18n:lint`, and `agent-dev:validate`.
- `agent-dev:make` scaffolds for page, E2E, host-route, skill, channel, plugin, and scenario.
- `channel:conformance` report generation.
- `hostApi.agentDev` scenario recorder, trace timeline, cost report, and skill sandbox report.
- Static Workbench report index.

## Acceptance

- `pnpm contract:check` passes.
- `pnpm i18n:lint` passes.
- `pnpm test tests/unit/agent-dev-scenario-composer.test.ts tests/unit/agent-dev-schemas.test.ts tests/unit/agent-dev-regularization.test.ts tests/unit/contract-check.test.ts tests/unit/i18n-lint.test.ts` passes.
- `pnpm agent-dev:workbench` writes `artifacts/agent-dev-workbench/index.html`.
- `pnpm agent-dev:workbench` also writes machine-readable evidence at `artifacts/agent-dev-workbench/evidence.json` from real registry, contract, host-api, service, trace, and report sources.
- `pnpm agent-dev:fast` provides the no-Electron-rebuild PR loop for contract, i18n, static Workbench, and focused Agent Dev unit tests.
- `pnpm run test:e2e:agent-dev-quality:run` runs the Agent Dev Playwright spec against an existing fresh build so repeated local loops do not rebuild Vite/Electron.
- Settings > Developer exposes the same Agent Dev evidence through host-api-backed renderer UI with four-locale i18n and Electron E2E coverage.
- A scaffolded channel can be checked with `pnpm channel:conformance <name>`.
- `pnpm agent-dev:make scenario <name>` registers the scenario in `shared/agent-dev/scenarios.ts` and generates an E2E spec that asserts the Agent Dev snapshot id.
- `pnpm agent-dev:make e2e <name>` refuses unregistered scenario ids so standalone E2E scaffolds cannot pass through no-op product paths.
- `pnpm agent-dev:make page <name>` wires a real app route and locale namespace stubs; `pnpm agent-dev:make host-route <name>` wires contract, facade, Main registry, and service.
- `hostApi.agentDev.recordScenario()` writes redacted artifacts with a human review and promotion checklist; promotion into source requires shared registry, harness scenario or fixture/E2E, and targeted validation.
- `pnpm agent-dev:promote-scenario <artifact> <name>` promotes reviewed recordings into fixture, shared registry seed, harness scenario, and snapshot-backed E2E while refusing unredacted obvious secrets and existing files.
- `pnpm agent-dev:deep-test` writes quantified gate timing, bottleneck, and optimization evidence under `artifacts/agent-dev-deep-test/`, separates E2E build time from Playwright runtime, and refreshes `artifacts/agent-dev-quality/report.json`.

## Notes

Scenario recorder artifacts must stay redacted and require human review before promotion into `shared/agent-dev/**`, `harness/specs/**`, fixtures, or E2E. Gate layering is fast PR (`contract:check`, `i18n:lint`, targeted unit, Workbench), full local (`agent-dev:validate`, targeted E2E, relevant conformance), and nightly/release (comms replay/compare plus broader E2E/report evidence).
