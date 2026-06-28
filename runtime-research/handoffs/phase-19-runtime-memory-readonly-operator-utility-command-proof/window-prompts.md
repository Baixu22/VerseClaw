# Phase 19 Window Prompts

## Lane A

Audit the Phase 19 command and help contract. Confirm `runtime:memory:inspect` is discoverable, utility help states readonly, default-off, explicit `--persist`, explicit `--database <path>`, built-runtime output, no runtime behavior effect, and no durable fact/runtime authority.

## Lane B

Audit the package script and built-runtime path. Confirm `package.json` invokes only `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`, adds no implicit flags, and the utility imports `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js` only when explicitly invoked.

## Lane C

Audit disabled and missing-input behavior through direct and package command paths. Confirm persist false/omitted, missing database path, missing database file, and missing table do not open, create, migrate, or mutate SQLite state.

## Lane D

Audit JSON and text output redaction. Confirm command output returns only sanitized episode summaries/statistics and no raw rows, `record_json`, facts, candidates, provider context, raw task/tool/env/secret/trace markers, or runtime authority.

## Lane E

Audit product/runtime boundaries. Confirm no Gateway, Electron, renderer, host-api/api-client/shared contract, provider registry, TaskLoop, prompt assembly, or runtime-authority path was added.

## Lane F

Run and summarize Phase 19 harness validation, focused tests, typecheck, build proof, scans, structural Phase 18-9 regressions, README sync review, rollback path, and comms checks when required.
