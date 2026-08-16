---
id: verseshell-command-profile-boundary
title: VerseShell argv-only Command Profile Boundary
type: ai-coding-rule
appliesTo:
  - verseshell-p2-command-profiles
  - gateway-backend-communication
severity: error
---

# VerseShell argv-only Command Profile Boundary

## Authority

- OpenClaw owns command interpretation, risk classification, allowlist, approval, profile selection,
  sanitized environment construction, and the model-facing `exec`/`process` tools.
- The execution plan must be produced before approval and must bind the exact argv, executable identity,
  cwd, environment policy, timeout and output budget that will be executed after approval.
- VerseShell owns process creation, PATH/PATHEXT resolution at the verified runtime boundary, stdin,
  output/artifact bounds, timeout, cancellation and process-tree cleanup. It must not parse a shell string
  after approval.
- ClawX remains the owner of workspace, journal, binary/protocol/catalog identity and operator kill switch.

## Direct argv contract

- A simple one-segment command uses the analysis segment's effective argv unchanged. Ordinary commands do
  not receive an implicit `cmd /C`, PowerShell, Git Bash, `sh -lc`, WSL or native fallback wrapper.
- `pnpm`, `npm`, `corepack`, test/build/lint runners and `git` remain ordinary argv programs; their wrapper
  subcommands are arguments, not shell text.
- Windows `.exe` and `.com` may resolve directly through PATH/PATHEXT. `.cmd` and `.bat` require an explicit,
  audited `cmd.exe` interpreter profile and must retain the resolved script identity.
- Executable and cwd paths containing spaces or Unicode are data, never shell source. NUL, unresolved
  executable identity, workspace escape, unbounded env, timeout or output budget fail closed.

## Explicit shell boundary

- Pipelines, chains, redirects, heredocs, inline evaluation, explicit shell interpreters and terminal scripts
  remain shell payloads. They require their own policy/approval and an auditable interpreter; they must not
  be silently downgraded to direct argv.
- Shell compatibility is opt-in per request/profile. `VERSESHELL_OS_SHELL` or an equivalent interpreter
  setting cannot turn ordinary commands into implicit shell wrappers.

## Retry, output and rollout

- `process.start`, `process.write`, `process.kill`, `exec.run` and unknown effectful requests are never
  automatically replayed after uncertain delivery.
- cwd/env/timeout/output/artifact values are bounded and carried in the same immutable plan. Large output
  is reduced to bounded observation plus artifact handle and queried through `result.query`.
- A contract, policy, executable, runtime or kill-switch failure is fail-closed. Do not switch to native,
  MCP or legacy execution and do not change `default-off`, `liveReady`, `productApproved` or `defaultOn`.
