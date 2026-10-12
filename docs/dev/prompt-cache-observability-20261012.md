# Prompt-cache break attribution runs by default (issue #163)

- Date: 2026-10-12
- Issue: #163
- driven_by: agent
- actor: codex
- Base: `origin/main = 8f87c6156`

## Problem

`openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability.ts`
implements a bounded, dependency-free tracker that snapshots the inputs which
decide prompt-cache reuse (`provider / modelId / modelApi / cacheRetention /
streamStrategy / transport / systemPromptDigest / toolDigest / toolCount /
toolNames`) and attributes a warm-prefix cache-read drop to the changed input.

`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts` gated the
whole tracker on:

```ts
const cacheObservabilityEnabled = Boolean(cacheTrace) || log.isEnabled("debug");
```

`cacheTrace` is opt-in (`diagnostics.cacheTrace` / `OPENCLAW_CACHE_TRACE`) and
debug logging is off by default, so in a default install attribution never ran.
Cache hit-rate could therefore never become a scheduling input, and a hit-rate
drop had no attributable cause.

## What landed

`prompt-cache-observability.ts`:

- `PROMPT_CACHE_OBSERVABILITY_ENV = "OPENCLAW_PROMPT_CACHE_OBSERVABILITY"`.
- `isPromptCacheObservabilityEnabled(env = process.env)` — returns
  `parseBooleanValue(env[...]) ?? true`. Ambiguous values fall back to the
  default (on) rather than silently disabling attribution.

`run/attempt.ts`:

- `cacheObservabilityEnabled = isPromptCacheObservabilityEnabled() || Boolean(cacheTrace) || log.isEnabled("debug")`.

So attribution is on by default; trace/debug still force it on; operators can
turn it off with `OPENCLAW_PROMPT_CACHE_OBSERVABILITY=0`.

## Why this is safe to default on

- The tracker is pure in-memory bookkeeping. It performs no file, network, or
  persistent write; the only output paths are the existing `cacheTrace` JSONL
  (still opt-in) and the existing `log.warn` on a detected break.
- Retention is bounded: `MAX_TRACKERS = 512`, oldest-first eviction.
- Detection is thresholded: `MIN_CACHE_BREAK_TOKEN_DROP = 1_000` and
  `MAX_STABLE_CACHE_READ_RATIO = 0.95`, so small jitter is not reported.
- It changes no prompt, no tool set, no provider parameter, and no frozen
  default.

## Verification

| Gate | Command | Result |
|---|---|---|
| New unit suite | `pnpm exec vitest run tests/unit/prompt-cache-observability.test.ts` | 1 file, **10/10 passed**, exit 0 |
| Related cache suites | `pnpm exec vitest run tests/unit/prompt-cache-status.test.ts tests/unit/deepseek-prompt-cache-runtime.test.ts tests/unit/prompt-cache-observability.test.ts` | 3 files, **18/18 passed**, exit 0 |
| Node typecheck | `pnpm run typecheck:node` | exit 0 |
| Test typecheck | `pnpm run typecheck:test` | exit 0 |

`typecheck:node` initially failed on a missing gitignored generated file
(`electron/extensions/_ext-bridge.generated.ts`); regenerating it with
`node scripts/generate-ext-bridge.mjs` (no external extensions configured →
empty stubs) resolved it. That is unrelated to this change.

## What this does not do

- It does not add a keepalive request, refresh a cache TTL, or rewrite tool
  schemas.
- It does not claim any hit-rate improvement; that would require an
  agent-driven before/after artifact pair.
- It does not yet persist observed breaks to the `promptCacheRiskLedger`
  (issue #163 second half) — the ledger currently lives in the Electron Main
  process (`electron/services/usage-api.ts`) and a runtime→Main channel is a
  separate change.

## Follow-ups

1. #163 second half: feed observed breaks (`broke / previousCacheRead /
   cacheRead / changes[]`) into the existing `PromptCacheRiskEvent` ledger with
   a `source: 'observed' | 'confirmed'` field.
2. #165: give the live cache regression baseline an execution entry.
3. #164 / #166: compaction-TTL coupling and tool "mask, don't remove".