---
lifecycleStatus: active
id: cache-read-write-visibility
title: Separate cache reads from cache writes wherever per-message usage is shown
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: The runtime already emits and persists prompt-cache observation, and Billing aggregates cache-write totals, but the per-message usage path collapses reads and writes into one `cacheTokens` number. A discounted cache read and a surcharged cache write are not the same currency, so the render layer cannot show whether a session is saving or paying. Carry the split and a hit rate alongside the combined figure.
touchedAreas:
  - src/components/assistant-render/model.ts
  - src/components/assistant-render/TokenUsageBadge.tsx
  - src/pages/Billing/index.tsx
  - src/pages/Models/usage-history.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/en/dashboard.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ja/dashboard.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/ru/dashboard.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/zh/dashboard.json
  - tests/unit/cache-read-write-visibility.test.ts
  - tests/unit/token-usage-badge.test.tsx
expectedUserBehavior:
  - A message's token breakdown shows a hit (cache read) and a cache write separately, and still shows the combined cache figure.
  - A message with prompt tokens shows its cache hit rate; a message without them shows no invented rate.
  - The model breakdown table shows the cache-write column next to the cache-read column.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
requiredTests:
  - tests/unit/cache-read-write-visibility.test.ts
  - tests/unit/token-usage-badge.test.tsx
acceptance:
  - `extractMessageUsage` returns `cacheReadTokens`, `cacheWriteTokens` and a nullable `cacheHitRate` beside the unchanged combined `cacheTokens`, reading the Anthropic/Bedrock-shaped field names as well as the OpenAI ones.
  - The badge renders cache read, cache write, the combined figure and the hit rate, and keeps returning nothing when usage is unavailable.
  - The hit rate comes from the shared `shared/types/usage.ts#computeCacheHitRate`; no second implementation is introduced in the render layer.
  - The renderer keeps reading usage through its existing typed data path and adds no Gateway call, `ipcRenderer` call or new event subscription.
  - `groupUsageHistory` also carries the split, so the Billing model chart can show read/write without recomputing from entries.
docs:
  required: false
---

## Background

`assistant-render/model.ts` normalized usage into a single `cacheTokens` value
(`cacheRead + cacheWrite`), and the badge rendered only that. Billing already separates
`cacheReadTokens` / `cacheWriteTokens` in its rows and KPIs, so the arithmetic exists — it
is the **per-message** display that loses the distinction.

The observation half of the loop is owned elsewhere and is not touched here:
`harness/specs/tasks/prompt-cache-observation-ledger-20261012.md` delivers cache-break
observations through the runtime agent event bus into the Main-owned ledger, and
`harness/specs/rules/prompt-cache-observation-boundary.md` keeps those diagnostic frames
out of renderer chat-event paths. This spec only widens what the renderer can *display*
from usage it already reads.

## Scope

- Carry `cacheReadTokens`, `cacheWriteTokens` and a nullable `cacheHitRate` on the usage
  value the render layer already produces, keeping `cacheTokens` for compatibility.
- Render the split in the badge next to the combined figure.
- Add the cache-write column to the Billing breakdown table and the read/write pair to the
  model chart tooltip, fed from `groupUsageHistory`.
- Keep the hit rate computed by `shared/types/usage.ts#computeCacheHitRate`.
- i18n for the new labels in the four shipped locales.

## Out of scope

- Cache-break attribution, its event shape and its persistence. Owned by the landed
  `prompt-cache-observation-ledger-20261012` spec and its boundary rule; this change set
  deliberately removes the competing `stream: "cache"` frame and the session-entry
  `openclaw.cache-attribution` store, because "do not add a parallel store" and "raw agent
  diagnostic frames never enter renderer chat-event paths" are already the rule of record.
- Changing the usage aggregation route or the cost model.

## Risks

- The badge tooltip gains rows, so a narrow tooltip is taller. Rows only appear when their
  value is non-zero, and the combined row is unchanged.
- `cacheHitRate` is null rather than 0 when there is no prompt-token denominator, so a
  consumer must not read null as a total miss.
