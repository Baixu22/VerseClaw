---
id: agent-dev-composable-scenarios
title: Agent Dev Composable Scenarios
type: scenario
requiredRules:
  - contract-first-boundary
  - agent-dev-conformance-evidence
pathPatterns:
  - shared/agent-dev/**
  - src/lib/agent-dev.ts
  - scripts/agent-dev-workbench.mjs
---

# Agent Dev Composable Scenarios

Runtime trace collection includes normal chat and tool channels. A request timeline joins
events sharing the same observed run ID. Repeated messages and run-end usage must not
double count tokens; reported model cost remains available when a final run supplies tokens only.

## Purpose

Agent-authored features should be reproducible through composable `devScenario` seeds instead of scattered hardcoded fixtures.

## Flow

1. Scenario ids are declared in `shared/agent-dev/scenarios.ts`.
2. Renderer dev mode parses `?devScenario=a+b` through `shared/agent-dev/scenario-composer.ts`.
3. Later scenario seeds override earlier state slices.
4. Query parameters other than `devScenario` become override metadata.
5. Workbench reads the same shared registry.

## Validation

- `pnpm test tests/unit/agent-dev-scenario-composer.test.ts`
- `pnpm agent-dev:workbench`
