# Prompt-cache-aware compaction TTL gate (#164)

## Problem

`context-pruning` already avoids pruning while `openclaw.cache-ttl` is still
inside the configured window, but safeguard compaction did not read that marker.
A non-urgent budget/preflight compaction could therefore rewrite history while
the provider prompt cache was still warm.

## Change

The new opt-in config is:

```yaml
agents:
  defaults:
    contextPruning:
      mode: cache-ttl
      ttl: 1h
    compaction:
      deferWhileCacheHot: true
```

When enabled, `compactEmbeddedAgentSessionDirect` checks the latest matching
cache-TTL marker before capturing a compaction checkpoint or rewriting history.
If the marker is still inside the configured TTL, a `budget` compaction returns:

- `ok: true`
- `compacted: false`
- `reason: deferred while prompt cache is hot`

The preflight caller treats that reason as a skip and continues the turn. The
same check runs again on the next turn, so compaction proceeds once the cache
window has aged out. Manual, overflow and timeout-recovery compaction do not
consult this gate.

## Reused primitives

- `readLastCacheTtlTimestamp` reads the existing `openclaw.cache-ttl` session entry.
- `isCacheTtlEligibleProvider` limits the gate to providers with cache-TTL semantics.
- `computeEffectiveSettings` reuses `contextPruning.mode` and `contextPruning.ttl`.
- The existing compaction result/classification path carries the deferral as a
  successful skip reason rather than a failure.

## Verification

- `pnpm exec vitest run tests/unit/compaction-cache-ttl.test.ts`
- `pnpm run typecheck:node`
- `pnpm run typecheck:test`
- scoped ESLint on all changed TypeScript files
- `pnpm harness validate --spec harness/specs/tasks/prompt-cache-compaction-ttl-20261012.md`
- `pnpm run comms:replay` and `pnpm run comms:compare`

The unit test uses the real `readLastCacheTtlTimestamp` and
`isCacheTtlEligibleProvider` implementations with only provider-plugin lookup
stubbed, so it covers the actual cache-marker parser and the Anthropic-family
eligibility fallback.

## Boundaries

- The opt-in defaults to false; existing compaction timing is unchanged by default.
- No keepalive request, TTL refresh, provider cache-control rewrite, or model/tool
  input mutation is introduced.
- This change does not claim a hit-rate, token-cost, or throughput improvement.
- The gate does not turn a manual, overflow, or timeout recovery into a deferral.
