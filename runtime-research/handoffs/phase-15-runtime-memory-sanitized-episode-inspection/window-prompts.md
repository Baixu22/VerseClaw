# Phase 15 Window Prompts

## Lane A Prompt

Read the Phase 15 task spec, Phase 14 synthesis, this handoff README, and current Runtime Memory persistence/runtime integration tests. Prove the existing `loadStore().listEpisodes()` store snapshot is sufficient for persisted sanitized episode inspection. Do not add a production inspection API unless current code cannot satisfy the contract.

## Lane B Prompt

Read the Phase 15 task spec and focused Runtime Memory tests. Prove inspection JSON excludes raw task text, self-check text, subagent ids, template ids, transcripts, raw rows, `record_json`, tool args/output, env, secrets, and raw trace context.

## Lane C Prompt

Read the Phase 15 task spec and current Runtime Memory feature flag, adapter, and persistence tests. Revalidate no-open/no-read/no-write disabled parity for inspection. Do not treat `runtime.memory.persist` alone as TaskLoop write or provider-output permission.

## Lane D Prompt

Read the Phase 15 task spec and source/test surfaces named in the spec. Prove no TaskLoop memory read, fact write, invalidation write, provider hydration, provider default registration, provider ordering cutover, Gateway/Electron/renderer/shared route, service/exporter/listener, or memory-derived runtime authority was added.

## Lane E Prompt

Run the required harness validation, focused tests, typecheck, scans, and comms checks when required. Record exact commands and results. A prose-only lane is not sufficient.

## Synthesis Prompt

Act as synthesis owner. Re-read lane evidence, source, tests, and scan outputs. Reclassify each lane independently. If accepted, update the runtime index and write a synthesis whose final line is exactly `Status: accepted`.
