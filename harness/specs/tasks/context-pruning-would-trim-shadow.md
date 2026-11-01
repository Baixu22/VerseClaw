---
lifecycleStatus: active
id: context-pruning-would-trim-shadow
title: Shadow would-trim evidence for cache-boundary pruning
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 7b809b300
intent: Make the cache-TTL pruner's effect visible before it is trusted - a shadow report of what would be trimmed (items, chars, estimated tokens, owner refs) that never changes the messages the pruner returns and is off by default.
touchedAreas:
  - harness/specs/tasks/context-pruning-would-trim-shadow.md
  - openclaw_runtime/src/agents/agent-hooks/context-pruning/would-trim.ts
  - openclaw_runtime/src/agents/agent-hooks/context-pruning/extension.ts
  - openclaw_runtime/src/agents/agent-hooks/context-pruning/runtime.ts
  - openclaw_runtime/src/agents/agent-hooks/context-pruning/settings.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - tests/unit/context-pruning-would-trim.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - Nothing changes by default: no report is recorded, and the pruner returns exactly what it returned before.
  - With the shadow flag on, an operator can read what the pruner would trim, with a GO/NO-GO gate, without the report being sent.
  - A denied tool, the last-assistant window and the no-trim case all read as "nothing would be trimmed".
requiredProfiles:
  - fast
  - comms
requiredRules:
  - runtime-lifecycle-governance-boundary
  - context-family-boundary
  - context-runtime-kit-boundary
  - docs-sync
  - disk-temp-policy
requiredTests:
  - pnpm exec vitest run tests/unit/context-pruning-would-trim.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - The shadow report runs the real pruner over a copy, and the input message array is unchanged afterwards.
  - The report carries items (ownerRef, index, toolName, chars before/after/saved, action), totals and estimatedTokensSaved, and never carries tool payload text.
  - The whitelist and the keep-last-assistants window are respected: a denied tool yields no items, and only the older tool result is reported.
  - The GO/NO-GO gate is NO-GO for no trim or under 1% saved, GO only for material saving.
  - With the shadow flag off nothing is recorded; with it on the extension records the report and returns the pruner's own output unchanged.
  - No compaction threshold or pruner decision changes.
docs:
  required: true
  readmeTranslations: not-required
  note: Diagnostics-only shadow report behind an internal flag; no user-facing flow or default change.
  files:
    - docs/modules/context-and-memory.md
---

# Shadow would-trim evidence

The pruner is a mutation: after the cache TTL ages out it rewrites tool results.
There was no way to see what it would do without doing it, so "is this safe and
worth it?" could only be answered by turning it on.

This leaf adds the measurement, not the mutation.

## What the report says

For each changed message: `ownerRef` (`msg:<index>:<tool>:<digest>`), index,
tool name, chars before/after/saved, and whether it was a soft trim or a hard
clear. Plus totals, estimated tokens saved and a digest of the projected array.
No message body is copied into the report.

## Gate

| condition | decision |
|---|---|
| no trim, or zero items | NO-GO `no-trim` |
| no character baseline | NO-GO `no-char-baseline` |
| saved < 1% of chars | NO-GO `saving-below-1pct` |
| otherwise | GO with the measured saving |

The gate is evidence for a later decision. It does not flip the pruner on.

## Wiring

- `runtime.wouldTrimShadow` is populated from `contextPruning.wouldTrimShadow`
  (default false) in `extensions.ts`.
- The extension builds the report before the cache-age early return, so a fresh
  turn still yields "would trim" evidence; the pruner itself keeps its exact
  cache-TTL behaviour and its return value is untouched.
- The report lives in runtime state (`lastWouldTrim`); it is not sent and not
  persisted.

## Non-goals

- No server-side `cache_edits` protocol.
- No change to any compaction tier threshold.
- No default-on: the flag is false and the pruner is unchanged when it is off.