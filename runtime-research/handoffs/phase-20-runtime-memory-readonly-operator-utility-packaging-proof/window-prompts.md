# Phase 20 Window Prompts

## Lane A

Audit the Phase 20 packaged command contract. Confirm `runtime:memory:inspect` is discoverable, utility help states readonly, default-off, explicit `--persist`, explicit `--database <path>`, built-runtime output, no runtime behavior effect, and no durable fact/runtime authority.

## Lane B

Audit package/build script boundaries. Confirm `package.json` invokes only `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` for the explicit package command, adds no implicit flags, and `predev`, `dev`, `build`, `package`, and `release` do not invoke the inspector command or script.

## Lane C

Audit product/runtime boundaries. Confirm no Gateway, Electron IPC, renderer, host-api/api-client/shared contract, provider registry, TaskLoop, prompt assembly, package lifecycle startup, or runtime-authority path was added.

## Lane D

Audit JSON and text output redaction. Confirm direct and package command output returns only sanitized episode summaries/statistics and no raw rows, `record_json`, facts, candidates, provider context, raw task/tool/env/secret/trace markers, or runtime authority.

## Lane E

Run and summarize Phase 20 harness validation, structural Phase 19-9 regressions, focused tests, typecheck, build proof, scans, README sync review, rollback path, and comms checks when required.
