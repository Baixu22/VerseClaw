---
lifecycleStatus: archived
id: fix-memory-search-missing-index-metadata
title: Rebuild memory search indexes when metadata is missing
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep memory_search usable when an existing local index has content but its identity metadata is missing, while preserving the fail-closed behavior for mismatched provider/model settings.
touchedAreas:
  - harness/specs/tasks/fix-memory-search-missing-index-metadata.md
  - openclaw_runtime/extensions/memory-core/src/memory/manager.ts
  - openclaw_runtime/extensions/memory-core/src/memory/manager-reindex-state.ts
  - openclaw_runtime/extensions/memory-core/src/memory/manager-reindex-state.test.ts
expectedUserBehavior:
  - A memory_search request can recover an existing index whose metadata row is missing by rebuilding it with the current embedding provider.
  - An index built for a different provider/model/settings remains paused and is not silently overwritten.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - openclaw_runtime/extensions/memory-core/src/memory/manager-reindex-state.test.ts
acceptance:
  - Search-triggered recovery is limited to missing identity metadata and uses the existing safe sync/reindex path.
  - Provider/model/settings mismatches continue to return unavailable results and require explicit operator reindex.
  - Recovery does not log or expose credentials.
  - Renderer/Main transport boundaries remain unchanged.
docs:
  required: false
---

## Background

The memory core can have indexed chunks left on disk while its metadata row is
missing. The manager currently returns an unavailable result without attempting
the safe recovery already implemented by `runSync()`, so `memory_search` stays
disabled until an operator manually runs the index command.

## Scope

- Re-check missing identity metadata at search time and invoke the existing
  safe full-sync path when the current provider can rebuild it.
- Keep mismatched identities fail-closed.
- Add focused state-decision regression coverage.

## Out of scope

- Changing provider selection or embedding credentials.
- Rebuilding indexes whose provider/model/settings identity is mismatched.
- Adding a renderer or Main-process transport path.
