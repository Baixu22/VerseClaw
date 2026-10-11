# Issue #154 second half: shared outbound model concurrency budget

- Date: 2026-10-11
- Issue: #154 (`[P1] 完善运行时过载保护：有界 lane 排队与出站模型端点共享并发额度`)
- driven_by: agent
- actor: codex
- Base: `origin/main = 785d3842c` (the P1 candidate merge that landed the bounded-lane half)

## What was already landed

`openclaw_runtime/src/process/command-queue.ts` gained `maxQueueSize`, `queueDeadlineMs` and
`signal` with `CommandLaneOverloadedError` / `CommandLaneQueueTimeoutError` /
`CommandLaneQueueAbortedError`. That is the **bounded lane queue** half: it bounds how many
agent turns wait for a lane slot. It does not bound physical provider requests.

## What this change adds

Two modules and one wiring point:

1. `openclaw_runtime/src/infra/bounded-concurrency.ts` — a bounded concurrency gate with an
   explicit queue contract: immediate admission up to `maxConcurrent`, `overloaded` refusal
   before any wait when the queue is full, `queue-timeout` for a queued waiter past its
   deadline, `aborted` for a caller signal, FIFO hand-off of a freed slot, a single-release
   lease whose second release is *counted* (`doubleRelease`) instead of freeing a second slot,
   `close()` for shutdown, and full counters (active/queued/peaks/admitted/completed/rejections/
   wait totals). The clock is injectable.
2. `openclaw_runtime/src/agents/provider-outbound-budget.ts` — quota groups derived from the
   normalized `baseUrl` origin plus an account discriminator, a process-wide registry of gates,
   the environment configuration surface, an explicit alias mapping, the coverage table, and a
   typed `ProviderOutboundOverloadedError`.
3. `openclaw_runtime/src/agents/provider-transport-fetch.ts` — `buildGuardedModelFetch` now
   requests admission **before** the local provider sidecar starts and before
   `fetchWithSsrFGuard`, and binds the slot to the guarded request's own release path.

Why this is the right boundary: every chat/subagent/cron model transport
(`openai-transport-stream.ts`, `anthropic-transport-stream.ts`, `extensions/google/transport-stream.ts`)
and the auxiliary callers (`google-prompt-cache.ts`, `stage1-golden-run.ts`) construct their fetch
through `buildGuardedModelFetch`, so one choke point covers them all without touching each transport.

## Quota identity

```
groupId = <normalized endpoint origin>#<account discriminator>
account  = provider-default:<provider>                       (no auth override)
         | <auth mode>:<header/param name>:<sha256(secret)[0..16]>   (configured auth)
```

- Same endpoint + same credential + different model names ⇒ **one** group (a model name cannot
  bypass the shared budget).
- Different credential on the same endpoint ⇒ different group (two accounts never block each other).
- Different endpoint ⇒ different group.
- `quotaGroupAliases` merges derived groups explicitly (two provider entries that are really one
  account/quota).

The discriminator is a truncated SHA-256 computed in process memory. It is not the credential, is
never sent to a provider, never logged (the rejection log line carries endpoint/providers/counters
only) and never written into evidence files. The test suite asserts the raw credential never appears
in a group id.

## Release semantics

The slot is released where the physical request is confirmed finished, reusing the existing guarded
release points: `buildManagedResponse` stream close/error/cancel, `normalizeOpenAISdkStreamContentType`
early release, and the transport error path. There is **no** time-based release of a held slot, so an
upper-layer timeout that leaves the request alive cannot cause the budget to over-issue; the
`releaseOutboundSlot` wrapper executes at most once and the gate counts a second release.

## Configuration (opt-in, no frozen default)

| Variable | Meaning |
|---|---|
| `OPENCLAW_PROVIDER_OUTBOUND_MAX_CONCURRENT` | max physical requests per quota group (activates the budget) |
| `OPENCLAW_PROVIDER_OUTBOUND_MAX_QUEUE` | max waiters; defaults to `maxConcurrent` (bounded queue) |
| `OPENCLAW_PROVIDER_OUTBOUND_QUEUE_TIMEOUT_MS` | queued-wait deadline; defaults to 30000 |
| `OPENCLAW_PROVIDER_OUTBOUND_QUOTA_ALIASES` | `derived=canonical` pairs, comma separated |

`configureProviderOutboundBudget({ limits, quotas, quotaGroupAliases, now })` is the programmatic
equivalent (used by tests and available to a host). With nothing configured the boundary is one map
lookup and the request proceeds ungated — deliberately, because the issue forbids picking an example
concurrency number as a product default.

## Covered vs not covered

`PROVIDER_OUTBOUND_COVERAGE` (asserted by unit test so the claim cannot drift silently):

| Surface | Covered |
|---|---|
| chat / main agent turn (openai, anthropic, google transports) | yes |
| subagent runs | yes |
| cron runs | yes |
| compaction and auxiliary model calls (google prompt cache, stage1 golden run) | yes |
| SDK/transport retries | yes — each wire attempt passes the boundary again |
| embedding adapters (`memory-host-sdk`, `extensions/*/embedding-provider`) | **no** |
| media understanding / image / music providers | **no** |
| local provider sidecar startup | **no** (owned by `provider-local-service` leases) |

## Failure semantics

`ProviderOutboundOverloadedError` carries `code: E_PROVIDER_OUTBOUND_OVERLOADED`, the rejection
reason and the counters. Its message intentionally contains the word `overloaded`, so the existing
`classifyFailoverReason()` text classifier maps it to the `overloaded` failover reason and the agent
runner applies its overload backoff/profile rotation rather than surfacing an opaque unknown error.
A retry re-enters admission; it does not inherit the previous slot.

## Verification

- `openclaw_runtime/src/infra/bounded-concurrency.test.ts` (10 cases, fake timers): limits, FIFO,
  overload refusal before waiting, queue deadline, abort (queued and pre-aborted), counted double
  release, `maxQueue: 0`, close, 50-caller burst with zero leak, updated limits.
- `openclaw_runtime/src/agents/provider-outbound-budget.test.ts` (15 cases): endpoint normalization,
  group sharing/separation, no raw credential in the group id, env parsing and inert default,
  coverage-table honesty, transport-boundary sharing of one slot, over-capacity refusal without a
  provider call, release only when the guarded request is confirmed finished, release on transport
  error plus retry re-admission, cross-account/cross-endpoint independence, alias merging, queued
  abort with no leak, shutdown rejection, no starvation between a holder and a waiter.
- `D:/ClawX-work/p1-154-outbound-budget-20261011/bounded-load.mjs` (stub provider + injected clock,
  run with `node --import tsx`): burst matrix (2/0, 2/2, 4/8 × 60 requests) and paced matrix
  (3/6, 3/0 × 40 requests at 2 ms arrivals), plus live-request-not-falsely-released, cancel-while-
  queued, alias, cross-account and injected-clock scenarios. Raw per-request samples land in
  `bounded-load-raw.json`, summary in `report.json`, verdict fail-closed.
- Existing transport suites re-run unchanged: `stage1-request-envelope`, `rc02-entry-matrix`,
  `openai-transport-stream`, `anthropic-transport-stream`.

## Residual, stated honestly

1. The load harness is **stub verification** (in-process stub provider, no network). There is no
   real-provider or real-OS load evidence in this change, and none is claimed.
2. Embedding adapters and media providers remain ungated; a shared group for them would need its own
   admission call at their fetch boundary.
3. No config-file leaf was added: the surface is environment/programmatic only, so an operator cannot
   yet set a per-provider limit from `openclaw.json`. Deliberate (no new config leaf without a
   product decision) and recorded here rather than implied.
4. The queue deadline uses a real timer; only the wait accounting uses the injectable clock.
5. No release, packaging, cross-platform or full-suite claim; `driver_by: agent`, no real credential,
   no paid provider call, no human evidence.
