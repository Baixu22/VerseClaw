# TF-0074 Real-Use Acceptance Evidence

- Date: 2026-08-21
- Task Forest node: `TF-0074`
- Session: `session-20260821-tf0074-first-slice`
- Engineering status: `done` (scoped engineering acceptance only)
- Product status: `liveReady=false`, `productApproved=false`, `defaultOn=false`

## Scope

This closeout independently rechecked the current DCS, Mission/Task Loop, runtime-lineage,
SEKB candidate-gating, Host API, and Electron Knowledge paths. It does not claim a real
third-party channel run, a human acceptance cohort, product approval, or default-on
authorization.

## Production Defect Found And Fixed

The TF-0073 candidate gate requires tool evidence, a terminal outcome, and a complete
`runtime-lineage.v1`. The Electron golden-path fixture had tool steps but the production
`knowledge.sekbCaptureTrajectory` Host API could not accept or forward runtime lineage,
so trajectories captured through that route could never satisfy the candidate gate.

The Host API contract now accepts an explicit optional `runtimeLineage`. Main validates
it fail-closed with the shared runtime validator and forwards it as trajectory metadata.
Lineage is never inferred from `sessionKey`. Invalid lineage returns `invalidInput`.
The Electron golden path supplies explicit fixture lineage and verifies the complete
capture -> confirm -> recall -> behavior-delta path.

Manual trajectories still omit tool steps and lineage. They remain readable and
deletable audit records but are not distillation candidates. The Knowledge UI now states
that boundary in all four locales, and Electron E2E verifies the English surface.

## Verification Log

| Gate | Result |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/tf0074-real-use-acceptance.md` | exit 0 |
| `pnpm harness validate --spec harness/specs/tasks/tf0074-real-use-acceptance.md --no-diff` | exit 0 |
| Isolated-candidate Harness context | direct repository CLI exit 0 |
| Isolated-candidate diff-aware Harness validate | exit 0 with `--since HEAD`; spec valid against 58 staged scoped paths |
| Isolated-candidate Harness dry-run | exit 0 with `--since HEAD`; report result `pass` |
| `pnpm run test:dcs` | exit 0; 253 unit + 10 runtime-config + 88 agents = 351 tests passed |
| Isolated-candidate Task State / phase / Mission tick / SEKB agents tests | exit 0; 4 files, 33 tests passed |
| Isolated-candidate runtime lineage / terminal gating / golden path tests | exit 0; 3 files, 11 tests passed |
| Isolated-candidate Host API facade test | exit 0; 1 file, 43 tests passed |
| Isolated-candidate `contract-check.mjs` / `i18n-lint.mjs` | both exit 0 |
| `pnpm --dir openclaw_runtime tsgo:core` on the authoritative worktree | exit 0 on final source |
| `pnpm run typecheck` | exit 0 for node/web; observation-only test project still reports 1,048 legacy errors |
| `pnpm run lint:dcs` on the authoritative worktree | exit 0 on final source |
| Changed-file ESLint | exit 0; existing `knowledge-api.ts` `no-explicit-any` warnings only |
| `pnpm run contract:check` | exit 0 |
| `pnpm run i18n:lint` | exit 0 |
| Forced `pnpm run build:runtime` | exit 0; runtime smoke gateway became ready |
| `pnpm run build:vite` | exit 0; existing Tailwind, large-chunk, and dynamic-import warnings only |
| Electron Knowledge + SEKB E2E | first attempt blocked before execution by stale-runtime guard; forced rebuild plus immediate rerun exit 0, 5/5 passed |
| `pnpm run comms:replay` + `pnpm run comms:compare` | exit 0; comparison PASS, zero loss/order/duplicate regressions |
| `pnpm run dcs:ops:preflight` | exit 0, PASS, `hardStop=false`; recommendation remains `keep-off` |
| `pnpm run dcs:c1:gate` | exit 0, `ok=true`; recommendation remains `keep-off` |
| `task_forest.py validate` | exit 0 |
| `task_forest.py export` | exit 0; `.agent-workbench/task-forest/exports/task-forest.html` refreshed |
| Final docs sync | `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` state the manual-trajectory audit-only boundary |

## Evidence Boundaries

- The shared worktree remains dirty and is not represented as a release candidate. The
  missing diff-aware proof was supplied in the detached candidate
  `D:\ClawX-tf0074-closeout-20260821` at base
  `e07b874b30c31701b437b1e972c8a40b5ca5f8c4`, using only the 58 staged paths required
  by the integrated TF-0070 through TF-0074 acceptance chain. No unrelated main-worktree
  file was reset, stashed, deleted, or added to `touchedAreas` to manufacture a pass.
- A fresh candidate-only `tsgo:core` run through shared Windows junctioned dependencies
  reached three `openclaw_runtime/ui/vitest.config.ts` excessive-stack-depth/overload
  errors (`TS2321`/`TS2769`). The same official gate on the authoritative worktree exits
  0, and the candidate's task-specific runtime, contract, and test surfaces pass. This worktree-link
  limitation is retained as an environment residual rather than relabeled as a source pass.
- The candidate's first `pnpm harness` wrapper attempt exited 1 because pnpm wanted to
  purge the junctioned modules directory without a TTY. Direct invocation of the same
  checked-in Harness CLI produced the successful context, diff-aware validate, and
  dry-run results above without mutating shared dependencies.
- Electron E2E uses explicit test-fixture lineage. It is current-source engineering
  evidence, not a real channel or human/live acceptance run.
- `dcs:ops:preflight` still reports missing deep-test week-one `decision.md`, missing L3
  profiles, zero of ten human surrogate runs, and blocked `TF-0006` prerequisites.
- No automatic SEKB writeback was introduced. Human confirmation remains the only durable
  promotion path.
- No product lock was changed: `liveReady=false`, `productApproved=false`, and
  `defaultOn=false` remain authoritative.

## Task Forest Closeout Record

`TF-0074` is closed as `done` at 100% through proposal
`TFP-close-TF-0074-20260821`. This status closes the scoped engineering acceptance
package only. It does not satisfy the real-channel, human, rollout, product-approval,
or default-on prerequisites listed above. No successor node was started in parallel.
