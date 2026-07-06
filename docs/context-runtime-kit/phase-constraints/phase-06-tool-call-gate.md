# Phase 06: Tool Call Gate

## Goal

Verify tool schema hard constraints before tool calls, starting in report-only mode before any active blocking.

## Allowed Changes

- Tool gate policy and report-only verifier.
- Tests and fixtures for tool schemas.
- Diagnostics for missing selectors.
- Active blocking only if the phase task explicitly includes report-only evidence and rollback.

## Forbidden Changes

- Silent tool-call blocking without report-only evidence.
- Tool permission expansion.
- MCP tool list changes.
- Spawn arg, fallback, approval, retry, or transport changes.
- UI changes.

## Required Selector Families

Before a gated tool call is valid, evidence must exist for:

- required fields,
- enum values,
- field types,
- default values,
- nullable semantics,
- permission notes,
- side-effect notes.

## Required Tests

Use TDD. Add failing tests for:

- report-only missing required selector,
- report-only missing enum selector,
- report-only missing type selector,
- report-only missing default selector,
- report-only missing nullable selector,
- report-only missing permission selector,
- report-only missing side-effect selector,
- all selectors present passes,
- missing selectors are returned in deterministic order.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<tool-call-gate-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- Report-only mode produces would-block diagnostics.
- Active blocking, if included, is behind an explicit flag and has disable-only rollback.
- No MCP execution semantics change outside the active flag.

## Stop Conditions

Stop if the work requires changing tool permission policy or MCP server behavior.
