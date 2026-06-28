# Phase 19 Runtime Memory Readonly Operator Utility Command Proof Synthesis

## Decision

Accepted scope is narrow: Phase 19 proves the Phase 18 local Runtime Memory readonly operator/developer inspection utility is discoverable through the explicit package script `runtime:memory:inspect`. The package script is only `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`; it does not pass `--persist`, does not pass `--database`, does not choose a database path, and does not start Electron, Gateway, a server, listener, daemon, provider, TaskLoop, prompt assembly, or runtime authority path.

The utility remains readonly and default-off. It still requires explicit `--persist` and explicit `--database <path>` before SQLite can be opened, still requires built runtime output at `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`, and returns only sanitized episode summaries/statistics for explicit existing Runtime Memory databases.

## Rechecked Lanes

- Lane A accepted: command/help text documents readonly/default-off inspection, explicit `--persist`, explicit `--database <path>`, built-runtime requirement, no runtime behavior effect, and no durable fact/runtime authority.
- Lane B accepted: `runtime:memory:inspect` is a pure pass-through to `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`; focused build emits `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`; the utility imports the built module only after explicit command invocation.
- Lane C accepted: helper, direct utility, and package command tests prove disabled or incomplete inputs stay bounded diagnostics and no-open/no-create/no-write; existing unrelated DBs do not gain Runtime Memory tables/meta.
- Lane D accepted: JSON and text command output contain sanitized episode summaries/statistics only. Tests poison raw columns/metadata and assert no `record_json`, raw task, jsonl, prompt, payload, checkpoint, tool/env/secret/trace, facts/candidates, provider, or runtime authority markers leak.
- Lane E accepted: Phase 19 adds no Gateway, Electron, renderer, host-api/api-client/shared, provider registry, TaskLoop, prompt assembly, service/listener/daemon, or runtime-authority route.
- Lane F accepted with caveats: focused tests, typecheck, no-diff harness validation, structural Phase 18-9 validates, focused build, boundary scans, comms replay/compare, README sync review, and rollback proof passed. Full diff-aware validate is blocked by broad unrelated dirty/untracked files. Full runtime build is blocked by an unrelated existing syntax error in `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030`.

## Validation

- Phase 18 prerequisite: `runtime-research/handoffs/phase-18-runtime-memory-readonly-operator-utility-build-proof/synthesis.md` exists, has exactly one status marker, and the final non-empty line is the accepted status.
- `rtk.exe` was not available on PATH in this session, so required commands were run with the available `node`/PowerShell entrypoints.
- `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md`: passed.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md`: blocked by unrelated dirty/untracked files outside Phase 19 touched areas.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md --no-diff`: passed.
- Phase 18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-operator-inspection.test.ts`: passed, 14 tests.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-operator-inspection.test.ts`: passed, 104 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- `pnpm_config_verify_deps_before_run=false pnpm run runtime:memory:inspect -- --help`: passed. Without that local override, `pnpm run` is blocked before script execution by pnpm ignored-build approval state for unrelated dependencies.
- Renderer direct IPC/Gateway scan: no matches.
- Gateway/Electron/shared/host-api/api-client/provider/TaskLoop memory cutover scans: no matches.
- Package script scan: script is exactly `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`, with no implicit persist/database or startup terms.
- Utility/helper mutation scan found only help text stating no migrate/write behavior; no mutation calls in the utility or operator helper.
- Raw-retention scan found Phase 19 policy text and negative test fixtures/assertions only.
- Service/exporter/listener scan found Phase 19 policy/help/test text only.
- `node scripts/comms/replay.mjs`: passed.
- `node scripts/comms/compare.mjs`: passed.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 19 adds a local developer/research command only, not product behavior, UI, Gateway behavior, or public user workflow. The READMEs already describe product-facing desktop behavior and are not the right surface for this internal proof.

Rollback is to remove the `runtime:memory:inspect` package script and continue using the direct utility/helper surfaces from Phases 18, 17, and 16 when local operator inspection is explicitly needed. Omitting `runtime.memory.persist` continues to give no-open/no-read/no-write behavior.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, TaskLoop memory reads, prompt/context injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, and any memory-derived runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 19 addendum.

Status: accepted
