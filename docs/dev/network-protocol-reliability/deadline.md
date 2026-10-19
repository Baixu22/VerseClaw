# End-to-end deadline and cancellation (NET-E / TF-0442)

## Decision

A host action now carries ONE logical deadline instead of every layer applying
its own full timeout:

- `shared/host-api/host-deadline.ts` owns the primitive: an absolute
  `deadlineAtMs`, the granted `timeoutMs`, the creating `stage`, the local
  `requestId`, plus `remainingHostBudgetMs()`,
  `clampHostTimeoutToDeadline()`, `readHostDeadline()` and
  `toHostTimeoutDetails()`.
- The renderer creates the deadline once per `invokeHost()` call and sends it as
  request metadata. Its own last-line fallback is derived from the same budget
  (remaining logical budget + grace margin), so it is a grace period, not a
  second timeout window.
- The Main dispatcher reads the deadline and enforces
  `min(local budget, remaining)`. A whitelisted long action keeps its long
  budget only while the caller deadline allows it; an already-expired deadline
  fails closed before the action starts. Timeouts carry
  `{stage, deadlineMs, elapsedMs, requestId, deadlineAtMs}` in the response
  details, which the renderer already preserves through `AppError`.
- `electron/utils/host-deadline-context.ts` exposes the clamped deadline to
  nested Main-side work through `AsyncLocalStorage`, and
  `GatewayManager.rpc()` clamps every RPC timeout to that remaining budget, so a
  gateway RPC started inside a host action cannot outlive the caller's budget.

## Cancellation

- The renderer never reports a late success for an expired deadline: the client
  races the bridge with the budget-derived fallback, and the Main dispatcher
  refuses to start an action whose deadline already expired.
- The gateway RPC path rejects the pending request when its clamped timer fires
  and the pending-RPC store is settled exactly once.
- The provider leg keeps the existing cancellation contract: the guarded model
  fetch combines the caller `AbortSignal` with the provider timeout
  (`buildModelRequestSignal`) and the outbound slot is released only on a real
  end/cancel/error event.

## Boundaries

- No product-wide timeout default change: budgets still come from
  `host-action-timeouts.ts`, including the long-action allowlist.
- The deadline travels as host-request metadata. It is not a gateway wire
  protocol field, so a *gateway-side* absolute deadline is not claimed here;
  what is enforced is that no Main-side gateway RPC outlives the renderer's
  logical budget.
- Provider request ids stay distinct from the local correlation id; the timeout
  details only carry the local `requestId`.

## Verification

Evidence: `artifacts/network-protocol-reliability/net-e/net-e-evidence.json`
(`driven_by: agent`). Synthetic unit tests cover the shared primitive
(remaining budget, clamping without summation, expiry, metadata validation,
structured details), the renderer deadline propagation and fallback, the Main
dispatcher clamp/fail-fast/long-action clamp/ambient context, and Main timeout
detail preservation in the renderer. No paid provider request and no live
four-layer E2E run is claimed; independent fault injection remains TF-0444.
