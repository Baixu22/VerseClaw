# Issue #155: Windows Job Object resource limits wired to the managed tool process boundary

- Date: 2026-10-11
- Issue: #155 (`[P1] Windows 受控工具进程：接通 Job 资源硬限额与真实生效回执`)
- driven_by: agent
- actor: codex
- Base: `origin/main = 8061e782c`

## What was already true (and what was missing)

The bundled executor is not missing Job Object support. The pinned upstream commit
(`c3983694407a9ddb23505e05fad4a9eae653b283` of `Baixu22/VerseShell`) plus the tracked
`uas-05-process-lifecycle.patch` already:

- create a Job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,
- apply `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` from `ExecLimits::max_processes`,
- apply `JOB_OBJECT_LIMIT_PROCESS_MEMORY` from `ExecLimits::max_memory_mb`,
- fail closed with `E_EXEC_JOB: SetInformationJobObject failed` /
  `AssignProcessToJobObject failed`,
- advertise `max_memory_mb` and `max_processes` (integer ≥ 1, `additionalProperties: false`) in both
  `exec.run` and `process.start`.

What was missing was on the host side: nothing sent those arguments, and the receipt said
`enforcement: "unsupported"` unconditionally. The seam added earlier (`GovernedProcessResourceLimits`
/ `GovernedProcessResourceReceipt`) was deliberately additive and honest, but unwired.

## What this change adds

1. **`governed-process.ts` (long-lived managed process)**
   - sends `max_memory_mb` (ceil of `maxMemoryBytes` / MiB, minimum 1) and `max_processes` in
     `process.start`,
   - reports a truthful receipt: `requested`, `applied`, `enforced`, `enforcement: "job-object"`,
     `evidence: "job-object-configured"`, `readback: "unavailable"`, the Windows semantics note and
     the instance occupancy,
   - releases the instance slot only after a terminal state was observed; an unknown state keeps the
     slot occupied instead of pretending the process exited.
2. **`governed-exec.ts` (one-shot exec boundary)** - same argument mapping for `exec.run`, and the
   result carries the same receipt. The receipt is attached **only when the command actually ran**
   (a policy denial or approval rejection must not claim a Job limit was applied).
3. **`managed-process-capacity.ts` (new)** - instance-wide live managed-process capacity so several
   sessions/lanes/background callers cannot each assume they own the whole budget. Opt-in:
   - `OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES` - live managed-process cap for the instance,
   - `OPENCLAW_VERSESHELL_MAX_PROCESSES` - default Job active-process cap per run,
   - `OPENCLAW_VERSESHELL_MAX_MEMORY_MB` - default Job per-process commit cap per run.
   With nothing declared the admission is a no-op and no counter is allocated. The counter only
   covers processes this runtime created and whose exit it verified; it never adopts or kills unknown
   PIDs (#98/#99/#103 stay authoritative).

## Real Windows evidence (qualified binary, stub-free)

`src/agents/verseshell/governed-exec.real-limits.test.ts` runs the shipped `ae.exe`
(`sha256 ac6a7a15…0786`, 14 879 232 bytes - byte-identical to
`resources/verseshell/manifest.json`) on this Windows host:

| Case | Observed |
|---|---|
| child spawn, no cap | `success=true`, `exitCode=0` |
| child spawn, `maxProcesses: 1` | `success=false`, `exitCode=9` (the child spawn was refused) |
| 256 MiB allocation, no cap | `success=true`, `exitCode=0` |
| 256 MiB allocation, `maxMemoryBytes: 512 MiB` | `success=true`, `exitCode=0` |
| 256 MiB allocation, `maxMemoryBytes: 64 MiB` | `success=false`, `exitCode=1`, `RangeError: Array buffer allocation failed` |

So the limits are **enforced**, not merely accepted, and the memory experiment is bounded (256 MiB,
twice the small cap) rather than an unbounded exhaustion test.

## Windows semantics that make the receipt honest

- `JOB_OBJECT_LIMIT_PROCESS_MEMORY` is a **per-process commit** limit, not RSS and not a job-wide
  total. A tree of N processes may each hold the cap.
- `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` counts processes inside the Job, including the root: a cap of 1
  means "the root only".
- `KILL_ON_JOB_CLOSE` ties survival to the Job handle; the executor drops the handle when the run
  ends, which is what makes timeout/kill cleanup of the whole tree work.
- The pinned executor exposes **no `QueryInformationJobObject` readback**, so `readback:
  "unavailable"` is literal: the receipt says "configured at start, fail-closed otherwise", and the
  evidence for actual enforcement is behavioural (the table above), not a kernel query.

## Long-lived `process.start` finding (resolved in #160)

This host originally failed the long-lived `process.start` boundary for **every** command with
`Access denied (os error 5)` - including requests carrying **no** limits. The cause was the
executor's first write inside the op (`fs::create_dir_all(<workspace>/.ae/process-lifecycle)`)
being denied under the host's restricted token, which surfaced as `E_PROCESS_INTERNAL`.

#160 pre-creates that directory from the host, so the op reaches its normal path. With the root
present, the opt-in suite runs and both Job Object limits are behaviourally enforced (child spawn
refused at `maxProcesses: 1`; a 256 MiB allocation fails under a 64 MiB per-process commit cap while
the same script succeeds uncapped). See
`docs/dev/p1-160-verseshell-process-start-20261012.md`.

Consequences now:

- the long-lived path's real-limit verification still runs behind
  `VERSESHELL_REAL_PROCESS_START_LIMITS=1` (`governed-process.real-limits.test.ts`) because the
  bundled binary may be absent, but it now passes when the binary is present and the host permits the
  lifecycle directory,
- the protocol wiring and receipts for that path remain unit-tested against the stubbed ACI client,
- CPU rate limiting stays out of scope, as the issue directs (phase 2, only with real load evidence).

## Tests

- `managed-process-capacity.test.ts` - declaration/no-op, cap refusal, release and counted double
  release, environment parsing, default limits.
- `governed-process.test.ts` - extended: limits are sent, the receipt records how enforcement was
  established, no limits means no enforcement claim, and a refusing executor fails closed.
- `governed-exec.real-limits.test.ts` - the real enforcement table above (skipped without `ae.exe`).
- `governed-process.real-limits.test.ts` - opt-in real run for the long-lived path (gated, see above).

## Residual, stated honestly

1. No kernel-level effective-limit readback exists; enforcement evidence is behavioural.
2. The `process.start` path is now behaviourally verified when the bundled binary is present and the
   host permits the lifecycle directory; a host that denies that write remains environment-blocked
   (see the #160 record).
3. No CPU rate limit, no AppContainer/Windows Sandbox claim, no whole-machine cleaner.
4. The agent-tool *exposure* of VerseShell process execution is unchanged by this change; limits are
   wired at the boundary and applied when an operator declares them.
5. No packaging, cross-platform, full-suite or release claim; `driven_by: agent`, no human evidence,
   no paid provider call.
