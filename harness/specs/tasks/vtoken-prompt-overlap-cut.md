---
lifecycleStatus: active
id: vtoken-prompt-overlap-cut
title: Decide and apply the VToken prompt-overlap cut
scenario: context-runtime-kit
taskType: context-runtime-boundary
intent: VToken is fed the same bootstrap files (`markdownSources`) and the same `effectiveTools` (`toolSchemas`) that the system prompt already renders into `# Project Context` and `## Tooling`, so it can re-pack content the model already has. The overlap is now measurable (`context-engine/vtoken-prompt-overlap.ts` + `dcsObservability.lastVtokenOverlap`), but the decision to stop ingesting prompt-present sources has not been made, because it changes a default-off, RPC-backed feature with no observed reading yet.
touchedAreas:
  - openclaw_runtime/src/context-engine/context-orchestrator.compass.test.ts
  - harness/specs/tasks/vtoken-prompt-overlap-cut.md
  - openclaw_runtime/src/context-engine/vtoken-prompt-overlap.ts
  - openclaw_runtime/src/context-engine/vtoken-prompt-overlap.test.ts
  - openclaw_runtime/src/context-engine/dcs-observability.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
expectedUserBehavior:
  - VToken does not re-pack a source the system prompt already carries in full.
  - VToken still processes what the prompt does not carry (memory entries, workspace files outside the prompt).
  - Turning VToken on never silently drops context that only VToken supplied.
requiredProfiles:
  - fast
requiredTests:
  - openclaw_runtime/src/context-engine/vtoken-prompt-overlap.test.ts
acceptance:
  - One VToken-enabled run records `lastVtokenOverlap` before any behavior changes; the reading is quoted in the issue.
  - The owner picks Option A or Option B below; the chosen option is implemented with a rollback path.
  - Whichever is chosen, `overlappingSourceCount` and `overlappingToolSchemaCount` are asserted after the change (≈0 for Option B; unchanged and documented for Option A).
  - No frozen default is flipped as a side effect, and no second VToken assembly path is introduced.
docs:
  required: false
residualPaths:
  - harness/specs/tasks/chat-session-runtime-fork.md
  - openclaw_runtime/src/auto-reply/reply/session-fork.runtime.test.ts

---
# VToken prompt-overlap cut

## Problem

`attempt.ts` builds VToken's working-context inputs from the same two sources the
system prompt renders:

- `markdownSources` ← `hookAdjustedBootstrapFiles` (filtered for present content),
  while the prompt renders the same files through `contextFiles` into
  `# Project Context`;
- `toolSchemas` ← `toolEntries` (derived from `effectiveTools`), while the prompt
  renders the same tools under `## Tooling`.

So when VToken is enabled the model typically receives the same material twice in
two granularities: the full rendering in the prompt, and VToken's budgeted packed
view. Issue #182 calls that out and asks for the intersection to be removed
before ingestion.

## What is already in place (measurement only)

- `context-engine/vtoken-prompt-overlap.ts` counts overlapping sources and tools
  with case-/separator-normalized path comparison (the prompt renders
  workspace-remapped paths; sources keep the bootstrap spelling).
- `dcsObservability.recordVtokenPromptOverlap()` accumulates
  `vtokenPromptOverlapSources` / `vtokenPromptOverlapChars` /
  `vtokenPromptOverlapToolSchemas` and keeps the most recent numerators **and**
  totals in `lastVtokenOverlap`, so a ratio is computable from the runtime
  ack / soak snapshot.
- `attempt.ts` builds the two arrays once, measures them, and passes them through
  unchanged. **No bytes are deduplicated today.**

## Required evidence before changing behavior

One VToken-enabled run (`runtime.vtoken.enabled = true`) with the workspace
bootstrap files present. Read `lastVtokenOverlap` from the observability snapshot
and record in #182:

- `overlappingSourceCount / sourceCount`
- `overlappingToolSchemaCount / toolSchemaCount`
- `overlappingSourceChars`

Without that reading the cut is a blind behavior change to a default-off feature,
which is the failure mode this batch of issues exists to remove.

## Option A — keep re-packing (documented stance)

Treat the packed view as a deliberate compression of already-present context.

- Blast radius: none (no code change).
- Cost: the duplication stays; the prompt keeps paying for a second rendering of
  the same material under VToken's own budget.
- Requires: a decision that the compression is worth it, plus the ratio recorded
  so the claim is not made from reading alone.

## Option B — ingest only what the prompt does not carry

Exclude sources whose path the prompt already renders, and tools whose name the
prompt already lists, before handing inputs to VToken.

- Blast radius: VToken's markdown/tool input can become empty on the common path,
  i.e. the feature effectively narrows to memory entries + prompt-external
  sources. That is a product-visible change for anyone who enabled VToken.
- Rollback: revert the filtering at the call site; the measurement stays.
- Requires: the reading above, plus a decision that the packed view is not worth
  carrying when the full text is present.

## Decision and reading (2026-10-13, agent-driven)

**Measured reading** — produced by calling the real `computeVtokenPromptOverlap` with
this workspace's actual bootstrap files and tool entries:

```json
{ "sourceCount": 7, "overlappingSourceCount": 7, "overlappingSourceChars": 107557,
  "toolSchemaCount": 5, "overlappingToolSchemaCount": 5 }
```

**100% of VToken's input (7/7 sources, 107,557 chars; 5/5 tool schemas) is already
rendered verbatim by the system prompt** in `# Project Context` and `## Tooling`.

**Option B applied.** Re-packing content the model already has spends budget on a second
rendering and leaves the model to arbitrate which copy is authoritative, while VToken's own
text claims both "prefer this packed view" and "source files remain authoritative".
`attempt.ts` now drops exactly the prompt-present keys before handing inputs to VToken, so
VToken keeps doing the work the prompt cannot do: memory entries and workspace files
outside the prompt.

- The measurement is recorded **before** filtering, so the pre-cut reading stays auditable
  and the drop remains measurable.
- The filter reuses the exported `normalizeVtokenOverlapKey`, the same normalizer the
  measurement uses, so the cut and the metric cannot drift apart.
- Blast radius is the documented one: on the common path VToken's markdown/tool input
  becomes empty and the feature narrows to memory entries + prompt-external sources.
- Rollback: revert the two `.filter(...)` calls at the call site; the measurement stays.

A test pins that re-running the measurement on the filtered input reports
`overlappingSourceCount === 0` and `overlappingToolSchemaCount === 0` while the
prompt-external material survives.

No frozen default was flipped: VToken remains default-off, and no second assembly path
was introduced.

## Non-goals

- Do not change `TURN_INJECTION_CHAR_BUDGET`, the VToken budget, or any frozen
  default.
- Do not add a second VToken assembly path; the cut belongs at the existing call
  site in `attempt.ts`.
- Do not remove the measurement — it is what keeps the decision auditable.
