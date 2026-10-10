---
lifecycleStatus: archived
id: fix-provider-auth-json-sqlite-migration
title: Migrate compatible provider auth JSON into the runtime SQLite store
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure an agent's existing auth-profiles.json credentials remain usable after the runtime auth store moved to openclaw-agent.sqlite, so a first direct Gateway run does not fail with a missing provider API key while the compatible JSON store already contains that key.
touchedAreas:
  - harness/specs/tasks/fix-provider-auth-json-sqlite-migration.md
  - openclaw_runtime/src/agents/auth-profiles/persisted.ts
  - openclaw_runtime/src/agents/auth-profiles/source-check.ts
  - openclaw_runtime/src/agents/auth-profiles/store.ts
  - openclaw_runtime/src/agents/model-auth.ts
  - openclaw_runtime/src/entry.ts
  - openclaw_runtime/src/infra/state-migrations.ts
  - openclaw_runtime/src/infra/state-migrations.auth-profiles.test.ts
  - openclaw_runtime/src/infra/source-doctor.ts
  - openclaw_runtime/src/infra/source-doctor.test.ts
  - openclaw_runtime/src/agents/model-auth.auth-json-migration.test.ts
expectedUserBehavior:
  - OpenClaw Doctor detects a valid existing auth-profiles.json when SQLite has no auth-profile store row.
  - Running openclaw doctor --fix migrates that compatible JSON store into SQLite.
  - An existing valid SQLite auth-profile store remains authoritative and is never overwritten by stale JSON.
  - A missing-auth error points to openclaw doctor --fix when the compatibility JSON exists but SQLite is not populated.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - active-config-guards
  - backend-communication-boundary
  - renderer-main-boundary
  - api-client-transport-policy
requiredTests:
  - openclaw_runtime/src/infra/state-migrations.auth-profiles.test.ts
  - openclaw_runtime/src/infra/source-doctor.test.ts
  - openclaw_runtime/src/agents/model-auth.auth-json-migration.test.ts
acceptance:
  - Normal runtime auth loading remains SQLite-only and never falls back to auth-profiles.json.
  - Doctor reports a migration only when auth-profiles.json is valid, contains profiles, and SQLite has no valid auth-profile store payload.
  - Doctor fix persists the compatible JSON store through the existing transactional SQLite save path.
  - The pruned source runtime dispatches its doctor command to the provider-auth migration path instead of starting a Gateway.
  - A valid SQLite store takes precedence over conflicting JSON content.
  - Missing-auth diagnostics recommend openclaw doctor --fix only when auth-profiles.json exists and SQLite has no auth-profile store payload.
  - Tests use only fake credentials and do not log or persist real provider secrets in repository artifacts.
  - Renderer/Main transport boundaries remain unchanged.
docs:
  required: false
---

## Background

Verse Claw has historically synchronized provider credentials into each
agent's `auth-profiles.json`. The current OpenClaw runtime persists auth profile
secrets in `openclaw-agent.sqlite`. The JSON path is still declared as a direct
compatibility source, but the runtime correctly treats SQLite as authoritative.
Without an explicit state migration, an agent with a valid JSON credential and
no SQLite auth row fails its first model request with `No API key found for
provider` and receives no migration guidance.

## Scope

- Detect compatible `auth-profiles.json` stores as a Doctor migration only when
  SQLite has no valid store.
- Migrate the normalized store during `openclaw doctor --fix` through the
  existing SQLite transaction and state persistence APIs.
- Preserve SQLite precedence once a valid SQLite store exists.
- Add an actionable Doctor hint to the missing-provider-auth error.
- Add focused regression coverage for detection, migration, diagnostics, and
  SQLite precedence.

## Out of scope

- Persisting API keys into `openclaw.json`.
- Changing provider selection or auth precedence when SQLite is populated.
- Adding a runtime JSON fallback, lazy import, or dual-write path.
- Adding a new renderer or Main-process credential transport.
- Exposing credential values in logs or diagnostics.
