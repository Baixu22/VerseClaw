# Phase 26 Window Prompts

## Lane A Prompt

Read the Phase 26 spec, Phase 25 synthesis, `package.json`, and `electron-builder.yml`. Verify release artifact manifests and package entrypoints can include runtime resources without invoking hydration.

## Lane B Prompt

Read `electron-builder.yml`, `scripts/after-pack.cjs`, `scripts/run-electron-builder.mjs`, and `scripts/bundle-openclaw-runtime.mjs`. Verify `extraResources`, `asar`, `asarUnpack`, afterPack, and bundle/resource paths do not invoke hydration or pass implicit persistence/read-shadow/database flags.

## Lane C Prompt

Read package `main`, `electron/main/index.ts`, `electron/preload/index.ts`, `src/App.tsx`, and `openclaw_runtime/src/entry.ts`. Verify packaged app/runtime startup does not import or invoke read hydration.

## Lane D Prompt

Search product runtime paths. Verify Phase 26 adds no Gateway/Electron/renderer/shared/host-api/api-client/provider/TaskLoop/prompt/model/runtime authority cutover.

## Lane E Prompt

Verify rollback, README docs sync review, harness context/validate, structural validates, focused tests, narrow builds, full runtime build, typecheck, boundary scans, and comms decision. The synthesis owner must re-check lanes rather than copying claims.
