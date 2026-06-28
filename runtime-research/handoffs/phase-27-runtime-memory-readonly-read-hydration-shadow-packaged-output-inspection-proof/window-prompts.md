# Phase 27 Window Prompts

## Lane A Prompt

Read the Phase 27 spec, Phase 26 synthesis, `electron-builder.yml`, `scripts/bundle-openclaw-runtime.mjs`, and the new packaged-output inspection test. Verify a packaged output tree may contain hydration helper resources only as inert artifacts.

## Lane B Prompt

Read package `main`, `electron/main/index.ts`, `electron/preload/index.ts`, `src/App.tsx`, `openclaw_runtime/src/entry.ts`, and the temporary packaged-output fixture in the Phase 27 test. Verify packaged output entrypoints do not import or invoke read hydration.

## Lane C Prompt

Read `package.json`, `scripts/build-openclaw-runtime.mjs`, `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`, `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`, and related Phase 21-26 tests. Verify no implicit SQLite default, no writes, no missing DB creation, and sanitized bounded diagnostics-only output.

## Lane D Prompt

Search product runtime paths. Verify Phase 27 adds no Gateway/Electron/renderer/shared/host-api/api-client/provider/TaskLoop/prompt/model/runtime authority cutover.

## Lane E Prompt

Verify rollback, README docs sync review, harness context/validate, structural validates, focused tests, narrow builds, full runtime build, typecheck, boundary scans, and comms decision. The synthesis owner must re-check lanes rather than copying claims.
