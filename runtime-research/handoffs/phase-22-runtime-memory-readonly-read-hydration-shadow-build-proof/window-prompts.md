# Window Prompts

## Lane A

Inspect `scripts/build-openclaw-runtime.mjs`, `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`, and the focused build test. Confirm `--memory-read-hydration-shadow-only` builds only `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.

## Lane B

Inspect `scripts/build-openclaw-runtime.mjs`. Confirm the build flag selects an esbuild entrypoint only and does not execute helper functions, open SQLite, choose a database, or pass `readShadow`/persist flags.

## Lane C

Inspect `package.json`, `scripts/build-openclaw-runtime.mjs`, and the focused build test. Confirm lifecycle scripts do not invoke the helper or new flag and do not pass `--database`, `--read-shadow`, or `--persist`.

## Lane D

Scan Gateway, Electron, renderer, shared, host-api/api-client, provider registry, and TaskLoop surfaces. Confirm no hydration shadow route/import/cutover was added.

## Lane E

Verify Phase 21 precondition, harness context/validate, focused tests, build proof commands, boundary scans, README sync review, rollback, and synthesis/index update.
