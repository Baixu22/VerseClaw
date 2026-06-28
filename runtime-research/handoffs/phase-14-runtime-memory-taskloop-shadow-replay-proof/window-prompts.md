# Phase 14 Window Prompts

## Lane A Prompt

Read the Phase 14 task spec, Phase 13 synthesis, this handoff README, and current TaskLoop/Runtime Memory tests. Prove the real TaskLoop adapter/persistence path writes and replays one sanitized terminal episode only when both memory flags are true. Do not add TaskLoop memory reads, provider hydration, Gateway routes, renderer paths, or raw retention.

## Lane B Prompt

Read the Phase 14 task spec and current Runtime Memory feature flag, adapter, persistence, and TaskLoop tests. Revalidate no-open/no-read/no-write disabled parity and idempotency/replay boundaries. Do not treat `runtime.memory.persist` alone as permission to write or read memory.

## Lane C Prompt

Read the Phase 14 task spec and source/test surfaces named in the spec. Prove no raw retention, durable candidate promotion, provider output/default registration, provider ordering cutover, Gateway/Electron/renderer/shared route, service/exporter/listener, or memory-derived runtime authority was added.

## Lane D Prompt

Run the required harness validation, focused tests, typecheck, scans, and comms checks when required. Record exact commands and results. A prose-only lane is not sufficient.

## Lane E Prompt

Act as synthesis owner. Re-read lane evidence, source, tests, and scan outputs. Reclassify each lane independently. If accepted, update the runtime index and write a synthesis whose final line is exactly `Status: accepted`.
