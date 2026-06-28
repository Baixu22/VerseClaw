# Phase 18 Window Prompts

## Lane A

Audit the Phase 18 utility help and argument contract. Confirm it states readonly, default-off, explicit persist, explicit database path, built-runtime output, no runtime behavior effect, and no durable fact/runtime authority.

## Lane B

Audit the built-runtime path. Confirm `scripts/build-openclaw-runtime.mjs` emits `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js` and the local utility imports that built module only when explicitly invoked.

## Lane C

Audit disabled and missing-input behavior through the CLI utility. Confirm persist false/omitted, missing database path, missing database file, and missing table do not open, create, migrate, or mutate SQLite state.

## Lane D

Audit JSON and text output redaction. Confirm the utility returns only sanitized episode summaries/statistics and no raw rows, `record_json`, facts, candidates, provider context, raw task/tool/env/secret/trace markers, or runtime authority.

## Lane E

Audit product/runtime boundaries. Confirm no Gateway, Electron, renderer, host-api/api-client/shared contract, provider registry, TaskLoop, prompt assembly, or runtime-authority path was added.

## Lane F

Run and summarize Phase 18 harness validation, focused tests, typecheck, scans, structural Phase 17-9 regressions, and comms checks when required.
