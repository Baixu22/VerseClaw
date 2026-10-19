# Retry budget and retry safety

- Node: TF-0438
- Baseline: origin/main @ 9cae5341
- Driven by: agent
- Evidence boundary: implementation evidence only; independent fault injection remains TF-0444.

## One logical request, one attempt chain

openclaw_runtime/src/agents/request-attempt-budget.ts defines a request-scoped budget with logicalRequestId, maxPhysicalAttempts, used/remaining, recordAttempt/tryRecordAttempt, completeAttempt, retryAfterMs and snapshot.

The budget is exposed through runWithRequestAttemptBudget and getRequestAttemptBudget (AsyncLocalStorage). Every layer reads the same budget for the active logical request.

## Layer behavior

- Agent auto-retry (agent-session.ts) creates the budget at the turn boundary and records each auto-retry attempt as agent-auto-retry.
- Model fallback (model-fallback.ts) records one budget entry per candidate attempt as model-fallback; when the budget is exhausted it stops trying further candidates.
- Generic retry runner (infra/retry.ts) accepts an optional budget and also reads the ambient budget; each physical call is recorded as retryAsync or the caller-supplied layer.
- Provider transport (provider-transport-fetch.ts) reads the ambient budget at fetch time and records each outbound request as provider-transport; an exhausted budget fails closed before sending.
- SDK/provider retry hints (provider-transport-fetch.ts) retain the existing long-Retry-After bypass; the logical budget owns cross-layer retry decisions.

## Retry-After semantics

- Finite non-negative Retry-After is kept as a lower bound in the budget (retryAfterMs).
- retry-after-ms fractional values are preserved; auto-retry rounds the scheduled delay up and only applies positive jitter when the hint is present.
- If a hint exceeds the local wait cap, the retry is not scheduled early; the failure and its retry metadata are preserved.

## Terminal conditions

The following are not retried by the auto-retry/fallback path: refusal, context overflow, non-provider coordination errors, tool-loop termination.

## Observation boundary

Failed/retried usage stays on the existing model-call diagnostic surface (attempt.model-diagnostic-events.ts): attemptId, requestId, requestStartedAtMs and usageSnapshot. No second usage store is introduced. Missing invalid usage is kept as null by attempt.model-call-usage.ts, not recorded as a healthy zero.

## Tests

- openclaw_runtime/src/agents/request-attempt-budget.test.ts
- openclaw_runtime/src/infra/retry.test.ts
- openclaw_runtime/src/agents/model-fallback.loop-termination.test.ts
- openclaw_runtime/src/agents/provider-outbound-budget.test.ts
- openclaw_runtime/src/agents/retry-after.test.ts
- Root tests/unit/provider-error-retry-boundaries.test.ts
- pnpm run typecheck

## Non-goals

- no paid provider request
- no second usage store
- no product default change
- no global scheduler or cross-request rate limiter
