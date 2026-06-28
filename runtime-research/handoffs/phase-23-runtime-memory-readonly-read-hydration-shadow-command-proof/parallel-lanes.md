# Phase 23 Parallel Lanes

## Lane A: Command Contract And Help

Verify the command exists, is local developer/research-only, documents readonly/default-off behavior, and names the explicit `--persist`, `--read-shadow`, and `--database <path>` requirements plus diagnostics-only/no-runtime-authority boundaries.

## Lane B: Explicit Flags And No-Open Boundary

Verify missing `--persist`, missing `--read-shadow`, missing `--database`, missing database files, and unrelated existing databases do not open/create/migrate/write Runtime Memory SQLite state or create Runtime Memory tables.

## Lane C: Built Helper Invocation Proof

Verify the command imports `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js` and, for an explicit existing Runtime Memory database, returns only bounded sanitized episode summaries, bounded sanitized fact projections, stats, diagnostics, and authority boundary markers.

## Lane D: No Product Runtime Cutover

Verify package lifecycle scripts and runtime product paths do not invoke the command/helper/build flag and do not change Gateway, Electron, renderer, shared contract, host-api/api-client, provider registry, TaskLoop, prompt, model-message, or runtime authority behavior.

## Lane E: Rollback, Docs, And Validation

Verify rollback is removing only the command/package script/test/handoff additions; README docs sync is not needed unless product/public behavior changed; required harness, tests, builds, typecheck, and scans are recorded.
