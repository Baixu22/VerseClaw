# Phase 25 Parallel Lanes

## Lane A: Packaged Artifact Command Presence

Verify `runtime:memory:hydrate-shadow` remains a direct package-script pass-through and that packaged or bundled artifacts may contain the built helper only as inert developer/research diagnostic material.

## Lane B: Electron Builder Release No-Invocation

Verify `electron-builder.yml`, `scripts/after-pack.cjs`, and `scripts/run-electron-builder.mjs` do not invoke the hydration command, command script, helper exports, hydration-only build flag, or implicit persistence/read-shadow/database flags.

## Lane C: Bundle Script No Hydration Execution

Verify `scripts/bundle-openclaw-runtime.mjs` may copy runtime source/build artifacts into `build/openclaw-runtime/`, but does not execute the hydration command/helper, pass hydration flags, open SQLite, or select a database path.

## Lane D: Product Runtime Boundary Scan

Verify no Gateway, Electron, renderer, shared contract, host-api/api-client, provider registry, TaskLoop, prompt/model-message, provider ordering, durable fact authority, or runtime authority path imports or invokes read hydration.

## Lane E: Rollback, Docs, And Validation

Verify rollback is removing only Phase 25 proof artifacts; README sync is not needed unless product/public behavior changed; required harness, tests, builds, typecheck, and scans are recorded.
