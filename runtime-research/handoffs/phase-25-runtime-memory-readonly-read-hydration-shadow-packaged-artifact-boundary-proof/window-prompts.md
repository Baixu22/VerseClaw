# Phase 25 Window Prompts

## Lane A Prompt

Read the Phase 25 spec, `package.json`, command script, build script, and Phase 24 synthesis. Verify `runtime:memory:hydrate-shadow` remains direct pass-through and packaged artifact presence is not invocation.

## Lane B Prompt

Read `electron-builder.yml`, `scripts/after-pack.cjs`, `scripts/run-electron-builder.mjs`, and package scripts. Verify packaged app startup and release hooks do not invoke hydration, helper exports, build-only flags, or implicit persistence/read-shadow/database flags.

## Lane C Prompt

Read `scripts/bundle-openclaw-runtime.mjs`, `scripts/build-openclaw-runtime.mjs`, and the Phase 22/24 tests. Verify bundle/build paths may copy or emit artifacts only through explicit commands and do not execute read hydration or select SQLite.

## Lane D Prompt

Search product runtime paths. Verify Phase 25 adds no Gateway/Electron/renderer/shared/host-api/api-client/provider/TaskLoop/prompt/model/runtime authority cutover.

## Lane E Prompt

Verify rollback, README docs sync review, harness context/validate, structural validates, focused tests, narrow builds, full runtime build, typecheck, boundary scans, and comms decision. The synthesis owner must re-check lanes rather than copying claims.
