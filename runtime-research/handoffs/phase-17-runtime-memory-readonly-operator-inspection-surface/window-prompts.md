# Phase 17 Window Prompts

## Lane A

Audit the Phase 17 operator/developer inspection surface. Confirm it is explicit-call only, default-off, and only delegates to `inspectRuntimeMemorySanitizedEpisodes(options)`.

## Lane B

Audit disabled and missing-input behavior. Confirm persist false/omitted, missing database path, missing database file, and missing table do not open, create, or mutate SQLite state.

## Lane C

Audit output redaction. Confirm the surface returns only sanitized episode summaries/statistics and no raw rows, `record_json`, facts, candidates, provider context, raw task/tool/env/secret/trace markers, or runtime authority.

## Lane D

Audit product/runtime boundaries. Confirm no Gateway, Electron, renderer, host-api/api-client/shared contract, provider registry, TaskLoop, prompt assembly, or runtime-authority path was added.

## Lane E

Run and summarize Phase 17 harness validation, focused tests, typecheck, scans, structural Phase 16-9 regressions, and comms checks when required.
