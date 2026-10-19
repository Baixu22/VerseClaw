# End-to-end deadline and cancellation (NET-E / TF-0442)

## Decision

One logical deadline crosses every layer of a chat turn; no layer starts a fresh
full timeout on top of the previous one.

| Layer | Owner | Behaviour |
|---|---|---|
| Renderer | `src/lib/host-api-client.ts` + `shared/host-api/host-deadline.ts` | Creates the deadline once per `invokeHost()` (absolute `deadlineAtMs`, granted budget, stage, local `requestId`), sends it as request metadata and derives its last-line fallback from the same budget plus a grace margin. |
| Main (host action) | `electron/main/ipc/host-invoke.ts`, `electron/utils/host-deadline-context.ts` | Enforces `min(local budget, remaining)`, fails closed before an expired deadline starts an action, returns `{stage, deadlineMs, elapsedMs, requestId, deadlineAtMs}` details, and exposes the deadline to nested Main-side work. |
| Main (gateway RPC) | `electron/gateway/manager.ts` | Clamps every RPC timeout to the ambient remaining budget, so an RPC started inside a host action cannot outlive the caller. |
| Main to Gateway | `electron/services/chat-api.ts` | Forwards `deadlineAtMs` with `chat.send` (validated by `ChatSendParamsSchema`). |
| Gateway | `openclaw_runtime/src/gateway/server-methods/chat.ts` | Gates the request (`resolveRequestDeadlineGate`): a spent deadline answers `AGENT_TIMEOUT` with structured details *before* any session/model work; a live one clamps the turn watchdog to the remaining budget and runs the whole dispatch under the ambient deadline. |
| Provider | `openclaw_runtime/src/agents/request-deadline.ts` + `provider-transport-fetch.ts` | `buildGuardedModelFetch` fails closed when the ambient deadline is spent and otherwise clamps the provider request timeout to what remains (never starts a fresh provider window). |

## Cancellation

- The renderer never reports a late success: its fallback fires from the same
  budget, and Main refuses to start an action whose deadline already expired.
- The gateway refuses to start a chat turn whose deadline is spent and clamps
  the turn watchdog otherwise, so the run (and its abort signal) end with the
  logical request.
- The provider request aborts at the deadline through the shared
  `AbortSignal`/timeout path; the outbound slot is still released only on a real
  end/cancel/error event.

## Timeout details

Timeout errors carry `stage`, `deadlineMs`, `elapsedMs` and the local
correlation id (`requestId`), plus `deadlineAtMs` when a deadline was
propagated. The provider request id stays a distinct field and is never reused
as the local correlation id.

## Boundaries

- No product-wide timeout default change: budgets still come from
  `host-action-timeouts.ts` (including the long-action allowlist) and the model's
  own `requestTimeoutMs`; the deadline only ever *tightens* them.
- Deadline propagation is implemented for the chat turn path
  (`chat.sendWithMedia` -> `chat.send`). Other gateway RPC methods and a packaged
  Electron end-to-end run are not claimed; those remain in the NET-G
  "unverified" list.
- No gateway protocol version bump: `deadlineAtMs` is an optional field, and a
  server that does not understand it simply behaves as before.

## Verification

Evidence: `artifacts/network-protocol-reliability/net-e/net-e-evidence.json`
(`driven_by: agent`). Coverage: the shared host primitive (remaining budget,
clamping without summation, expiry, metadata validation, structured details),
renderer propagation and fallback, Main clamp/fail-fast/long-action clamp/ambient
context, Main timeout detail preservation, `chat.send` schema acceptance,
gateway gate semantics (spent deadline fails closed with details), the runtime
ambient context and the provider request-timeout clamp plus provider fail-closed
behaviour. No paid provider request is made.