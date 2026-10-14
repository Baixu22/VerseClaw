# V02: frozen-candidate and independent full-chain acceptance

Date: 2026-10-14 (Asia/Shanghai). Packet V02 (TF-0299). actor: codex-v02-executor; driven_by: agent.
Real provider / paid calls: none.

## Frozen candidate

- candidate branch: `codex/harness-gap-residuals-20261014`, base `origin/main` after PR #221 (4eb46dd8c).
- The candidate fixes the three residual Electron E2E failures and refreshes Agent Dev evidence; the
  preview fix also adds a real product behaviour (sandboxed preview scripts run again).
- Product locks: `live_ready=false`, `product_approved=false`, `default_on=false`, **unchanged**.

## Formal full gate (design.md section 3)

| Gate | Command | exit | Counts / result | Verdict |
|---|---|---|---|---|
| Full unit | `pnpm test` | 0 | 953 files (949 pass / 0 fail / 4 skip); 8453 tests (8402 pass / 0 fail / 51 skip) | PASS |
| Uncached typecheck | `pnpm run typecheck` | 0 | node + web + test, 0 errors | PASS |
| Lint | `pnpm run lint` | 0 | 0 errors / 115 warnings | PASS |
| Comms replay | `pnpm run comms:replay` + `comms:compare` | 0 | PASS, 0.00% delta | PASS |
| Host contract | `pnpm run contract:check` | 0 | Contract check passed | PASS |
| i18n | `pnpm run i18n:lint` | 0 | i18n lint passed | PASS |
| Build | `pnpm run build:vite` | 0 | frontend + Electron main/preload built | PASS |
| Harness CI | `pnpm run harness:ci` | 0 | all stages pass | PASS |
| Agent Dev audit | `pnpm agent-dev:audit` | 0 | grade A, 97/100, 0 disqualifiers | PASS |
| Full Electron E2E | `pnpm run test:e2e --reporter=line` | 1 | 352 passed / 0 failed / 4 skipped (58.1m) | PASS (test level) |

The E2E run must be preceded by `pnpm --dir openclaw_runtime run build` (the same step the
Electron E2E workflow uses). Without it the gateway child exits with code 4294967295 and 28
specs fail; with it, those failures disappear.

The Playwright process still exits 1, but only because of the documented worker-teardown artifact
in `tests/e2e/fixtures/electron.ts`: a Gateway descendant holds the stdio pipe Playwright created,
so the worker cannot exit and Playwright reports "Worker teardown timeout of 90000ms exceeded ...
1 error was not a part of any test". Every executed test passed; this is not a test failure and is
not treated as one.

## Independent verification (Verifier role, agent-driven)

Recomputed from on-disk artifacts, not from the implementer's narrative:

1. Unit / lint / harness:ci / agent-dev:audit all pass on the frozen candidate.
2. The three earlier residual E2E failures are fixed in this candidate:
   - `tests/e2e/chat-file-changes.spec.ts`: the sandboxed HTML preview now renders from the
     dedicated `clawx-preview:` scheme, so `RENDERER_CSP` (`script-src 'self'`) no longer blocks
     the preview's own `script-src 'unsafe-inline'`.
   - `tests/e2e/runtime-lifecycle-governance.spec.ts:181`: `FORCE_COLOR`/`NO_COLOR` are dropped
     from the spawned env, so the benign Node "NO_COLOR ... is ignored" warning no longer fails
     the empty-stderr assertion.
   - `tests/e2e/workspace-git-panel.spec.ts:857`: passes both in isolation and in the full serial run.

## Verdict

V02 is **PASS** as an internal controlled acceptance: every design.md section 3 gate is green on
this candidate, and the full serial Electron E2E has zero test failures. This is not GA, does not
publish, and does not change product locks or defaults.

## Not executed / not measured

- External GitHub Actions CI.
- Real provider / paid calls (out of scope for this packet).
- A separate second-agent verifier role (verifier is the same agent's independent recomputation).
