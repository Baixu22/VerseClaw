# Prompt-cache capability reconciliation — 2026-10-12

Durable record for the change set delivered as
[PR #170](https://github.com/Baixu22/VerseClaw/pull/170) (commit `0d75ee9a`, based on
`d7ec712f`). Session-local state (task forest, `LATEST.md`, research notes) is intentionally
not part of this record; only the decisions and the facts a later reader needs to re-verify
the work are captured here.

## 1. What landed

Four workstreams, each with its own spec:

| Spec | Delivered |
| --- | --- |
| `harness/specs/tasks/openai-prompt-cache-write-point.md` | `promptCacheKey` and the `cacheRetention` intent now reach the OpenAI-family wire. The write point is `openclaw_runtime/src/agents/openai-prompt-cache-payload.ts`, applied through `finalizeOpenAIProviderParams`, which all four OpenAI payload builders funnel through. `resolveCacheRetention` no longer drops an explicit `cacheRetention` on those lanes. |
| `harness/specs/tasks/prompt-cache-boundary-outbound-gate.md` | The internal cache-boundary marker is projected away structurally for the payloads this runtime owns (chat `system`, Responses `input_text`) and at the provider-owned hand-over, and a fail-closed gate rejects what survives into the request bytes. |
| `harness/specs/tasks/upstream-protocol-capability-descriptor.md` | One module (`openclaw_runtime/src/agents/upstream-protocol-capabilities.ts`) classifies the protocol kind for every api spelling and resolves the cache-field allowances once, replacing four near-copies of the same endpoint knowledge. |
| `harness/specs/tasks/cache-read-write-visibility.md` | `extractMessageUsage` carries cache read, cache write and a nullable hit rate beside the unchanged combined `cacheTokens`; the badge and the Billing breakdown surface the split. |

The rule of record for the first three is
`harness/specs/rules/outbound-protocol-payload-consistency.md`, which now also states that an
api id is not one string: the managed transport rewrites a public id to its in-tree spelling,
so a classification that knows only one spelling silently becomes a different decision on the
managed path.

## 2. Measured defect this change set closes

Native OpenAI endpoint, `compat.supportsPromptCacheKey: false`, `cacheRetention: "long"`,
observed through the real resolvers before the fix:

| route api | capability record strip | payload policy strip | emitted fields |
| --- | --- | --- | --- |
| `openai-responses` | true | true | `{}` |
| `openclaw-openai-responses-transport` | false | true | `{prompt_cache_retention: "24h"}` |
| `openclaw-azure-openai-responses-transport` | false | false | `{prompt_cache_retention: "24h"}` |

Row 2 is the contradiction the rule forbids: `applyOpenAIResponsesPayloadPolicy` deletes both
cache fields on the `onPayload` hook, and the write point then re-added the retention field
after it, so an operator-declared refusal shipped a field anyway. Row 3 is the same class from
the other side: neither copy recognized the Azure alias, so that lane resolved different
store/service-tier facts than its own public spelling.

Root cause: `provider-transport-stream.ts` (`SIMPLE_TRANSPORT_API_ALIAS` →
`prepareTransportAwareSimpleModel`) rewrites `openai-responses` to
`openclaw-openai-responses-transport` before the managed transport builds a payload, while the
provider wrapper above it still sees the public id. `provider-api-families.ts` had the same
defect for `parallel_tool_calls` (public ids only, so the alias lanes fell through).

## 3. Boundary decision against the landed observation loop

`harness/specs/tasks/prompt-cache-observation-ledger-20261012.md` and
`harness/specs/rules/prompt-cache-observation-boundary.md` already own the cache-break
observation loop: the runtime agent event bus publishes `stream: "prompt_cache"`, Main consumes
it into the ledger, and the typed `usage.promptCacheStatus` host API is the read path. That rule
states three constraints that must not be duplicated around:

1. diagnostic frames are consumed in Main and never enter renderer chat-event paths;
2. no parallel store for observations;
3. only bounded identifiers, finite token counters and closed change codes cross the boundary —
   no arbitrary producer detail strings.

An earlier draft in this change set added a competing `stream: "cache"` frame, a
`shared/chat-runtime-events.ts` variant, an Electron normalizer branch and a session-entry store
(`openclaw.cache-attribution`). It violated all three constraints and was removed rather than
shipped alongside the ledger. **Future prompt-cache observation work goes through the ledger;
do not add a second event or storage path.** The display half was kept and re-scoped under
`cache-read-write-visibility.md`, which explicitly leaves observation to the ledger spec.

## 4. Re-verification (offline, no credential or paid request)

```bash
# Runtime probes: real outbound bytes + the emit/strip agreement matrix.
cd openclaw_runtime && node scripts/run-vitest.mjs run \
  --config test/vitest/vitest.agents-core.config.ts \
  src/agents/upstream-protocol-capabilities.test.ts \
  src/agents/upstream-protocol-cache-probe.test.ts \
  src/agents/openai-transport-stream.test.ts \
  src/agents/anthropic-transport-stream.test.ts

# Display split plus the render-side baselines.
./node_modules/.bin/vitest run tests/unit/cache-read-write-visibility.test.ts \
  tests/unit/token-usage-badge.test.tsx tests/unit/billing-cache-stats.test.tsx \
  tests/unit/assistant-render-model.test.ts tests/unit/models-usage-history.test.ts

# The landed observation loop must stay green too.
./node_modules/.bin/vitest run tests/unit/prompt-cache-observability.test.ts \
  tests/unit/prompt-cache-observation-ledger.test.ts tests/unit/prompt-cache-status.test.ts
```

The consistency matrix covers two endpoint classes, six `compat` shapes, three Responses routes
and both api spellings, and asserts that the emit point and the strip policy resolve the same
value for each combination. A source-level guard in the same probe fails the build if a module
outside the descriptor reintroduces an api-id enumeration that includes the base
`openai-responses` id and no foreign protocol id.

## 5. Known gaps and follow-ups

- `prompt_cache_options` (GPT-5.6-and-later explicit mode) is not emitted.
  `allowsExplicitModeOptions` is hard-false in the descriptor because no model-generation signal
  exists at that seam: a wrong lifetime field is a provider 400, a missing one is only a lost
  optimization.
- The two endpoint-class resolvers remain separate (the bundled host table in
  `openai-responses-payload-policy.ts` versus the manifest-driven one in `provider-attribution.ts`).
  Merging them changes behaviour for every provider route, not only cache routes, so it needs its
  own change set. The descriptor consumes the endpoint facts as inputs precisely to keep that
  merge independent.
- Anthropic breakpoint allocation does not cover the tools segment; the Google explicit-cache
  break-even check and the `promptCacheKey` granularity policy are still open.
- The reverse direction OpenAI history to the Anthropic transport
  (`createAnthropicMessagesTransportStreamFn`) is untested; the forward direction is covered by
  `openclaw_runtime/src/agents/embedded-agent-runner/history-projection-probe.test.ts`.

## 6. Why this branch is a single commit on `main`

The session branch and `main` had no common ancestor (this repository has a history-rewriting
mechanism that replaces the root commit), so the change set was rebased onto `main` and
re-applied as one commit rather than merged with unrelated histories. When resolving a rebase
here, do not `--amend` while conflicts are unresolved: on `main` that rewrites the base commit.
Verify with `git merge-base --is-ancestor origin/main HEAD` before pushing.
