# Provider endpoint health (NET-C / TF-0440)

## Decision

Provider endpoint circuit breaking uses exactly one implementation: the existing
`RateCircuitBreaker` in `openclaw_runtime/src/agents/rate-circuit-breaker.ts`.
The generic `CircuitBreaker` in `openclaw_runtime/src/infra/circuit-breaker.ts`
remains available for non-provider call sites. No second provider breaker is
enabled.

The wiring lives in `openclaw_runtime/src/agents/provider-endpoint-health.ts` and
is invoked by the real outbound boundary, `buildGuardedModelFetch` in
`provider-transport-fetch.ts`. It runs after the provider outbound concurrency
budget admission and before the local provider sidecar starts, so:

- a budget refusal is not counted as an endpoint failure;
- an open breaker fails fast before any provider request is sent;
- the local-service sidecar is not started for a refused request.

## Identity

One breaker is kept per quota group:

```
normalized endpoint origin + non-exportable account discriminator
```

The discriminator is the same in-process, truncated SHA-256 account identity
already used by the provider outbound concurrency budget. It is never the
credential, never sent to a provider, never logged, never persisted, and never
exported in diagnostics. Different endpoints and different accounts do not share
breaker state.

## Counting policy

Counted as a failure:

- transport error (the guarded fetch rejects);
- timeout (surfaces as a transport error);
- HTTP 429;
- any HTTP 5xx.

Not counted as a failure:

- 2xx and 3xx responses;
- non-429 4xx responses (auth, format, billing and model-not-found outcomes are
  owned by auth cooldown / model fallback);
- auth cooldown decisions;
- model-fallback skips;
- provider outbound concurrency-budget refusals;
- mid-stream body failures (owned by stream-failure recovery, TF-0441).

A neutral outcome during a half-open probe closes the breaker, because a served
HTTP response proves the transport is reachable again.

## States and opt-in

The state machine is the existing `RateCircuitBreaker` contract:

- `closed`: requests admitted; failures accumulate in a rolling window;
- `open`: requests fail fast with `ProviderEndpointCircuitOpenError` until the
  cooldown elapses;
- `half-open`: exactly one probe is admitted; a clean probe closes the breaker,
  a failed probe re-opens it with a fresh cooldown.

The gate is **opt-in** and does not change any product default. Enable it with:

```
OPENCLAW_PROVIDER_ENDPOINT_BREAKER=1
```

which uses the fixture defaults `windowMs=30000`, `maxFailuresPerWindow=5`,
`cooldownMs=15000`. Explicit values use:

```
OPENCLAW_PROVIDER_ENDPOINT_BREAKER=<windowMs>:<maxFailuresPerWindow>:<cooldownMs>
```

Empty, `0`, `false`, `off`, `no` and unusable values leave the gate inert.

## Diagnostics

`diagnostics.stability` gains an optional `summary.providerEndpointHealth` array
when at least one breaker exists. Each entry contains only:

- endpoint;
- provider and API;
- breaker state;
- failures in window;
- trips;
- half-open probe in flight;
- opened-at timestamp.

It never contains the credential or the account discriminator. The block is
omitted while the gate is inert.

## Verification

Evidence is written to `artifacts/network-protocol-reliability/net-c/` with
`driven_by: agent`. Synthetic tests cover legal traffic, 429/503/transport
failures, open fail-fast without a provider request, half-open single probe,
successful recovery, account/endpoint isolation, export hygiene, and
non-double-counting against the concurrency budget. No paid provider request is
made and no live-provider conformance is claimed.

## Validation probe states (TF-0733)

The provider **validation** probe (Settings / Setup) is separate from runtime
endpoint health above. Since TF-0733 it reports a structured
`ProviderValidationResult`, not a single boolean:

| dimension | values | meaning |
|---|---|---|
| `reachable` | `reachable` / `unreachable` / `unknown` | did the endpoint answer at all |
| `auth` | `valid` / `invalid` / `unknown` | did it accept the credential |
| `protocol` | `compatible` / `incompatible` / `unknown` | did it accept the request shape |
| `model` | `available` / `unavailable` / `unknown` | is the probed/selected model usable |
| `rateLimited` (+ `retryAfterMs`) | boolean / number | HTTP 429 and its `Retry-After` |
| `ready` | boolean | the only surface the UI may render as verified |

Rules:

- HTTP 429 is **not** a pass. It sets `rateLimited=true`, `ready=false`, and is
  never treated as a credential success. `Retry-After` is parsed from seconds
  or an HTTP date into `retryAfterMs`.
- A non-auth 400 on the fallback chat/responses probe means the endpoint
  understood the credential but rejected the request shape: `protocol-error`.
  A model-shaped 400/404 is `model-unavailable`.
- `valid` remains for one release as a compatibility field with fixed
  semantics (`auth === 'valid' && protocol !== 'incompatible'`). It must not
  gate "Credentials verified"; that copy requires `ready === true`.
- Setup writes `metadata.validation.status='valid'` only after a model is
  confirmed, so leaving the wizard mid-way cannot leave a false-ready record.
