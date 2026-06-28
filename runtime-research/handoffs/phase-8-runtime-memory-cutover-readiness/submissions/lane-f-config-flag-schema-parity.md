# Lane F: Config Flag Schema Parity

Status: accepted

## Scope

Phase 8 remediation added formal OpenClaw config type/schema/label/help coverage for the already implemented default-off runtime memory and trace context feature flags.

## Changed Files

- `openclaw_runtime/src/config/types.openclaw.ts`
- `openclaw_runtime/src/config/zod-schema.ts`
- `openclaw_runtime/src/config/schema.labels.ts`
- `openclaw_runtime/src/config/schema.help.ts`
- `tests/unit/runtime-feature-config-schema.test.ts`
- `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-f-config-flag-schema-parity.md`

## Boundary

Phase 8 remains docs/evidence-only cutover readiness. This change does not implement Phase 9 persistence, does not add file/database/SQLite/JSONL writes, does not change TaskLoop/Gateway/renderer behavior, does not alter provider ordering, does not register memory or trace providers in the default registry, and does not make memory/trace/evidence authoritative for completion, security, retry, tools, or runtime decisions.

`runtime.memory.persist` is only a default-off formal config gate. It does not mean persistence is implemented or accepted.

## Validation

- `corepack pnpm harness context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`: pass.
- `corepack pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md`: pass.
- `corepack pnpm harness validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md`: pass.
- `corepack pnpm harness validate --spec harness/specs/tasks/phase-6-trace-context-provider.md`: pass.
- `corepack pnpm test tests/unit/runtime-feature-config-schema.test.ts`: pass, 1 file / 4 tests.
- `corepack pnpm test tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts`: pass, 6 files / 79 tests.

Environment notes:

- Bare `pnpm harness context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` and bare `pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` initially failed before reaching the harness because PATH `pnpm` was 11.7.0 and stopped on build-script approval configuration. The project-pinned `corepack pnpm` resolved to pnpm 10.33.4 and passed the required harness checks.
- `corepack pnpm test -- tests/unit/runtime-feature-config-schema.test.ts` passed `--` through to Vitest and triggered the broader unit suite, which failed on unrelated existing dirty-worktree tests. The focused config schema test passed with `corepack pnpm test tests/unit/runtime-feature-config-schema.test.ts`.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed by search for runtime memory/trace config terms; no public README update was required for this default-off internal config schema parity change.
