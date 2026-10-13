---
lifecycleStatus: active
id: handoff-subagent-depth-limits
title: Handoff and subagent spawn depth limits (MAX_HANDOFF_DEPTH)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Session handoff and subagent spawning had no depth field and no cycle detection
  (issue #179 / TF-0284), so a chain could in principle grow without bound and each
  hop would shed a little more context. This spec records the depth cap that exists,
  how it fails, and the one remaining gap that needs a product concept rather than
  plumbing.
touchedAreas:
  - harness/specs/tasks/handoff-subagent-depth-limits.md
  - openclaw_runtime/src/agents/subagent-depth.ts
  - openclaw_runtime/src/agents/subagent-depth.test.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/config/sessions/types.ts
  - openclaw_runtime/src/gateway/server-session-events.ts
  - openclaw_runtime/src/gateway/session-utils.ts
  - openclaw_runtime/src/gateway/session-utils.types.ts
  - openclaw_runtime/src/plugins/session-entry-slot-keys.ts
expectedUserBehavior:
  - Spawning past the configured depth is rejected with a message that names the current and maximum depth; no deeper session is created.
  - A session row exposes its spawn depth and chain root, so an operator can read a chain's depth distribution without walking the store.
  - A corrupt parent chain cannot make the depth/root lookup recurse forever.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - openclaw_runtime/src/agents/subagent-depth.test.ts
acceptance:
  - A spawn carries a depth; exceeding the cap is an explicit, actionable rejection (never a silent deeper spawn).
  - The depth/root walk is cycle-safe; a corrupt `spawnedBy` loop terminates and never reports a session as its own root.
  - The spawn-chain origin is readable O(1) from the session row (not by re-walking the store).
  - The cap default is documented here and `pnpm harness validate` passes.
  - No frozen default changes.
docs:
  required: false
---

# Handoff and subagent spawn depth limits

## What exists (agent-driven audit, 2026-10-13)

| Capability | State |
|---|---|
| Subagent spawn depth field (`spawnDepth`) | exists |
| Depth cap + explicit rejection | exists (`subagents.maxSpawnDepth`, default **1**) |
| Cycle-safe ancestry walk | exists (`getSubagentDepthFromSessionStore`) |
| Spawn-chain root, O(1) readable | exists (`spawnRootSessionKey`, inherited at spawn) |
| Session events carry depth + root | exists |
| Product-layer *handoff* depth / lineage | **missing** |

## Decisions

1. **The cap is `agents.defaults.subagents.maxSpawnDepth`, default `1`, schema range 1..5.**
   `1` means "no nesting": a depth-1 sub-agent cannot spawn another. `subagent-spawn.ts`
   rejects with `sessions_spawn is not allowed at this depth (current depth: N, max: M)`
   rather than silently deriving a deeper session. This is an existing config; the issue's
   proposed `MAX_HANDOFF_DEPTH` name is not introduced, so **no frozen default changes**.
2. **The chain root is a session key, not an opaque id.** The issue asked for
   `parentHandoffId` / `rootHandoffId`; no "handoff id" concept exists in the repo, so the
   derivable form is implemented — `spawnRootSessionKey` (the direct parent is the existing
   `spawnedBy`). An opaque id would require defining what "one handoff" is (a product
   decision) and is deliberately not invented here.
3. **Cycle handling is termination, not rejection.** The walk tracks `visited` and stops on a
   loop, so a corrupt `spawnedBy` cycle cannot recurse forever, and a session is never
   reported as its own root. There is no "reject because the target is an ancestor" gate,
   because spawn never targets an existing ancestor — it always creates a fresh session.

## Remaining gap (out of scope here)

The **product-layer handoff** (`src/lib/workspace-session.ts`
`createWorkspaceScopedHandoffSession`) creates a new session with a prefilled draft and
records no lineage at all, so it has no depth to cap and no ancestor chain to check. Adding
one requires persisting a handoff link (a workspace/session schema decision) plus a product
definition of "one handoff". The runtime half — the path that can actually recurse — is
capped and cycle-safe today; the manual UI path is user-driven, not automatic.