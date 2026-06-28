# Window Prompts

Use these prompts for lane review windows.

## Lane A

Review `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts` and `tests/unit/runtime-memory-read-hydration-shadow.test.ts`. Confirm helper-level `readShadow`, `runtime.memory.persist`, explicit database path, bounded sanitized summaries/projections, stats, diagnostics, and authority markers are all required and narrow.

## Lane B

Review disabled and incomplete-input paths. Confirm no SQLite open occurs unless both flags and an explicit existing path are present, and missing or unrelated databases are not created or migrated.

## Lane C

Review serialization assertions and helper projection code. Confirm output never selects or returns `record_json`, raw rows, raw prompts, transcripts, traces, payloads, tool args/output, env, secrets, or raw fact/candidate records.

## Lane D

Run boundary scans for Gateway, Electron, renderer, shared contracts, host-api/api-client, provider registry, and TaskLoop. Confirm Phase 21 is not wired into prompt/model/provider/runtime authority paths.

## Lane E

Review harness spec, handoff, synthesis, index update, README sync review, rollback plan, focused tests, build/typecheck, and command output.
