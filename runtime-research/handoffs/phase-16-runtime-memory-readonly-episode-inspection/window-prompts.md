# Phase 16 Window Prompts

Use these prompts only for focused evidence collection. Synthesis owner must independently recheck claims.

## Lane A Prompt

Inspect Runtime Memory persistence and runtime integration. Determine whether Phase 15 `loadStore().listEpisodes()` is strict read-only. If not, design the smallest Runtime Memory internal inspection helper that is default-off, explicit-option-only, and no-mutation.

## Lane B Prompt

Prove database/table missing behavior and existing database no-mutation behavior. Check schema/meta/idempotency/retention effects before and after inspection.

## Lane C Prompt

Prove inspection output is sanitized episode-only JSON. Check raw markers, `record_json`, facts, candidates, provider context, and authority markers never appear.

## Lane D Prompt

Scan TaskLoop, Gateway, Electron, shared contracts, host-api/api-client, provider registry, and context provider paths for any inspection cutover or authority expansion.

## Lane E Prompt

Run required harness validation, focused Vitest, typecheck, scans, and comms commands. Record exact results and unresolved gaps.
