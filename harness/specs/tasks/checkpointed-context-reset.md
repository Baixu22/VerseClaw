---
lifecycleStatus: active
id: checkpointed-context-reset
title: Checkpoint-first new-context primitive, default off
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 33ca31d6f
intent: Offer a safer alternative to a summary-less reset - archive the current transcript, verify the archive by re-reading it, and only then let the reply owner reset - while staying invisible and byte-identical when the flag is off.
touchedAreas:
  - harness/specs/tasks/checkpointed-context-reset.md
  - openclaw_runtime/src/agents/checkpointed-context-reset.ts
  - openclaw_runtime/src/agents/tools/sessions-new-context-tool.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/schema.help.ts
  - shared/dcs/component-disposition-catalog.ts
  - tests/unit/checkpointed-context-reset.test.ts
  - docs/modules/context-and-memory.md
expectedUserBehavior:
  - With the flag off nothing exists for the model or the user: no tool, no prompt text, no archive.
  - With the flag on the model can ask for a new context; the runtime first archives the transcript and proves it can read it back.
  - A failed archive or a failed verification refuses the reset with a named reason; the current context is untouched.
  - The active turn is never interrupted and no model turn is replayed.
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
  - pnpm exec vitest run tests/unit/checkpointed-context-reset.test.ts --maxWorkers=1
  - pnpm run typecheck
acceptance:
  - With the flag off, sessions_new_context is absent from the tool inventory and no prompt or tool-set bytes change.
  - With the flag on, the tool writes a ContextArchive/v1 under the state dir, verifies it by re-reading and matching the digest, and only then schedules the reset.
  - A missing archive, tampered payload, failed write, failed reset or declined reset returns a refusal with a reason, and the reset callback is not invoked before verification.
  - The tool returns only the archive id, size, digest and timestamp - never the transcript payload.
  - The reset is scheduled for after the turn and never interrupts a running run or replays a model turn.
  - The flag is default-off in config, zod, exhaustive-leaf, disposition and env resolution; a malformed flag resolves to off.
docs:
  required: true
  readmeTranslations: not-required
  note: Default-off internal tool; no user-facing flow or default changes.
  files:
    - docs/modules/context-and-memory.md
---

# Checkpoint-first new context

A plain reset throws the window away. This primitive inverts the order: **archive,
prove the archive, then reset**.

## Order is the contract

1. Read the current transcript (lazy; nothing is read while the tool is unused).
2. Write `ContextArchive/v1` with a sha256 and the payload, mode 0600.
3. Re-read the file, compare id, length and digest, and recompute the digest from
   the stored payload.
4. Only then schedule the reset for after the turn.

Any failure at 1-3 returns `refused` with a reason. The reset callback is not
reached, so the worst case is "nothing happened".

## Flag

`runtime.contextBlock.checkpointedContextReset.enabled`, or
`VERSE_CHECKPOINTED_CONTEXT_RESET=1`. Default off. With the flag off the tool is
not registered at all - not merely disabled at execution - so the model's tool
list and system prompt are byte-identical to not having this feature.

## Non-goals

- No summary-less discard: the archive is the safety net.
- No cross-session reset: the tool is bound to the current session id.
- No change to the automatic compaction threshold.