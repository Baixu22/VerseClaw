# Network, protocol and error reliability owner matrix

- Node: `TF-0437` / `TF-0443`
- Baseline: `origin/main` @ `9cae5341ab0fa94a9b21bc3838107d804669bd4c`
- Evidence boundary: this file is a source-backed ownership decision. It does not claim any implementation node has passed.
- Driven by: `agent`
- Scope: one primary owner per reliability concern. Later nodes may change behaviour, but they may not create a second independently evolving authority.

## Decision table

| Component / concern | Primary owner | Real call site(s) | Overlap | Disposition | Downstream node |
|---|---|---|---|---|---|
| Gateway protocol evolution | `openclaw_runtime/packages/gateway-client/src/client.ts` | `openclaw_runtime/src/gateway/client.ts`; `openclaw_runtime/src/gateway/client-bootstrap.ts`; Electron manager consumes its own socket today | Electron `electron/gateway/ws-client.ts` implements a separate handshake and protocol version | **Merge**: shared client owns protocol negotiation, typed request metadata and event sequence semantics; the Electron path must consume or be reduced to a one-way adapter. Retain the Electron adapter only until `TF-0439` lands. | `TF-0439` |
| Electron Gateway socket adapter | `electron/gateway/ws-client.ts` | `electron/gateway/manager.ts:34,1341`; `electron/gateway/supervisor.ts:10` | Shared `GatewayClient`; Electron manager also owns pending RPC and reconnect state | **Retain temporarily, then reduce**: this is not a protocol authority. It may adapt device auth, proxy and process lifecycle; it must not independently evolve protocol or event-gap semantics. | `TF-0439` |
| Provider endpoint circuit breaking | `openclaw_runtime/src/agents/rate-circuit-breaker.ts` | No production import; only `rate-circuit-breaker.test.ts` and `cross-layer-closed-loop.v01.test.ts` | `openclaw_runtime/src/infra/circuit-breaker.ts` is a generic breaker with no production caller | **Merge**: one provider breaker implementation, `RateCircuitBreaker`, wired at the provider outbound boundary. Generic `CircuitBreaker` stays available only for non-provider callers; it is not enabled as a second provider authority. | `TF-0440` |
| Generic circuit breaker | `openclaw_runtime/src/infra/circuit-breaker.ts` | No production import; only unit tests | `RateCircuitBreaker` | **Retain for non-provider use**, not wired into provider transport. | `TF-0440` |
| Provider outbound concurrency admission | `openclaw_runtime/src/agents/provider-outbound-budget.ts` | `openclaw_runtime/src/agents/provider-transport-fetch.ts:44-47,801,976` | `TF-0399` ResourceFabric Account/QoS scope; `GatewayRpcBackpressure` is a different Gateway-side queue | **Explicit one-way adapter**: provider budget remains the provider-specific account adapter; ResourceFabric owns cross-resource admission. Do not add a second scheduler. | `TF-0438`, `TF-0440` |
| Gateway history backpressure | `electron/services/resource-fabric.ts` | `electron/main/ipc-handlers.ts:45,117`; `electron/services/gateway-api.ts:99-111,347` | ResourceFabric admission; provider budget | **Retain**: owns only `chat.history` duplicate coalescing and bounded FIFO. It must not grow into a general scheduler. | `TF-0438`, `TF-0439` |
| Generic retry runner | `openclaw_runtime/src/infra/retry.ts` | `openclaw_runtime/src/infra/retry-policy.ts`; `openclaw_runtime/src/agents/compaction.ts`; `openclaw_runtime/src/media/fetch.ts` | Agent auto-retry; SDK retries; model fallback | **Retain as the single physical-attempt executor**, but it must receive a per-logical-request attempt budget and must not create its own outer retry chain for provider calls. | `TF-0438` |
| Agent auto-retry | `openclaw_runtime/src/agents/sessions/agent-session.ts` | `retryCount`, `retryAbortController`, `auto_retry_start/end` around lines 378-379, 692-720, 2751-2806 | `retryAsync`; model fallback; SDK retries | **Merge into the logical-request budget**: one owner accounts for attempts; agent auto-retry may request another attempt but cannot independently multiply the budget. | `TF-0438` |
| Model fallback | `openclaw_runtime/src/agents/failover-error.ts` and the embedded agent runner's candidate selection | Failover error classification and candidate-slot comments around lines 324-336; runner candidate execution | Agent auto-retry; SDK retries | **Explicit one-way dependency**: fallback consumes the logical attempt budget and records the chosen candidate; it does not own retry timing. | `TF-0438` |
| Provider SDK retry hints | `openclaw_runtime/src/agents/provider-transport-fetch.ts` | `parseRetryAfterSeconds` around 443-479; `shouldBypassLongSdkRetry` around 546-560; `x-should-retry` around 1040-1042 | `retryAsync`; agent auto-retry | **Merge**: normalize Retry-After into the logical budget and disable unbounded lower-layer retry when the outer budget owns the attempt chain. | `TF-0438` |
| Host action deadline | `shared/host-api/host-action-timeouts.ts` | `electron/main/ipc/host-invoke.ts:17,31-42,267-278`; renderer host client fallback | Gateway request timeout; provider request timeout | **Retain as the Host boundary budget**, then make it a child of the logical deadline rather than an independent additive timeout. | `TF-0442` |
| Gateway request timeout | `openclaw_runtime/packages/gateway-client/src/client.ts` | `requestTimeoutMs` option and per-request timer around 309-321, 1522-1543; Electron `manager.ts:1074-1090` has its own timer | Host action timeout; provider timeout | **Merge into remaining-deadline propagation**; the Gateway receives remaining budget, not another full timeout. | `TF-0442` |
| Provider request timeout | `openclaw_runtime/src/agents/provider-transport-fetch.ts` | `resolveModelRequestTimeoutMs` around 669-680; `buildModelRequestSignal` around 685-695; guarded fetch around 944-956 | Host and Gateway timers | **Merge into remaining-deadline propagation**; keep the abort signal and outbound slot release tied to physical completion. | `TF-0442` |
| Attempt observability | Existing `model.call.started/completed/error` diagnostic events and usage/cost records | `openclaw_runtime/src/logging/diagnostic-run-activity.ts`; `provider-transport-fetch.ts` wire-attempt shadow fields around 801-935 | No second exporter is justified | **Retain existing model-call event surface**; add a physical-attempt identifier/usage attribution only through that surface. Do not create a second usage store or trace exporter. | `TF-0438`, `TF-0444` |
| Stream failure semantics | `openclaw_runtime/src/agents/embedded-agent-runner/thinking.ts` and the existing failover error path | `retryStreamWithoutThinking` around 595-634; post-stream skip-retry branches around 627-658; failover error types in `failover-error.ts` | Agent auto-retry; model fallback | **Retain as the stream-attempt owner**; add typed stream failure and isolate failed-attempt effects before any retry. | `TF-0441` |
| Script main-entrypoint detection | `scripts/lib/entrypoint.mjs` (`isMainEntrypoint`) | Imported by 27 scripts today; the helper realpath-resolves both sides | 49 script files still compare `argv[1]` with `import.meta.url` directly (36 direct comparisons, 13 `pathToFileURL` variants) | **Merge**: all scripts use the helper. No script may implement its own junction-sensitive comparison. | `TF-0443` |

## Frozen invariants

1. **One logical request has one attempt budget.** `retryAsync`, agent auto-retry, model fallback and SDK retry hints may consume or report attempts, but only `TF-0438` owns the budget.
2. **One Gateway protocol authority.** The shared `@openclaw/gateway-client` owns negotiation, typed request errors and sequence-gap semantics. The Electron socket may adapt lifecycle concerns only.
3. **One provider breaker.** `RateCircuitBreaker` is the provider breaker; the generic `CircuitBreaker` remains non-provider-only.
4. **One outbound scheduler per concern.** Provider account admission stays in `provider-outbound-budget`; Gateway history coalescing stays in `GatewayRpcBackpressure`; neither becomes a global scheduler.
5. **One deadline chain.** Host, Gateway and provider enforce the remaining budget; they do not add independent full timeouts.
6. **One stream-attempt owner.** `thinking.ts`/failover semantics own post-header failure handling; no lower layer replays tool effects.
7. **One entrypoint helper.** `scripts/lib/entrypoint.mjs` is the only main-entrypoint comparison.
8. **No evidence inflation.** This matrix is an ownership decision; implementation and fault-injection proof remain in `TF-0438`–`TF-0444`.

## Evidence read

- Gateway: `openclaw_runtime/packages/gateway-client/src/client.ts` (protocol/seq/typed errors); `electron/gateway/ws-client.ts` (independent handshake); `electron/gateway/manager.ts` (socket consumer and RPC timer).
- Breakers: `openclaw_runtime/src/agents/rate-circuit-breaker.ts`; `openclaw_runtime/src/infra/circuit-breaker.ts`; test-only imports confirmed with repository search.
- Retry: `openclaw_runtime/src/infra/retry.ts`; `retry-policy.ts`; `agent-session.ts`; `failover-error.ts`; `provider-transport-fetch.ts`.
- Admission: `provider-outbound-budget.ts`; `provider-transport-fetch.ts`; `electron/services/resource-fabric.ts`; `gateway-api.ts`.
- Timeouts: `shared/host-api/host-action-timeouts.ts`; `host-invoke.ts`; Gateway client; provider transport.
- Observability: `diagnostic-run-activity.ts` and provider wire-attempt shadow fields.
- Stream: `thinking.ts` and `failover-error.ts`.
- Entrypoint: `scripts/lib/entrypoint.mjs` plus a repository scan of `scripts/**/*.{mjs,js,ts,cjs}`.
