# VerseShell P2-02 argv-only Command Profiles Evidence (2026-08-14)

Status: engineering evidence only. P2-02 remains explicit opt-in and fail-closed; it does not
enable canary traffic, writes, provider usage, default-on, GA, or product approval. The locks remain
`default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## Scope

P2-02 converts the pre-approval OpenClaw command analysis into an immutable host-owned execution
plan. A single-segment ordinary coding command becomes direct argv (`mode: "argv"`); pipelines,
chains, redirects, heredocs, inline evaluation, and explicit interpreters remain explicit
terminal-shell payloads and are never silently downgraded to argv. The host derives the profile from
the analysis (`test`/`build`/`lint`/`git`/`generic`/`terminal-shell`); the model never chooses a
profile, interpreter, PATH/PATHEXT resolution, policy, or approval token.

The plan is produced before approval (`bash-tools.exec.ts` binds it before the gateway allowlist
wait and carries it through `processGatewayAllowlist` into `runExecProcess`), and the governed
route (`governed-process.ts` / `governed-exec.ts`) receives that exact plan. Approval never re-parses
the display command. Windows `.exe`/`.com` resolve as direct argv; `.cmd`/`.bat` retain the resolved
script identity plus an audited `ComSpec`/`SystemRoot` interpreter under `interpreterProfile:
"windows-cmd"`, and the runtime derives `cmd.exe` itself from the resolved script path plus env.
A drifted windows-cmd plan fails closed at the process boundary with `E_VERSESHELL_SCRIPT_IDENTITY`.

cwd/env/argv/timeout/output are bounded metadata on the same plan: argv item and byte caps,
environment key/byte/NUL caps, workspace cwd validation, per-profile timeout clamping (1ms floor,
profile maximum), per-profile output clamping, and fail-closed errors for every violated bound.
Unknown effectful requests are never replayed and no native/MCP/legacy fallback is reachable from
this route.

## Changed surfaces

- `openclaw_runtime/src/agents/verseshell/command-profiles.ts` (+ tests): plan resolution, profile
  inference, explicit-shell detection, Windows batch interpreter identity, bounded inputs.
- `openclaw_runtime/src/agents/verseshell/shell-command.ts` (+ new tests): renamed to the
  explicit-shell-only helper `resolveExplicitVerseShellCommandArgv`; the old name remains a
  deprecated alias for the legacy compatibility route only.
- `openclaw_runtime/src/agents/verseshell/governed-process.ts` (+ tests): consumes the immutable
  plan, clamps timeout/output, audits windows-cmd script identity at the process boundary.
- `openclaw_runtime/src/agents/verseshell/governed-exec.ts` (+ tests): plan-based argv, bounded
  result-query response size and missing-data rejection.
- `openclaw_runtime/src/agents/bash-tools.exec.ts`, `bash-tools.exec-host-gateway.ts`,
  `bash-tools.exec-runtime.ts`: plan binding before approval and handoff through the gateway
  allowlist into the governed process start.
- `harness/specs/tasks/verseshell-p2-command-profiles.md` and
  `harness/specs/rules/verseshell-command-profile-boundary.md`: spec and boundary rule.
- `tests/unit/verseshell-command-profiles.test.ts`: root P2-02 contract tests.

## Focused Verification

Base SHA: `b04c22a6b011cfecf4c564eb9fca6aad395f108c` (worktree HEAD, branch `main`). The candidate
is the dirty shared worktree; nothing was committed, pushed, or reset.

| Check | Result |
|---|---|
| `pnpm harness context --spec harness/specs/tasks/verseshell-p2-command-profiles.md` | PASS |
| `pnpm harness validate --no-diff --spec harness/specs/tasks/verseshell-p2-command-profiles.md` | PASS |
| `pnpm harness validate --spec ...` (diff-aware) | BLOCKED: shared-worktree unrelated changed paths and the harness child lacks local `node_modules`; no bypass used |
| `pnpm verseshell:test` | PASS (bundle 13/13, runtime-bundle 11/11, OpenClaw VerseShell 15 files / 141 tests, MCP 11/11) |
| `pnpm exec vitest run tests/unit/verseshell-command-profiles.test.ts --maxWorkers=1` | 6/6 PASS |
| `pnpm run typecheck:node` | PASS |
| `pnpm run typecheck` (aggregate node + web + ext bridge) | PASS (node/web/bridge exit 0, ~101s) |
| `pnpm run comms:replay` | PASS |
| `pnpm run comms:compare` | PASS (0 loss/duplicate/reorder; throughput/latency deltas 0.00%) |
| scoped `eslint` over the eight changed TS files | PASS (0 errors, 0 warnings) |
| `git diff --check` plus trailing-whitespace/final-newline scan of untracked files | PASS |

## P2-02 acceptance matrix

| Matrix row | Covered by | Result |
|---|---|---|
| `.exe` / `.com` direct argv, spaces/Unicode executable and argv | command-profiles PE `it.each` + root contract | PASS |
| `.cmd` / `.bat` audited cmd.exe profile: resolved script identity, ComSpec/SystemRoot derivation | batch `it.each`, interpreter identity describe | PASS |
| PATH/PATHEXT: analysis-resolved `.exe` stays direct; resolved `.cmd` shim becomes windows-cmd | analysis resolution matrix | PASS |
| pnpm/npm/corepack/yarn/bun combos incl. `exec`/`dlx` runner passthrough | profile inference matrix | PASS |
| Fail-closed: bare batch name, bare/NUL/missing interpreter, NUL argv/env, argc/arg-byte/env-byte caps, empty cwd | bounded inputs + interpreter identity describes | PASS |
| Explicit shell syntax (pipeline/chain/redirect/heredoc/inline/backtick/variable) stays a shell payload; quoted tokens are not flagged | explicit shell boundary describe | PASS |
| Timeout floor/clamp and output clamp per profile | governed-process clamp tests | PASS |
| Non-zero exit and timeout projected as bounded failures; large result reduced to artifact; oversized/missing result.query rejected | governed-exec failure-mode tests | PASS |
| windows-cmd plan identity audited at process.start; drifted plan fails closed; display command never re-parsed | governed-process contract tests | PASS |
| Kill switch and no-native-fallback fail-closed | governed-exec-runtime rollout tests (3/3) | PASS |

## Residuals

- The normal diff-aware harness validator cannot establish ownership for this spec in the shared
  worktree (unrelated pre-existing changes) and its harness child package has no local
  `node_modules`. This is retained as an environment residual, consistent with earlier foundation
  packages; a clean candidate worktree is required for release-quality diff-aware validation.
- The aggregate `pnpm run typecheck` (node + web projects plus the extension bridge) also passed;
  the repository-wide `pnpm run lint:check` was not part of the required-test window, and the
  scoped ESLint over every changed file passed with 0 errors / 0 warnings. This is not used to
  waive any gate.
- No commit/push was performed; the worktree keeps all prior VerseShell stages and other tasks'
  WIP untouched.

## Next gate

The `TF-0065` closeout proposal `TFP-verseshell-p2-02-closeout-20260814` has been saved and
applied through the Task Forest CLI (`validate` and `export` PASS). `TF-0065` is `done` at
100% and the only next node `TF-0066` / VS-P2-03 diagnostics is `ready`. P3 writes, provider
canary, default-on, GA, and product approval remain unauthorized.
