# TF-0072 Mission / Task Loop / DCS / SEKB Lineage Evidence

- Date: 2026-08-20
- Task Forest node: `TF-0072`
- Start session: `session-20260820-start-tf0072`
- Start proposal: `TFP-start-TF-0072-20260820`
- Current Task Forest status: `done` (100%); `TF-0073` is the only newly unlocked direct successor

## Scope

This change adds one bounded `runtime-lineage.v1` correlation object across the
existing Mission tick, Task Loop, DCS task-state blocks, and SEKB trajectory
paths. Existing stores and lifecycle authorities remain owners of their data;
lineage is metadata only. Legacy records remain readable without inferred IDs.

The Knowledge runtime view now displays available source trajectory lineage and
confirmed provenance. Confirm-only SEKB writes reject a stored source session
that conflicts with the confirming session.

## Acceptance Evidence

| Acceptance condition | Evidence |
| --- | --- |
| Mission -> Task Loop -> DCS -> SEKB IDs are traceable | Production `tickMission` integration test persists one lineage through `runTaskLoop`, phase hook / HandoffPack, and SQLite `TrajectoryCapture`; `openclaw_runtime/src/agents/mission-control/fenced-tick-wiring.test.ts` |
| Same-session ticks are not identified by `sessionKey` alone | `runtime-lineage.v1` requires `sessionId`, carries `missionId` and `missionTick` when present, and normalization never derives missing values; `openclaw_runtime/src/runtime-core/lineage.test.ts` |
| Knowledge review exposes source lineage and confirm provenance | `tests/e2e/knowledge-hub.spec.ts` includes lineage-backed runtime report data and review assertions; Electron E2E passed 4/4 after runtime freshness rebuild |
| Contract/schema tests and E2E pass | `pnpm contract:check` exit 0; focused lineage/runtime tests pass; Knowledge Hub E2E 4 passed |

## Verification Log

| Command | Result |
| --- | --- |
| `pnpm harness validate --spec harness/specs/tasks/runtime-lineage-convergence.md --no-diff` | exit 0 |
| `node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts ...` | 4 files, 49 tests passed |
| `node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts ...` | 2 files, 7 tests passed |
| `pnpm test:dcs` | 20 files / 253, 5 files / 10, 10 files / 88; total 351 tests passed |
| `pnpm run typecheck` | exit 0; node and web exit 0. Test project remains observation-only with 1048 legacy errors |
| `pnpm --dir openclaw_runtime tsgo:core` | exit 0 after adding the required NodeNext `.js` extensions to three existing VerseShell shared imports |
| `pnpm verseshell:test` | exit 0; bundle 13/13, runtime bundle 11/11, OpenClaw 15 files / 141 tests, MCP 11/11 |
| `pnpm lint:dcs` | exit 0 |
| `pnpm contract:check` | exit 0 |
| `pnpm i18n:lint` | exit 0 |
| `pnpm run comms:replay` | exit 0; current metrics written |
| `pnpm run comms:compare` | exit 0; regression result `PASS` |
| `pnpm run build:vite` | exit 0; frontend, Electron main, and preload built |
| `pnpm build:runtime` | exit 0; current-source runtime smoke gateway ready |
| `pnpm run test:e2e:run -- tests/e2e/knowledge-hub.spec.ts` | First run stopped by freshness gate (`21 src file(s) newer than dist`, no tests entered). After rebuilding current runtime sources, the final run passed 4/4 in 46.2s |

## Known Boundaries

- Normal harness validation (without `--no-diff`) is intentionally not claimed:
  it exits 1 because the shared worktree contains many unrelated modified and
  untracked paths outside this task spec's `touchedAreas`.
- The working tree is not a clean formal-acceptance candidate. This evidence
  supports local engineering verification only; it does not establish live
  readiness, product approval, or a default-on rollout.
- The user explicitly authorized TF-0072 closeout on 2026-08-20. Task Forest
  status, evidence, and downstream readiness are applied through the saved
  proposal, followed by `validate` and `export`.

## Authority and Safety

No new state store, database table, workflow authority, automatic principle
writeback, or product-lock change was introduced. Lineage fields are bounded,
typed, and passed through existing boundaries; missing legacy fields are omitted
or treated as incomplete rather than guessed.
