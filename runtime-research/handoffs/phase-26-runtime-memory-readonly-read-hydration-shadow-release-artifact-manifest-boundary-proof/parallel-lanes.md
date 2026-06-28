# Phase 26 Parallel Lanes

## Lane A: Release Artifact Manifest Presence

Verify `electron-builder.yml`, package manifest entrypoints, release scripts, and packaged resource declarations may include runtime resources only as inert artifacts and do not invoke hydration.

## Lane B: Asar And ExtraResources No Invocation

Verify `extraResources`, `asar`, `asarUnpack`, `afterPack`, and `run-electron-builder` do not invoke the hydration command/helper, helper exports, hydration-only build flag, or implicit persistence/read-shadow/database flags.

## Lane C: Packaged Resource Entrypoint Scan

Verify packaged app and runtime entrypoints (`dist-electron/main/index.js`, Electron main/preload, renderer app, and `openclaw_runtime/src/entry.ts`) do not import or invoke read hydration.

## Lane D: Product Runtime Boundary Rescan

Verify no Gateway, Electron IPC, renderer, shared contract, host-api/api-client, provider registry, TaskLoop, prompt/model-message, provider ordering, durable fact authority, or runtime authority path imports or invokes read hydration.

## Lane E: Rollback, Docs, And Validation

Verify rollback is removing only Phase 26 proof artifacts; README sync is not needed unless product/public behavior changed; required harness, tests, builds, typecheck, scans, and comms decision are recorded.
