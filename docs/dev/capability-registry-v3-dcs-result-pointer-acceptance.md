# Capability Registry V3-05 DCS Projection and Result Pointer Acceptance

## Scope

This record covers the default-disabled metadata-only DCS projection and the
ArchiveHandle-backed Result Pointer facade. It does not enable prompt injection,
replace `tool_registry`, register a new context block, connect Code Mode, change
provider transport, or expose a Host API/UI route.

## Decision

V3-05 is accepted as an explicit opt-in, caller-owned runtime package. It does
not publish a new DCS Block, change prompt injection, replace `tool_registry`,
or add persistence. Result Pointers are runtime-issued, session/task-scoped,
and archive only through the existing Context Family owner.

## Evidence (2026-08-14)

- V3 core focused lane: 8 files, 56 tests passed.
- Tool Search compatibility lane (`vitest.agents-core.config.ts`): 1 file,
  4 tests passed.
- Explicit type-aware oxlint over V3-05 source/tests: passed with
  `--deny-warnings`.
- Runtime core typecheck (`tsgo:core`): passed.
- Root `pnpm run lint:check`: passed with 0 errors (the repository's existing
  warnings remain informational).
- Root `pnpm run typecheck`: node and web projects passed. The test project is
  observation-only and reported its existing legacy errors without failing the
  gate.
- `git diff --check`: passed.
- `node harness/src/cli.mjs validate --no-diff --spec
  harness/specs/tasks/capability-registry-v3-dcs-result-pointer.md`: passed.

The strict Harness diff check is blocked solely by the three pre-existing Task
Forest export/graph files outside this package's owned paths. They were not
modified by V3; no-diff validation proves the task spec, scenario, and rule
mapping are structurally valid.

## Boundary and security evidence

- The disabled projection/pointer paths do not inspect the catalog or call the
  archive owner.
- DCS navigation is deterministic, category/namespace structured, bounded by
  entry/character limits, and contains no schemas, executor, raw result, DCS
  Block, or `tool_registry` content. Targeted namespace/capability reads retain
  descriptor hashes and source identity only.
- Pointer creation delegates only to `createContextArchiveHandleForPayload`;
  pointer metadata contains a summary, scope, expiry, permissions, and
  checksum-backed ArchiveHandle but never a raw result body.
- Pointer reads validate runtime issuance, pointer metadata, session, task,
  permissions, and TTL before archive verification. Read/slice/search return
  bounded output and fail closed for forged, cross-session, wrong-task,
  expired, checksum-mismatched, missing, or hard-deleted archives.
