# Phase 24 Window Prompts

## Lane A Prompt

Read the Phase 24 spec, `package.json`, and command script. Verify `runtime:memory:hydrate-shadow` remains direct pass-through and does not add implicit persist/read-shadow/database, Gateway, server, listener, daemon, or runtime startup behavior.

## Lane B Prompt

Read `package.json`, `scripts/build-openclaw-runtime.mjs`, and the Phase 22/23 tests. Verify `predev`, `dev`, `build`, `package`, and `release` do not invoke the hydration command, command script, helper exports, hydration-only build flag, or implicit persistence/read-shadow/database flags.

## Lane C Prompt

Read the command test, helper test, build test, command script, and helper source. Verify no-open/no-create/no-table-creation boundaries, sanitized bounded JSON/text output, readonly DB access, and raw-output redaction still hold.

## Lane D Prompt

Search package lifecycle scripts and product runtime paths. Verify Phase 24 adds no Gateway/Electron/renderer/shared/host-api/api-client/provider/TaskLoop/prompt/model/runtime authority cutover.

## Lane E Prompt

Verify rollback, README docs sync review, harness context/validate, structural validates, focused tests, narrow builds, full runtime build, typecheck, boundary scans, and comms decision. The synthesis owner must re-check lanes rather than copying claims.
