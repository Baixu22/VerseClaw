# Parallel Lanes

Lane A - built helper contract:
Verify the build flag emits exactly the hydration shadow helper output and the output still represents the Phase 21 readonly diagnostics helper.

Lane B - build script no-execute boundary:
Verify the build script adds only an esbuild entrypoint selection and does not call the helper, select a database, pass readShadow, or open SQLite.

Lane C - disabled no-open packaging proof:
Verify package lifecycle scripts do not invoke the helper or the new build-only flag and do not pass implicit persistence/database/read-shadow flags.

Lane D - no product runtime cutover:
Verify no Gateway/Electron/renderer/shared/host-api/api-client/provider registry/TaskLoop route, import, or cutover is added.

Lane E - rollback docs validation:
Verify spec/handoff/index/doc-sync review, focused tests, harness validation, build/typecheck, boundary scans, and rollback notes.
