# Phase 18 Runtime Memory Readonly Operator Utility Build Proof Synthesis

## Decision

Accepted scope is narrow: Phase 18 proves the explicit local operator/developer utility `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` can load and run the built Runtime Memory operator inspection module at `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`. The accepted path is local CLI utility invocation only. It remains readonly, default-off, requires explicit `--persist` and explicit `--database <path>` before SQLite can be opened, and returns only sanitized episode summaries/statistics for explicit existing Runtime Memory databases.

Phase 18 also accepts a narrow build proof entry in `scripts/build-openclaw-runtime.mjs` for `runtime-core/memory-operator-inspection`, plus `--memory-operator-inspection-only` for focused proof when unrelated full runtime entrypoints are broken. This is a build/test utility proof path, not a product runtime cutover.

## Rechecked Lanes

- Lane A accepted: utility help documents readonly/default-off inspection, explicit persist, explicit database path, existing built runtime output, no runtime behavior effect, and no durable fact/runtime authority.
- Lane B accepted: the build script emits `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`, and the utility imports that built module only after explicit CLI invocation.
- Lane C accepted: utility tests prove no `--persist`, `--persist` without `--database`, explicit missing database path, and existing unrelated database without `runtime_memory_episodes` return bounded diagnostics without creating SQLite files/tables/rows.
- Lane D accepted: utility JSON and text output contain sanitized episode summaries/statistics only. Tests poison stored raw columns/metadata and assert no `record_json`, raw task, self-check, subagent/template/tool/env/secret/trace, facts/candidates, provider, or runtime authority markers leak.
- Lane E accepted: Phase 18 adds no Gateway, Electron, renderer, host-api/api-client/shared, provider registry, TaskLoop, prompt assembly, service/listener/daemon, or runtime-authority route.
- Lane F accepted with caveats: focused tests, typecheck, no-diff harness validation, structural Phase 17-9 validates, and boundary scans passed. Full diff-aware Phase 18 validate is blocked by broad unrelated dirty/untracked files. Full app runtime build is blocked by an unrelated existing syntax error in `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030`.

## Validation

- Phase 17 prerequisite: `runtime-research/handoffs/phase-17-runtime-memory-readonly-operator-inspection-surface/synthesis.md` exists, has exactly one status marker, and the final non-empty line is the accepted status.
- `rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md`: passed.
- Main worktree full diff-aware `validate --spec phase-18`: blocked by unrelated dirty/untracked files outside Phase 18 touched areas.
- `rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md --no-diff`: passed.
- Phase 17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- Focused tests: `rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-operator-inspection.test.ts`: passed, 99 tests.
- Narrow built-runtime proof: `rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed and emitted `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`.
- Full app runtime build: `rtk.exe node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- Node typecheck: `rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Renderer direct IPC/Gateway scan: no matches.
- Gateway/Electron/shared/host-api/api-client import/cutover scan: no matches.
- TaskLoop memory read/fact/provider scan: no matches.
- Utility/helper mutation scan found only help text stating no migrate/write behavior; no mutation calls in the utility or operator helper.
- Raw-retention scan found Phase 18 policy text and negative test fixtures/assertions only.
- Service/exporter/listener scan found Phase 18 policy/help text only.
- Comms replay/compare not run: Phase 18 did not modify Main/Gateway/host-api/api-client/provider transport paths. The worktree does contain unrelated dirty communication-adjacent files, which is why full diff-aware validation is recorded as blocked rather than treated as Phase 18 proof.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, TaskLoop memory reads, prompt/context injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, and any memory-derived runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 18 addendum. The file still contains invalid UTF-8 bytes, so the addendum was appended as UTF-8 bytes rather than rewritten through the normal patch tool.

Status: accepted
