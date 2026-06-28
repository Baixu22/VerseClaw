# Phase 17 Parallel Lanes

## Lane A: Operator Surface Contract

Prove the new operator/developer inspection surface is explicit-call only, default-off, and a thin reuse of `inspectRuntimeMemorySanitizedEpisodes(options)`. It must require explicit persistence intent and explicit database path before SQLite can be opened.

## Lane B: Explicit-Call No-Auto-Open Boundary

Prove disabled/omitted persist, missing database path, missing database file, and missing episodes table return bounded diagnostics without opening or creating SQLite state.

## Lane C: Output Redaction Stability

Prove output remains episode-only sanitized summaries/statistics and excludes raw rows, `record_json`, facts, candidates, provider context, raw task/tool/env/secret/trace markers, and runtime authority markers.

## Lane D: No Gateway/UI/Provider/TaskLoop Boundary

Prove Phase 17 adds no Gateway route, Electron IPC route, renderer surface, shared host contract, provider default registration, TaskLoop memory read, prompt injection, provider ordering cutover, or runtime authority.

## Lane E: Validation Scans and Comms

Run Phase 17 context/validate, structural regressions for Phases 16-9, focused Runtime Memory/TaskLoop/config/registry tests, Node typecheck, boundary scans, read-only mutation scans, and comms replay/compare if communication paths are modified or dirty state blocks diff-aware proof.
