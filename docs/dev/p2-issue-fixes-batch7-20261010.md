# P2 issue batch 7: repository layout, lifecycle metadata and runtime source gates

Date: 2026-10-10 (agent-driven)
Base: private `main` = `578817dd9` ("fix(runtime,cvk,repo): close P2 batch 6 (#102 #150)")
Issues closed by this change: **#65, #66, #67, #71, #72, #82, #91, #94**.

This batch treats the remaining repository-governance P2 reports as one
fail-closed policy change. It does not alter product defaults, feature flags,
permission defaults, frozen locks or release state. No human action or human
data is claimed.

## Changes

- **#65**: every `harness/specs/tasks/**/*.md` file now declares
  `lifecycleStatus: active | completed | archived`. Historical specs are
  `archived`; this batch spec is `active`. `scripts/check-spec-lifecycle.mjs`
  and the harness CI entry point fail closed on missing or invalid values.
- **#66**: `docs/dev/repository-layout.md` defines top-level ownership and the
  allowed evidence roots; `packages/README.md` and `packages/vtoken/README.md`
  classify the Python/uv sidecar; and the former root design note moved to
  `docs/dev/send-button-states-design.md`.
- **#67**: `openclaw_runtime/UPSTREAM.md` records the upstream URL, vendored
  version, npm compatibility-bundle role, local-fork/sync policy and tracked
  WASM rationale. `PRUNE-MANIFEST.json` is marked superseded and version-aligned
  with the runtime package.
- **#71**: `docs/README.md` indexes every top-level docs markdown file and all
  four README locales link the index.
- **#72**: tracked files larger than 100 KiB are SHA256-grouped by
  `scripts/check-duplicate-assets.mjs`; every reviewed duplicate group is in
  `scripts/duplicate-assets-allowlist.json` with an explicit retention reason.
- **#82**: the unreferenced `public/lobe-icons/` tree (910 tracked SVGs) is
  removed; a unit test verifies it stays absent.
- **#91**: runtime `deadcode:unused-files` is part of the runtime source gate,
  and the historical prune manifest no longer presents itself as current.
- **#94**: runtime import-cycle and deprecated-API checks run in CI; the
  upstream 500-line rule now runs in baseline mode
  (`openclaw_runtime/scripts/ts-max-loc-baseline.json`) and fails on new or grown
  offenders.

## Verification

Agent-driven commands and outcomes (all `exit=0` unless noted):

- `node scripts/check-spec-lifecycle.mjs`: 455 task specs have a parsed
  lifecycle status.
- `node scripts/check-duplicate-assets.mjs`: 17 reviewed duplicate groups match
  the allowlist.
- `node scripts/check-runtime-source-policy.mjs`: upstream, prune, layout and
  LOC baseline metadata align.
- `node node_modules/vitest/vitest.mjs run tests/unit/harness-spec-lifecycle.test.ts tests/unit/docs-index.test.ts tests/unit/runtime-source-policy.test.ts`:
  3 files / 7 tests passed.
- `pnpm --dir openclaw_runtime run check:import-cycles`: 0 runtime value
  cycles.
- `pnpm --dir openclaw_runtime run check:deprecated-api-usage`: passed.
- `pnpm --dir openclaw_runtime run deadcode:unused-files`: allowlist matched 0
  intentional entries.
- `pnpm --dir openclaw_runtime run check:loc:baseline`: 1,069 existing
  offenders tracked; 0 new/grown offenders.
- `pnpm runtime:source:check`: all five source-policy/runtime gates passed.
- `node scripts/check-repository-artifacts.mjs`: 17,177 tracked paths passed.
- `pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch7-20261010.md`:
  spec valid.
- `pnpm run typecheck:test`: exited 0.
- `pnpm run harness:ci`: failed only at the pre-existing Agent Dev audit step
  because `agent-dev-workbench`, `agent-dev-deep-test` and `agent-dev-quality`
  evidence is older than its 24-hour freshness window. The batch-7 checks
  before that step passed; this batch does not refresh unrelated Agent Dev
  evidence or claim a full CI pass.

## Boundaries

Evidence is `driven_by: agent`. The duplicate allowlist is an explicit
retention decision, not a claim that those files should remain forever. The
runtime LOC baseline records the current vendored debt; it prevents new or
grown offenders but does not claim the existing 500-line debt is resolved.
No paid provider call, real-model evaluation, publication or release is part of
this batch.
