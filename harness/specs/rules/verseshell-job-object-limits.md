---
id: verseshell-job-object-limits
title: VerseShell Job Object Resource Limit Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
pathPatterns:
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-exec.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts
---

Managed tool processes must be bounded by the executor's Job Object, not by a host-side kill list.
Send `max_memory_mb` and `max_processes` with the request; the executor fails closed when
`SetInformationJobObject` or `AssignProcessToJobObject` fails, so a started process means the limits
were configured on its Job.

A receipt must never claim more than was established. Say `enforcement: "job-object"` with
`evidence: "job-object-configured"` and `readback: "unavailable"` when the limit was accepted at
start, and keep `enforced: false` when the executor refused, when the command never ran (policy
denial, approval rejection) or when no limit was requested. Never report a false success for an
unsupported capability. `maxMemoryBytes` maps to the Windows **per-process commit** limit
(`JOB_OBJECT_LIMIT_PROCESS_MEMORY`) - not RSS, not a job-wide total - and `maxProcesses` maps to
`JOB_OBJECT_LIMIT_ACTIVE_PROCESS`, which counts the root process too. State both in the receipt.

Instance occupancy is separate from the per-tree limit: declare `OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES`
(or `configureManagedProcessCapacity`) so multiple sessions and background callers cannot each assume
they own the budget. Release the slot only after a terminal state was observed; an unknown state keeps
the slot occupied and visible rather than pretending the process exited. Count only processes this
runtime created and verified - never adopt, scan for or kill unknown PIDs (see #98/#99/#103).

No default limit is frozen: with nothing declared the boundary stays inert. CPU rate limiting is
phase 2 and requires real load evidence first. Do not claim AppContainer/Windows Sandbox isolation:
a Job Object is resource and lifetime control, not a security sandbox.

Verification must use the real qualified binary on a Windows host, with a bounded experiment (a small
cap and a payload at most about twice it), and label stub-only checks as stub verification.
