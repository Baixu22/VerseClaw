# Phase 05: Context Router Shadow Provider

## Goal

Connect Context Runtime Kit to the existing context-engine surface as shadow diagnostics while legacy prompt text remains authoritative.

## Allowed Changes

- Context-engine shadow provider module.
- Provider registry registration behind default-off or test-only flags.
- Diagnostics for resource map, compact views, budget report, and retrieval plan.
- Tests for prompt parity and diagnostics.

## Forbidden Changes

- Active prompt replacement.
- Tool-call blocking.
- User-visible behavior changes.
- Host-api exposure unless separately specified.
- Renderer/UI changes.

## Required Shadow Guarantees

- `shadowOnly: true`.
- `legacyAuthoritative: true`.
- Prompt text remains byte-equivalent when the feature is off.
- Failure falls back to existing Context Pack and compaction behavior.

## Required Tests

Use TDD. Add failing tests for:

- flag-off prompt parity,
- shadow diagnostics are produced without changing prompt messages,
- omitted resources and reasons appear in budget report,
- provider failure does not change legacy execution.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<shadow-router-tests> --reporter=verbose
corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm run typecheck
```

## Acceptance

- Existing prompt rendering tests remain unchanged.
- Shadow provider is diagnostics-only.
- Disable-only rollback exists.

## Stop Conditions

Stop if any test requires live prompt changes or active gating. Those require later phase specs.
