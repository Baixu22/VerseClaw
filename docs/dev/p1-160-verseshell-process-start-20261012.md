# #160: process.start lifecycle-root pre-create and real-limit verification

- Date: 2026-10-12
- Issue: #160
- Related: #155
- driven_by: agent
- actor: codex
- Base: `origin/main = 931688dfe`

## What the issue claimed, and what is actually true

#160 was filed as "`process.start` fails on this host for every command with
`Access denied. (os error 5)` / `E_PROCESS_INTERNAL`", with a follow-up comment
concluding the shipped `ae.exe` has no defect and the failure is a host sandbox
write denial on `<workspace>/.ae/process-lifecycle`.

Re-running on this host (same `CODEX_PERMISSION_PROFILE=:danger-full-access`
marker, but with the current user present in the workspace ACL) **reproduces the
original symptom only until the lifecycle root exists**. Once
`<workspace>/.ae/process-lifecycle` is present, `process.start` runs normally.
The sandbox denial is therefore conditional on the host's ACL for that path, not
a property of the binary.

## Change 1 - host-side lifecycle-root pre-create (product)

`openclaw_runtime/src/agents/verseshell/governed-process.ts` now creates
`<workspace>/.ae/process-lifecycle` before the first `process.start`. The
executor creates that directory as its first write inside `process.start`, and a
bare `io::Error` from that `create_dir_all` is what `process_ops.rs`'s
`failure()` maps to `E_PROCESS_INTERNAL` (the message has no `E_`-prefixed
segment, so the code falls back to internal).

- Best-effort and non-fatal: if the directory already exists, or the host cannot
  create it, the executor's own error still reaches the caller unchanged.
- It does not remove a host write denial. It converts an opaque
  `E_PROCESS_INTERNAL: Access denied` into the executor's normal next step - the
  approval gate, then `E_PROCESS_PERSIST` if the record write is denied - so the
  failure is diagnosable instead of mysterious.
- No prompt, tool, policy or default-value change; no new dependency.

## Change 2 - the opt-in real-limit suite was asserting the wrong thing

`governed-process.real-limits.test.ts` was gated behind
`VERSESHELL_REAL_PROCESS_START_LIMITS=1` because the op "could not be verified
here". With the root pre-created, the op runs, and the two existing assertions
turn out to encode incorrect assumptions rather than real enforcement gaps:

- **`maxProcesses: 1` case.** The old command was
  `cmd.exe /D /C "echo outer & cmd.exe /D /C echo inner"`. `cmd.exe /C` needs a
  helper process of its own, so a Job Object that already holds the root (cap 1)
  refuses `cmd.exe` before it prints anything. The observable is "the root
  cannot spawn its own helper", not "the inner child is refused". Rewritten to a
  Node root script that prints a marker and then `spawnSync`s `cmd.exe`: the root
  runs, and the child spawn reports a null status instead of 0.
- **`maxMemoryBytes: 64 MiB` case.** The old command was PowerShell
  `New-Object byte[] (268435456)`. Under the cap the allocation throws
  `OutOfMemoryException`, but PowerShell is not `$ErrorActionPreference='Stop'`
  by default, so it **continues** and still prints `alloc-ok` - the cap did fire,
  the assertion just could not see it. Rewritten to a Node script whose
  allocation failure is fatal, so `alloc-ok` is absent exactly when the cap is
  enforced.

## Measured behaviour (bundled ae.exe, sha256 ac6a7a15...0786, current host)

| Scenario | `process.start` observation |
|---|---|
| `process.start` `cmd.exe /D /C echo probe-ok`, no limits, root pre-created | ok, exit 0, stdout `probe-ok` |
| Node root spawns `cmd.exe`, `maxProcesses: 1` | root runs, `spawnSync` status `null` (child refused), receipt `enforced: true` |
| Node root spawns `cmd.exe`, no cap | root runs, child status `0` |
| Node root allocates 256 MiB, no cap | exit 0, `alloc-ok` |
| Node root allocates 256 MiB, `maxMemoryBytes: 64 MiB` | allocation fails before the marker, receipt `enforced: true` |

All five are agent-driven; no human operator, no elevated privileges, and the
memory experiment allocates 256 MiB against a 64 MiB cap (twice the cap, never
more).

## Verification

| Gate | Command | Result |
|---|---|---|
| VerseShell suite (limits opt-in ON) | `VERSESHELL_REAL_PROCESS_START_LIMITS=1 VERSESHELL_REAL_EXEC_LIMITS=1 vitest run --config test/vitest/vitest.verseshell.config.ts` | 25 files, **325 passed / 0 failed / 0 skipped** |
| VerseShell suite (default) | same, flags unset | 24 passed / 1 skipped, **323 passed / 2 skipped** |
| Runtime core typecheck | `tsgo -p openclaw_runtime/tsconfig.core.json --noEmit` | exit 0 |
| Import cycles | `pnpm --dir openclaw_runtime run check:import-cycles` | 0 runtime value cycles |
| Scoped lint | `eslint <2 changed files> --max-warnings 0` | exit 0 |

## Boundaries

- The pre-create is a diagnosability fix, not a sandbox bypass: a host that
  denies the record write still fails, now with `E_PROCESS_PERSIST` instead of
  `E_PROCESS_INTERNAL`.
- The receipt still has no kernel `QueryInformationJobObject` readback; the
  enforcement evidence is behavioural, as #155 already states.
- The opt-in suite remains opt-in: the shipped binary may be absent, and on a
  host that denies the lifecycle directory the run is environment-blocked rather
  than green.
- No product lock, default value or release claim; `driven_by: agent`,
  `actor: codex`.
