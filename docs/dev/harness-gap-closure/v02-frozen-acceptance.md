# V02: frozen-candidate and independent full-chain acceptance

Date: 2026-10-14 (Asia/Shanghai). Packet V02 (TF-0299). actor: codex-v02-executor; driven_by: agent.
Real provider / paid calls: none.

## Frozen candidate

- candidate branch: `codex/v02-completion-20261014`, base `origin/main` after PR #220 (256841ba1).
- The candidate adds no product behaviour; this packet only refreshes acceptance evidence and digests.
- Product locks: `live_ready=false`, `product_approved=false`, `default_on=false`, **unchanged**.

## Formal full gate (design.md section 3)

| Gate | Command | exit | Counts / result | Verdict |
|---|---|---|---|---|
| Full unit | `pnpm test` | 0 | 949 files (945 pass / 0 fail / 4 skip); 8386 tests (8335 pass / 0 fail / 51 skip) | PASS |
| Uncached typecheck | `pnpm run typecheck` | 0 | node + web + test, 0 errors | PASS |
| Lint | `pnpm run lint` | 0 | 0 errors / 115 warnings | PASS |
| Comms replay | `pnpm run comms:replay` + `comms:compare` | 0 | PASS, 0.00% delta | PASS |
| Host contract | `pnpm run contract:check` | 0 | Contract check passed | PASS |
| i18n | `pnpm run i18n:lint` | 0 | i18n lint passed | PASS |
| Build | `pnpm run build:vite` | 0 | frontend + Electron main/preload built | PASS |
| Harness CI | `pnpm run harness:ci` | 0 | all stages pass | PASS |
| Agent Dev audit | `pnpm agent-dev:audit` | 0 | grade A, 94/100, 0 disqualifiers | PASS |
| Full Electron E2E | `pnpm exec playwright test --workers=1` | 1 | 349 passed / 3 failed / 4 skipped (57.7m) | **NO-GO** |

The E2E run must be preceded by `pnpm --dir openclaw_runtime run build` (the same step the
Electron E2E workflow uses). Without it the gateway child exits with code 4294967295 and 28
specs fail; with it, 25 of those 28 pass.

## Independent verification (Verifier role, agent-driven)

Recomputed from on-disk artifacts, not from the implementer's narrative:

1. Unit / lint / harness:ci / agent-dev:audit all pass on the frozen candidate; the earlier
   11 unit failures (7 files) and 4 lint errors were cleared in PRs #219/#220.
2. The 3 residual E2E failures are on source identical to `origin/main` (this branch differs
   only in `artifacts/`):
   - `tests/e2e/chat-file-changes.spec.ts`: the preview inline script is blocked because the
     hardened renderer CSP is inherited by the `srcdoc` frame.
   - `tests/e2e/runtime-lifecycle-governance.spec.ts:181`: asserts the spawned CLI stderr is
     empty; this pruned worktree emits pnpm install warnings.
   - `tests/e2e/workspace-git-panel.spec.ts:857`: passes in isolation; order-flake in the serial suite.

## Verdict

V02 is **NO-GO** only because the full Electron E2E is not green (3 residual failures, all on
unchanged main behaviour). Every other formal gate now passes. Product locks and release state
are unchanged.

## Not executed / not measured

- External GitHub Actions CI.
- Real provider / paid calls (out of scope for this packet).
- A separate second-agent verifier role (verifier is the same agent's independent recomputation).
