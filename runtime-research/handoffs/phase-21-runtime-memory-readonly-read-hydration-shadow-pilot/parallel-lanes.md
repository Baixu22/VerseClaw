# Parallel Lanes

Lane A - read hydration contract:
Verify the helper result shape, explicit `readShadow` opt-in, bounded sanitized episodes/facts, stats, diagnostics, and authority boundary markers.

Lane B - disabled no-open boundary:
Verify disabled, missing opt-in, missing database path, missing database file, and unrelated database states do not open, create, read, write, or migrate SQLite.

Lane C - sanitized diagnostics output:
Verify output excludes raw rows, `record_json`, raw task text, self-check, subagent/template/tool/env/secret/trace markers, raw facts/candidates records, provider context, and runtime authority markers.

Lane D - no prompt/provider/TaskLoop authority:
Verify Phase 21 adds no Gateway/Electron/renderer/shared/host-api/api-client/provider registry/TaskLoop route, import, or cutover.

Lane E - rollback docs validation:
Verify spec/handoff/index/doc-sync review, focused tests, harness validation, build/typecheck, boundary scans, and rollback notes.
