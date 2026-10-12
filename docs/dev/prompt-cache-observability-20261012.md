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
| Ledger + dispatch unit suites | `pnpm exec vitest run tests/unit/prompt-cache-observability.test.ts tests/unit/prompt-cache-observation-ledger.test.ts tests/unit/prompt-cache-status.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/deepseek-prompt-cache-runtime.test.ts` | 5 files, **45/45 passed**, exit 0 |
| Runtime core typecheck | `node node_modules/@typescript/native-preview/bin/tsgo.js -p tsconfig.core.json --noEmit` | exit 0 |
| Contract drift | `pnpm contract:check` | `Contract check passed`, exit 0 |
| Comms replay + compare | `pnpm run comms:replay` / `pnpm run comms:compare` | exit 0, all PASS |
| Spec | `node harness/src/cli.mjs validate --spec harness/specs/tasks/prompt-cache-observation-ledger-20261012.md --since origin/main` | `Spec is valid`, exit 0 |
| Artifact retention | `node scripts/check-repository-artifacts.mjs` | passed (17256 tracked paths) |
| Import cycles | `pnpm --dir openclaw_runtime run check:import-cycles` | 0 runtime value cycles |

`typecheck:node` initially failed on a missing gitignored generated file
(`electron/extensions/_ext-bridge.generated.ts`); regenerating it with
`node scripts/generate-ext-bridge.mjs` (no external extensions configured →
empty stubs) resolved it. That is unrelated to this change.

## Second half: observed breaks reach the existing Main ledger

`run/attempt.ts` now emits a bounded `stream: "prompt_cache"` frame on the
sequenced agent event bus when `completePromptCacheObservation` reports a real
break. The frame carries only the run id, a deterministic `eventId`
(`<runId>:<attemptIndex>`), the two finite token counters and the closed set of
change codes.

- `electron/gateway/event-dispatch.ts` projects that frame into a dedicated
  `prompt-cache:break` event and drops malformed frames. It never reaches
  `chat:runtime-event` or the generic renderer `notification` path, so the
  diagnostic frame can never be rendered as chat text.
- `electron/main/index.ts` consumes `prompt-cache:break` and calls
  `recordPromptCacheObservation` (`electron/services/usage-api.ts`), the only
  writer. No new store, no new host-api method.
- `shared/types/workspace.ts` splits the ledger row into
  `PromptCacheRiskObservation` (`source: 'observed'`) and
  `PromptCacheRiskDecisionEvent` (`source: 'confirmed'`); legacy rows without
  `source` are read as confirmed decisions.
- The shared ledger stays capped at 200 rows. Observed writes are deduplicated
  by `eventId`, and a serialized read-modify-write queue prevents concurrent
  observed/confirmed appends from dropping each other.
- `electron/utils/prompt-cache-status.ts` keeps `warningCount`,
  `cancelledBreakCount` and `lastRiskEvent` scoped to confirmed decisions only
  (UI semantics unchanged) and exposes the latest observed break separately as
  `lastObservedBreak`.

## What this does not do

- It does not add a keepalive request, refresh a cache TTL, or rewrite tool
  schemas.
- It does not claim any hit-rate improvement; that would require an
  agent-driven before/after artifact pair.
- It does not add a new storage backend, a new host-api read path or any UI
  surface; observations are read back through the existing
  `usage.promptCacheStatus` assessment.
- An observed break is evidence that a warm prefix dropped, not proof that the
  tracked input change causally explains the drop, and not a user decision.

## Follow-ups

1. #165: give the live cache regression baseline an execution entry.
2. #164 / #166: compaction-TTL coupling and tool "mask, don't remove".