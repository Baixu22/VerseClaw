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

- Renderer code calls backend functionality through `src/lib/host-api.ts` or `src/lib/host-api-client.ts`.
- Main service actions declared in `shared/host-api/contract.ts` have matching service implementations.
- Mutating `agentDev` actions have runtime payload validation or an explicit exemption in the task spec.
- Agent Dev scenarios come from `shared/agent-dev/scenarios.ts`.
- Contract changes include focused unit or E2E coverage.
- IPC admission enumeration uses TypeScript AST call/symbol shapes and parser-decoded values,
  including static computed access, local Electron aliases and `handleOnce`.
  Comments and strings are not registrations. Every production JS/TS extension
  participates; an unresolved computed IPC method or a duplicate persistent
  `host:invoke` handler fails the existing `contract:check` entrypoint.
- Fixture suites may use repeated `--fixture-batch <path>` arguments to evaluate
  independent mutations against one source snapshot. Each case runs the same
  checks, resets mutation state and reports its own exit code and diagnostics.
  Batch reuse keys IPC parse results by exact source text; standalone parity and
  malformed-fixture isolation remain regression requirements.

## Validation

- `pnpm contract:check`
- `pnpm test tests/unit/contract-check.test.ts`
