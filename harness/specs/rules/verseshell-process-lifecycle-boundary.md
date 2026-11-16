---
id: verseshell-process-lifecycle-boundary
title: VerseShell Process Lifecycle Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

# VerseShell Process Lifecycle Boundary

## Authority

- OpenClaw owns command interpretation, risk classification, allowlist, approval, sanitized
  environment construction, and the stable model-facing `exec` / `process` tools.
- In governed lifecycle mode, VerseShell owns payload process creation, stdin/PTY, output capture,
  timeout, cancellation, process-tree cleanup, retained exit records, artifacts, and lifecycle audit.
- Electron owns verification of the bundled executable, protocol, catalog, kill switch, and startup
  configuration. No renderer transport or direct Gateway call is added.

## State And Identity

- The process-manager state machine is `starting -> handshaking -> ready -> backoff | stopped | failed`;
  the payload lifecycle remains `planned -> starting -> running -> exited | killed | lost`.
- A failed start is terminal and must not publish a running id.
- A lifecycle id is bound to one runtime instance, canonical workspace, agent id, and session id.
  Operations with a mismatched owner fail closed.
- Restart or transport failure never replays `process.start`. Reconciliation observes retained
  durable metadata and reports `running`, `exited`, `killed`, or `lost` explicitly.
- Every transport request carries a host-owned request id, trace id, absolute deadline and process key.
  Callers cannot override those fields from operation args or inherited environment. A response with
  an unknown id, mismatched operation, expired deadline, or mismatched process context is a protocol
  failure and terminates the current transport.

## Input And Output

- Approved normalized argv, cwd, environment, PATH/PATHEXT resolution, stdin mode, PTY request,
  timeout, and output bounds are immutable start inputs. VerseShell must not reinterpret the
  approved command through an implicit native shell.
- `.cmd` and `.bat` may use an explicit Windows command interpreter as the governed payload
  implementation; the interpreter and resolved script identity must be auditable.
- Output reads use a monotonically increasing byte cursor. Responses include the next cursor,
  retained start cursor, truncation/loss metadata, process state, and artifact lineage.
- Output and retained exit records are bounded. Silent truncation, cursor rewind, duplicated
  delivery, and unbounded in-memory logs are forbidden.

## Cancellation And Cleanup

- Concurrent acquisition of the same executor identity shares binary resolution, spawn and
  handshake. An executor that is still starting consumes the instance process capacity, and
  no client is published until the shared handshake succeeds.
- Manager, workspace, process shutdown and the operator kill switch fence pending acquisitions.
  Resolver or handshake completion after that fence must not create or publish another executor.
  Concurrent shutdown callers wait for the same owned cleanup operation.
- A managed payload reservation is returned when executor acquisition fails before start dispatch
  or the executor explicitly rejects start. Uncertain effectful delivery or an unverified running
  exit keeps its reservation until the existing owner establishes a terminal state.

- Agent abort terminates a foreground process tree. Abort after an intentional background/yield
  detaches only the tool call.
- Timeout and explicit kill terminate the full VerseShell-owned process tree and converge on a
  terminal state. Repeated kill is idempotent.
- Shutdown may mark an unrecoverable running record `lost`; it must not silently orphan, adopt, or
  recreate the payload.

## Retry And Diagnostics

- Only explicitly classified read-only, idempotent requests may use a bounded retry after transport
  restart. `process.start`, `process.write`, `process.kill`, writes, and unknown operations are never
  replayed when delivery is uncertain.
- Timeout, abort, exit, handshake, protocol, backoff exhaustion and kill-switch failures expose stable
  error codes with bounded metadata: request id, trace id, process key, lifecycle stage, deadline,
  exit code/signal and restart attempt. Raw stderr, command text, approval tokens and unbounded output
  are redacted or retained only behind an artifact handle.
- An operator kill switch rejects new work, terminates in-flight work and prevents restart. It never
  transfers execution to native shell, MCP, legacy eval or another owner.

## Rollout Locks

- Governed lifecycle mode remains behind the existing verified-runtime, typed-ACI, facade, and
  governed-exec opt-in gates. There is no implicit native fallback.
- Do not expose lifecycle operations or the full VerseShell catalog as new model tools.
- Do not describe workspace jail as an OS filesystem sandbox.
- Do not change `liveReady`, `productApproved`, `defaultOn`, C1 keep-off, `TF-0006`, `TF-0009`,
  TF-0017 through TF-0019, Runtime Memory diagnostics-only, or SEKB auto-writeback policy.
