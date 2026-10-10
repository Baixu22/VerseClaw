# P2 issue batch 8: masked archive recall and pre-truncation native output capture

Date: 2026-10-10 (agent-driven)
Base: private `main` after batch 7.
Issues closed by this change: **#113, #114**.

## #113 - masked observations now have a model-callable bounded recall path

The masking placeholder now names `context_archive_recall` and includes the
archive URI, checksum and byte length. The new built-in tool:

- normalizes the supplied handle and verifies its checksum through the existing
  Context Family archive owner;
- requires `archiveHandle.source.sessionId` to equal the current tool session,
  so a handle copied from another session is rejected;
- returns a bounded excerpt with offset/max-chars paging plus char and UTF-8
  byte counts and an explicit `truncated` flag.

The gateway operator RPC was not exposed as a generic agent action. The tool is
registered in the context-tool catalog and treated as readonly by the
destructive-tier classifier.

## #114 - native output is archived before the first lossy cap

`appendOutput` now calls an optional raw-output capture before pending and
aggregate buffers are trimmed. The native/PTY session installs a bounded
8 MiB spool capture and finalizes it through the existing Context Family archive
owner on process exit. The resulting archive handle is attached to exec result
details and reused by tool-result truncation, so later recovery points to the
original stream rather than the already-capped message.

The in-memory output limits and model-visible output remain unchanged. Disk
capture is bounded and reports a truncated/non-recoverable state rather than
claiming lossless recovery when the spool cap is reached.

## Verification

Agent-driven checks passed:

- `context-archive-recall.test.ts`: 2/2.
- `native-raw-output-archive.test.ts` and
  `native-raw-output-archive-reuse.test.ts`: 2/2.
- `context-observation-masking.test.ts` + context registry coverage: 18/18.
- `context-agent-tools.test.ts`: 20/20 with the new catalog entry.
- runtime process lifecycle/characterization shard: 29/29.
- runtime core and extension `tsgo` no-emit checks: exit 0.

## Boundaries

This does not claim raw OS decoder bytes: the capture point is decoded text
before presentation sanitization/trimming. Tests use synthetic output and do
not claim real-provider or packaged Electron E2E. The duplicate archive owner
and default observation-masking flag are unchanged.
