# Current source-proven gaps

- Node: `TF-0437` / `TF-0443`
- Baseline: `origin/main` @ `9cae5341ab0fa94a9b21bc3838107d804669bd4c`
- Evidence boundary: only gaps visible in the current source are listed. A gap is not an implementation claim and is not a substitute for the downstream node's acceptance evidence.
- Driven by: `agent`

## G1 — Two Gateway socket/protocol implementations

- Files: `openclaw_runtime/packages/gateway-client/src/client.ts`; `electron/gateway/ws-client.ts`; `electron/gateway/manager.ts`.
- Behaviour: the shared client owns protocol range validation, typed `retryable`/`retryAfterMs`, event `seq` gap detection and reconnect scheduling. The Electron client performs its own handshake with `GATEWAY_PROTOCOL_VERSION = 4`, its own challenge/connect timers and no equivalent `onGap` surface. `electron/gateway/manager.ts` stores pending RPCs and applies its own timeout.
- Boundary: Electron currently needs device identity, proxy and lifecycle adaptation; that adapter is valid. The gap is that protocol semantics can evolve independently.
- Owner decision: shared `@openclaw/gateway-client` is the protocol authority; Electron must become a one-way adapter.
- Downstream node: `TF-0439`.

## G2 — `RateCircuitBreaker` is not wired in production

- Files: `openclaw_runtime/src/agents/rate-circuit-breaker.ts`; `openclaw_runtime/src/agents/provider-transport-fetch.ts`.
- Behaviour: the real provider outbound boundary imports `provider-outbound-budget` and applies timeout/SSE handling, but does not import `RateCircuitBreaker`. Repository search finds only the breaker's own tests and `tests/unit/cross-layer-closed-loop.v01.test.ts`.
- Boundary: the class implements closed/open/half-open and one half-open probe, but no endpoint/account keying or transport error classification is applied at the real boundary.
- Owner decision: wire `RateCircuitBreaker` at `buildGuardedModelFetch`; do not enable a second provider breaker.
- Downstream node: `TF-0440`.

## G3 — Generic `CircuitBreaker` is also test-only

- Files: `openclaw_runtime/src/infra/circuit-breaker.ts`; `tests/unit/circuit-breaker.test.ts`.
- Behaviour: no production import was found. It is a useful generic primitive but overlaps the provider-specific breaker.
- Boundary: keep it for non-provider callers; it is not a provider authority and must not be wired alongside `RateCircuitBreaker`.
- Owner decision: retain non-provider-only.
- Downstream node: `TF-0440`.

## G4 — Retry amplification is structurally possible

- Files: `openclaw_runtime/src/infra/retry.ts`; `openclaw_runtime/src/infra/retry-policy.ts`; `openclaw_runtime/src/agents/sessions/agent-session.ts`; `openclaw_runtime/src/agents/failover-error.ts`; `openclaw_runtime/src/agents/provider-transport-fetch.ts`.
- Behaviour: `retryAsync` owns a bounded physical-attempt loop. `agent-session.ts` separately tracks `retryCount` and emits `auto_retry_start/end`. `failover-error.ts` carries fallback metadata and candidate semantics. The provider transport reads `Retry-After` and sets `x-should-retry: false` only for long waits, leaving shorter SDK retries active.
- Boundary: there is no single per-logical-request attempt budget shared across these layers; retries and fallback can multiply.
- Owner decision: `TF-0438` owns the budget; lower layers report physical attempts only.
- Downstream node: `TF-0438`.

## G5 — Provider outbound budget is an adapter, not a global scheduler

- Files: `openclaw_runtime/src/agents/provider-outbound-budget.ts`; `openclaw_runtime/src/agents/provider-transport-fetch.ts`.
- Behaviour: `buildGuardedModelFetch` resolves a quota group from normalized endpoint plus a non-exportable account discriminator and acquires a slot before the request. The module explicitly covers provider chat/subagent/cron transport only and excludes embedding/media/local sidecar paths.
- Boundary: this is the provider Account adapter for `TF-0399` ResourceFabric, not a new cross-resource scheduler.
- Owner decision: explicit one-way adapter.
- Downstream node: `TF-0438`, `TF-0440`.

## G6 — Gateway history backpressure is narrow but real

- Files: `electron/services/resource-fabric.ts`; `electron/main/ipc-handlers.ts`; `electron/services/gateway-api.ts`.
- Behaviour: only `chat.history` calls are coalesced by a stable params key and run through a bounded FIFO; other methods pass through.
- Boundary: this is not general admission and must not be expanded into one.
- Owner decision: retain narrow owner.
- Downstream node: `TF-0438`, `TF-0439`.

## G7 — Deadlines are independent timers

- Files: `shared/host-api/host-action-timeouts.ts`; `electron/main/ipc/host-invoke.ts`; `electron/gateway/manager.ts`; `openclaw_runtime/packages/gateway-client/src/client.ts`; `openclaw_runtime/src/agents/provider-transport-fetch.ts`.
- Behaviour: the Host dispatcher applies a 60s/15m action budget; the Electron Gateway manager defaults RPC to 30s; the shared Gateway client has a request timeout; the provider transport builds `AbortSignal.timeout` from the model timeout. Each layer can add its own full timeout.
- Boundary: no shared logical deadline object carries `stage`, `deadlineMs`, `elapsedMs` and remaining budget through the chain.
- Owner decision: `TF-0442` owns remaining-deadline propagation.
- Downstream node: `TF-0442`.

## G8 — Post-header stream failure has no typed recovery contract

- Files: `openclaw_runtime/src/agents/embedded-agent-runner/thinking.ts`; `openclaw_runtime/src/agents/failover-error.ts`; `openclaw_runtime/src/agents/sessions/agent-session.ts`.
- Behaviour: `thinking.ts` retries once without thinking blocks only before streaming begins; after streaming begins it explicitly logs "skipping retry to avoid duplicate chunks". The code does not expose a typed stream error with `code`/`status`/`isRetryable`, nor does it isolate failed-attempt tool effects before a retry.
- Boundary: skipping retry avoids duplicate chunks but does not define partial-output or failed-attempt-effect semantics.
- Owner decision: `TF-0441` owns typed stream failure and effect isolation.
- Downstream node: `TF-0441`.

## G9 — Attempt observability is model-call based, not per-physical-attempt

- Files: `openclaw_runtime/src/logging/diagnostic-run-activity.ts`; `openclaw_runtime/src/agents/provider-transport-fetch.ts`.
- Behaviour: diagnostic events include `model.call.started`, `model.call.completed` and `model.call.error`; provider transport carries `wireAttemptIndex` shadow metadata. There is no declared per-physical-attempt event with failure cost attribution.
- Boundary: reuse the existing model-call event surface; do not create a new trace exporter or usage store.
- Owner decision: extend the existing surface in `TF-0438`/`TF-0444`.
- Downstream node: `TF-0438`, `TF-0444`.

## G10 — Entrypoint checks can silently no-op through a junction

- Files: `scripts/lib/entrypoint.mjs`; 49 script files under `scripts/**` that still reference `process.argv[1]` in a main-entrypoint comparison.
- Behaviour: a path reached through `C:\Users\<example-user>\Desktop\clawx\ClawX` and the real `D:\ClawX` can disagree between `process.argv[1]` and `import.meta.url`. The helper realpath-resolves both sides. Current source has 36 direct comparisons and 13 `pathToFileURL` variants that do not use the helper.
- Boundary: the exact count is a source scan result, not a claim that every file was executed through a junction.
- Owner decision: all scripts import `isMainEntrypoint`; the guard rejects new direct comparisons.
- Downstream node: `TF-0443`.

## Explicit non-gaps / non-goals

- Network pooling and I/O shaping remain owned by `TF-0401` / `TF-0413` / `TF-0414`; this matrix does not duplicate them.
- Electron startup/rendering performance remains owned by `TF-0416`; it is not part of this reliability line.
- No product lock, default timeout, provider default or release scope is changed by this document.
- No live-provider conformance or human evidence is claimed.
