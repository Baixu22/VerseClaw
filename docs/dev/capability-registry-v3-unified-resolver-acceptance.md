# Capability Registry V3-04 Unified Resolver Acceptance

## Scope

This record covers the explicit opt-in unified resolver and its real Tool Search
compatibility adapter. It does not enable V3 for production runs, prompts, DCS,
Code Mode, provider transport, Host API, or UI.

## Ownership

- V3 owns capability navigation, descriptor identity, lease verification, and
  the six operation names.
- Tool Search owns search scoring, full schema materialization, target Tool
  hooks/approval/execution, abort behavior, and existing error semantics.
- Existing Skill and Context owners may be supplied as explicit loader callbacks;
  V3 does not import or replace them.

## Decision

V3-04 is accepted as an opt-in runtime package. No production caller, prompt,
Tool Search default, DCS projection, Code Mode path, provider transport, Host
API, UI, or persistence behavior is switched by this package.

## Evidence (2026-08-14)

- V3 core focused lane: 6 files, 41 tests passed.
- Tool Search compatibility lane (`vitest.agents-core.config.ts`): 1 file,
  4 tests passed.
- Explicit type-aware oxlint over all V3 and adapter source/tests: passed with
  `--deny-warnings`.
- Runtime core typecheck (`tsgo:core`): passed.
- Root `pnpm run lint:check`: passed with 0 errors (the repository's existing
  warnings remain informational).
- Root `pnpm run typecheck`: passed for node and web projects. The test project
  is intentionally observation-only and reported its pre-existing legacy
  errors without failing the gate.
- `git diff --check`: passed.
- `node harness/src/cli.mjs validate --no-diff --spec
  harness/specs/tasks/capability-registry-v3-unified-resolver.md`: passed.

The strict Harness diff check reports only the three pre-existing Task Forest
export/graph files outside this package's owned paths; those files were not
modified by V3 and remain untouched. The no-diff run validates the spec's
structure and required rule mapping.

## Security and boundary evidence

- Disabled construction and all six operations return `resolver-disabled`
  without reading the catalog or invoking owner delegates.
- Tool discovery calls `ToolSearchRuntime.search`; L3 calls
  `ToolSearchRuntime.describe` and re-hashes the returned schema.
- Execution requires a valid V3 lease and reaches the target only through
  `ToolSearchRuntime.callExactId`, preserving the existing executor path,
  hooks, approval, schema validation, abort, and error behavior.
- Forged/stale leases and schema mismatch produce closed failures with zero
  target executor calls.
