# Stream failure and recovery semantics (NET-D / TF-0441)

## Decision

Post-header stream failures get a typed, honest surface instead of being
flattened into a generic error:

- `openclaw_runtime/src/agents/stream-failure.ts` owns the classification:
  `StreamFailureError` exposes `code`, `reason` (an existing `FailoverReason`),
  `isRetryable`, `phase` (`before_headers` / `after_headers`), `partialOutput`
  and the original `status`.
- `openclaw_runtime/src/agents/embedded-agent-runner/thinking.ts` classifies
  every non-abort mid-stream failure on the recovery pump, so callers can tell
  "failed before any output" from "failed after partial output". Abort and
  disconnect errors keep their original identity so abort handling is
  unchanged.
- `openclaw_runtime/src/agents/sessions/agent-session.ts` writes a failed
  attempt's assistant message to the transcript through
  `sanitizeFailedAttemptTranscriptMessage()`, which drops `toolCall`,
  `tool_use` and `function_call` blocks whenever `stopReason === "error"`.
  Text and thinking blocks stay, so the transcript still shows what failed.

## Classification

| Input | code | reason | retryable |
|---|---|---|---|
| abort / disconnect | `aborted` | `unknown` | no |
| transport error codes (`ECONNRESET`, `EPIPE`, `socket hang up`, ...) | `transport` | `timeout` | yes |
| timeout message | `timeout` | `timeout` | yes |
| HTTP 429 | `rate_limit` | `rate_limit` | yes |
| HTTP 529 / "overloaded" | `overloaded` | `overloaded` | yes |
| other HTTP 5xx | `server_error` | `server_error` | yes |
| HTTP 401/403 | `auth` | `auth` | no |
| HTTP 402 | `billing` | `billing` | no |
| HTTP 400/422 | `format` | `format` | no |
| anything else | `unknown` | `unknown` | no |

Transport error codes map onto `timeout` because that is what the shared
`classifyFailoverSignal()` classifier already does for the same codes.

## Failed-attempt isolation

`planFailedAttemptRetry()` expresses the only safe recovery shape:

- the failed attempt is always `discarded`;
- a retry is allowed only when the attempt delivered no output and produced no
  tool calls, approvals or client tool executions;
- blocked retries report `partial-output`, `tool-effects` or `not-retryable`;
- retries restart the same logical step only (`sameLogicalStepOnly: true`).

Tool calls from a failed attempt are never executed by construction: the
embedded runner executes tools through `runToolLifecycle()` only after an
assistant message completes. The transcript projection above covers the other
half of the requirement - a failed attempt cannot plant orphaned tool calls or
approvals that a later replay would try to resurrect.

## User-visible semantics

- `/v1/chat/completions`: a post-header failure keeps the existing error
  envelope (`{message, type}`), never emits `finish_reason: "stop"` and never
  fabricates a usage chunk. Partial deltas that were already sent stay visible;
  the error event is the explicit "this answer is incomplete" signal.
- `/v1/responses`: a post-header failure now closes the stream with a single
  `response.failed` envelope. Before TF-0441 the lifecycle-end path could still
  emit `response.completed` (with `status: "failed"`) after the failure and it
  forced `finalUsage` to zeros; both are fixed. `finalUsage` stays unset unless
  the attempt actually reported usage.

## Boundaries

- No unconditional replay and no claim of arbitrary stream resume.
- The wire-level error envelope is unchanged; the typed classification is an
  internal contract used for retry decisions and evidence.
- Zero usage in a `response.failed` envelope remains only because the Responses
  schema requires the field; no *completed* envelope is fabricated for a failed
  stream.

## Verification

Evidence: `artifacts/network-protocol-reliability/net-d/net-d-evidence.json`
(`driven_by: agent`). Synthetic loopback HTTP tests cover mid-stream failure
with partial text, no fabricated stop/usage, terminal `response.failed` without
a trailing `response.completed`, and client disconnect. Unit tests cover the
classification table, discard/retry planning and transcript isolation. No paid
provider request and no live-provider conformance is claimed.
