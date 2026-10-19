# Network Protocol Reliability - status

- Baseline: `origin/main` @ `9cae5341`
- Branch: `codex/network-protocol-reliability-20261019`
- As of: 2026-10-19 (Asia/Shanghai)
- Driven by: agent

## Node state

| Node | Status | Evidence boundary |
|---|---|---|
| TF-0437 | in_progress (~90%) | Phase gate frozen; TF-0443/0438/0439/0440/0441 done; NET-E/F/G (0442/0444) open |
| TF-0443 | done | Owner matrix, gap inventory, entrypoint guard and junction regression verified |
| TF-0438 | done | Shared logical request attempt budget across auto-retry, fallback, retryAsync and provider transport |
| TF-0439 | done | Gateway protocol range + negotiated hello validation, typed seq gap, reconnect resubscribe, explicit pending-RPC failure |
| TF-0440 | done | Provider endpoint breaker wired at the real transport boundary; opt-in, endpoint+account scoped, sanitized diagnostics |
| TF-0441 | done | Typed stream failure, failed-attempt isolation, responses post-header failure fixed |
| TF-0442 | proposed | Not started |
| TF-0444 | proposed | Not started |

## TF-0443 completed

- `docs/dev/network-protocol-reliability/owner-matrix.md`: 14 owner/disposition rows.
- `docs/dev/network-protocol-reliability/current-gaps.md`: 10 source-proven gaps.
- `shared/network-protocol-reliability-owners.json`: machine-readable owner registry.
- `tests/unit/network-protocol-owner-matrix.test.ts`: 9/9 passing, including a real junction regression.
- `scripts/**`: all main-entrypoint checks route through `scripts/lib/entrypoint.mjs`; `process.argv[1]` remains only inside the helper.
- Gates: `pnpm exec vitest run tests/unit/network-protocol-owner-matrix.test.ts --maxWorkers=1` exit 0; `pnpm run typecheck` exit 0; `pnpm harness validate --spec harness/specs/tasks/network-protocol-reliability-owner-matrix.md` exit 0.
- Evidence: `artifacts/network-protocol-reliability/net-root/net-root-evidence.json` (`driven_by: agent`, candidate `9cae5341`).

## TF-0438 completed

- `openclaw_runtime/src/agents/request-attempt-budget.ts`: one logical-request budget with `AsyncLocalStorage` ambient context.
- `openclaw_runtime/src/infra/retry.ts`: shared attempt-budget consumption with fail-closed exhaustion.
- `openclaw_runtime/src/agents/sessions/agent-session.ts`: turn-scoped budget, auto-retry consumption, Retry-After lower bound plus positive-only jitter.
- `openclaw_runtime/src/agents/model-fallback.ts` + `provider-transport-fetch.ts`: candidate and physical attempts draw from the same budget.
- Gates: 11 + 26 + 48 focused tests passed; `pnpm run typecheck` exit 0; `pnpm harness validate --spec harness/specs/tasks/network-retry-budget-v1.md` exit 0.
- Evidence: `artifacts/network-protocol-reliability/net-a/net-a-evidence.json` (SHA256 `5C5F4AF951C630DB848E13A555C1146C1B9DE0DE0DF326DB8EBB6FB3BEB8F473`).

## TF-0439 completed

- `electron/gateway/ws-client.ts`: protocol range from the shared `gateway-protocol` version module; negotiated hello protocol validated (unsupported values rejected); typed `onSequenceGap` and `onReconnect` callbacks.
- `electron/gateway/manager.ts`: `isReconnect` flag; typed `gateway:sequence-gap` and `gateway:resubscribe` events; pending RPCs rejected on socket close with `Gateway connection closed`.
- `electron/services/observability-api.ts`: listens to `gateway:resubscribe`, clears the stale binding, re-subscribes without unsubscribing on a dead socket. Rewritten with LF line endings; final diff is 16 insertions / 2 deletions.
- `tests/unit/gateway-ws-client.test.ts` (+ seq gap / reconnect / unsupported protocol), `tests/unit/observability-trajectory-projection.test.ts` (+ typed resubscribe).
- Gates (re-verified after the line-ending normalization): `pnpm exec vitest run tests/unit/gateway-ws-client.test.ts tests/unit/gateway-events.test.ts --maxWorkers=1` exit 0 (33 tests); `pnpm exec vitest run tests/unit/observability-trajectory-projection.test.ts --maxWorkers=1` exit 0 (7 tests); `pnpm run typecheck` exit 0; `pnpm run build:vite` exit 0; `pnpm harness validate --spec harness/specs/tasks/gateway-client-single-owner-v1.md` exit 0.
- Renderer boundary: `rg` over `src/**/*.{ts,tsx}` finds 0 direct WebSocket endpoints; renderer still uses the Main-owned transport policy.
- Evidence: `artifacts/network-protocol-reliability/net-b/net-b-evidence.json` (SHA256 `44A9345A9D7ECED752575B51A3ECB7BFE510BA147E35BDD8DBC7DD424CF72257`).

## TF-0440 completed

- `openclaw_runtime/src/agents/provider-endpoint-health.ts`: one `RateCircuitBreaker` per normalized endpoint + non-exportable account discriminator; opt-in `OPENCLAW_PROVIDER_ENDPOINT_BREAKER`; typed `ProviderEndpointCircuitOpenError`; single half-open probe.
- `openclaw_runtime/src/agents/provider-transport-fetch.ts`: health gate runs at the real outbound boundary after concurrency-budget admission and before local-service startup; transport errors, timeouts, 429 and 5xx count, while non-429 4xx, auth cooldown, fallback skips and budget refusals do not.
- `openclaw_runtime/src/logging/diagnostic-stability.ts`: optional `summary.providerEndpointHealth` snapshots in `diagnostics.stability`, omitted while inert and never containing credentials or account discriminators.
- Gates: 31 focused endpoint/budget tests, 2 diagnostics tests and 48 provider retry-boundary tests passed; `pnpm run typecheck` exit 0; `pnpm harness validate --spec harness/specs/tasks/provider-endpoint-circuit-breaker-v1.md` exit 0.
- Evidence: `artifacts/network-protocol-reliability/net-c/net-c-evidence.json` (SHA256 `939D739D6FABB453808D90BE2D4CCA900AB06A689E3A30ABEA71C71311495432`).

## TF-0441 completed

- `openclaw_runtime/src/agents/stream-failure.ts`: typed `StreamFailureError` (code/reason/isRetryable/phase/partialOutput/status), abort-safe wrapper, `planFailedAttemptRetry()` (discard + same-logical-step-only) and the failed-attempt transcript projection.
- `openclaw_runtime/src/agents/embedded-agent-runner/thinking.ts`: mid-stream pump classifies non-abort failures with phase and delivered-output flags.
- `openclaw_runtime/src/agents/sessions/agent-session.ts`: an error assistant message persists without its unexecuted tool calls, so a failed attempt cannot enter the formal transcript as replayable tool work.
- `openclaw_runtime/src/gateway/openresponses-http.ts`: post-header failure closes with a single `response.failed` envelope; the fabricated empty usage that allowed a trailing `response.completed` was removed.
- Gates: 20 provider error HTTP boundary tests (incl. 4 new mid-stream/disconnect cases), 13 stream-failure unit tests, 117 sessions tests, 25 responses usage/tool-history tests, `pnpm run typecheck` exit 0, `pnpm run comms:replay` / `comms:compare` exit 0 (all metrics PASS), `pnpm harness validate --spec harness/specs/tasks/stream-failure-recovery-v1.md --since bbd15fed` exit 0.
- Evidence: `artifacts/network-protocol-reliability/net-d/net-d-evidence.json` (SHA256 `C7986449989509441400529CF2BDEA7118607E95B67D7CC16054AFD9AF90B32E`).

## Remaining before TF-0437 can close

- `TF-0442`: end-to-end deadline and cancellation propagation.
- `TF-0444`: independent fault-injection acceptance.

## Boundaries

- No live-provider or human evidence is claimed.
- Network pooling remains `TF-0413`/`TF-0414`.
- Electron startup performance remains `TF-0416`.
- No product default, product lock or release scope changed.
