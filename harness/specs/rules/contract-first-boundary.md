---
id: contract-first-boundary
title: Contract First Boundary
type: rule
appliesTo:
  - agent-dev-ecosystem-regularization
  - gateway-backend-communication
pathPatterns:
  - shared/host-api/**
  - src/lib/host-api.ts
  - electron/services/**
---

# Contract First Boundary

## Rule

Renderer/Main/Gateway/Runtime-facing features must declare or update their host-api contract before exposing UI or renderer behavior.

## Requirements

- Renderer code calls backend functionality through `src/lib/host-api.ts` or `src/lib/api-client.ts`.
- Main service actions declared in `shared/host-api/contract.ts` have matching service implementations.
- Mutating `agentDev` actions have runtime payload validation or an explicit exemption in the task spec.
- Agent Dev scenarios come from `shared/agent-dev/scenarios.ts`.
- Contract changes include focused unit or E2E coverage.

## Validation

- `pnpm contract:check`
- `pnpm test tests/unit/contract-check.test.ts`
