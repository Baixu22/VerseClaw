# Deferred Windows runtime capability index (issue #168)

- Date: 2026-10-12
- Issue: #168
- driven_by: agent
- actor: codex
- Verified base: `origin/main = 9b94a2377`
- Status: deferred index. This is not an implementation plan or an authorization
  to change defaults.

## How to use this index

Use this page when auditing the Windows runtime boundaries. The three items
below are already declared out of scope or phase 2 by their owning documents.
Do not reopen them merely because evidence is absent; reopen only when the
listed trigger is observed and attach the trigger evidence to the follow-up.

No default-on change, OS sandbox expansion, or product-lock change follows from
this index.

## A. Job-object kernel readback is unavailable

Current source coordinates:

- `openclaw_runtime/src/agents/verseshell/governed-exec.ts`: the one-shot
  resource receipt type and write path explicitly use `readback: "unavailable"`
  and name the missing `QueryInformationJobObject` readback.
- `openclaw_runtime/src/agents/verseshell/governed-process.ts`: the long-lived
  process receipt repeats the same boundary.
- `docs/dev/p1-155-windows-job-limits-20261011.md`: the Windows semantics note
  and residual section state that limits are configured at start/fail-closed,
  while enforcement evidence is behavioural, not a kernel query.
- Real-limit tests assert the behavioural cases: child spawn refused at
  `maxProcesses: 1`, and a 256 MiB allocation fails under a 64 MiB
  per-process commit cap.

Trigger to reopen:

- A third party needs proof that the requested limit equals the effective
  kernel limit, or a production incident suggests a configured limit did not
  take effect.

Required direction when reopened:

- The native executor should expose a read-only
  `QueryInformationJobObject`-based readback for the relevant basic/extended
  limit information; TypeScript should consume that value and never fabricate
  or infer a kernel readback.

## B. CPU rate limiting remains phase 2

Current source coordinates:

- `docs/dev/p1-155-windows-job-limits-20261011.md` states that CPU rate
  limiting stays out of scope and requires real load evidence.
- The current Job-object receipt and tests cover memory/active-process limits;
  they do not claim CPU rate control.

Trigger to reopen:

- Reproducible CPU contention evidence, for example multiple subagents in one
  workspace saturating the host or a measured load regression attributable to
  missing CPU throttling.

Required direction when reopened:

- Measure before limiting and share the evidence path with #157. Do not select or
  change a default CPU policy before the before/after load evidence exists.

## C. FD/handle and long-window RSS measurement are not per-change gates

Current source coordinates:

- `harness/specs/tasks/session-ecosystem-resource-reclamation.md` contains the
  TF-0092 formal decision: FD/handle leak measurement has no portable Node API
  and is out of scope; long-horizon RSS growth is a soak concern, not a
  per-change gate.
- `electron/services/efficiency-sampler.ts` retains a bounded rolling window
  (`maxSamples`, default 720 = 1 hour at 5-second cadence). It is a short
  observational probe today, not a long-running soak record.

Trigger to reopen:

- Production evidence of an FD/handle leak, or a monotonic RSS growth trend
  across a long observation window.

Required direction when reopened:

- Use an agent-driven long-window sampler and record duration, sample count and
  RSS trend. Zero samples or insufficient coverage must fail closed. Keep it
  outside the per-PR gate unless separate evidence proves the gate is
  reliable and cheap.

## Verification coordinates

```powershell
rg -n "QueryInformationJobObject|readback" openclaw_runtime/src/agents/verseshell
rg -n "CPU rate limiting|No CPU rate limit|Readback" docs/dev/p1-155-windows-job-limits-20261011.md
rg -n "Measurement bounds|File-descriptor|RSS-level" harness/specs/tasks/session-ecosystem-resource-reclamation.md
rg -n "DEFAULT_MAX_SAMPLES|720" electron/services/efficiency-sampler.ts
```

## Boundary

- #168 is handled as a documentation/index closeout, not as authorization to
  implement A/B/C.
- No product source, runtime behavior, host-api contract, permission default,
  product lock or frozen default changed.
- Verification is agent-driven; no human verdict or human data is claimed.