---
lifecycleStatus: active
id: ranged-session-compaction
title: Compaction with a located range (summarize from here / up to here)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Compaction is all-or-nothing — manual `sessions.compact` and the automatic safeguard both replace the whole transcript with a summary — so a user who goes wrong at turn 40 of 60 can only summarize everything (losing all original text) or start a new session (losing all context). Claude Code exposes two located variants ("summarize from here" / "summarize up to here") that keep the untouched side verbatim. This spec records the capability gap, the required gateway surface, and the constraints a range compaction must satisfy so it cannot become a second, unvalidated summary path.
touchedAreas:
  - harness/specs/tasks/ranged-session-compaction.md
  - openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts
  - openclaw_runtime/packages/agent-core/src/harness/compaction/prepare-compaction.test.ts
  - openclaw_runtime/packages/gateway-protocol/src/index.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/protocol-schemas.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/sessions.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/compact.types.ts
  - openclaw_runtime/src/agents/sessions/agent-session.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/ranged-compaction-transcript.test.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction-range.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction-range.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/zh/chat.json
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/index.tsx
  - tests/e2e/chat-session-compact-range.spec.ts
  - tests/e2e/chat-user-message-actions.spec.ts-snapshots/user-message-actions-hover-dark-win32.png
  - tests/unit/host-services.test.ts
  - electron/services/sessions-api.ts
  - src/lib/host-api.ts
expectedUserBehavior:
  - A user can summarize only a chosen stretch of the conversation and keep the rest verbatim.
  - The untouched side is byte-identical after the operation; nothing outside the chosen range is rewritten.
  - Starting a range compaction writes a checkpoint, so the operation can be reverted like the whole-session one.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.test.ts
acceptance:
  - A gateway surface (`sessions.compactRange` with `fromLeafId`/`toLeafId`, exactly one of them) exists and fails closed on an id that is absent from the parent transcript or not on the active branch.
  - Range compaction runs the existing validated pipeline (compaction-validated-pipeline + damage rules + addressability); no second summary implementation is introduced.
  - A new compaction checkpoint is written before the transcript is rewritten, so the pre-operation leaf can be recovered.
  - The untouched side of the transcript is proven byte-identical by a test, not by inspection.
  - UI entry points ("summarize from here" / "summarize up to here") are covered by an Electron E2E spec in the same change.
  - No frozen default changes.
docs:
  required: false
---

# Ranged session compaction

## Capability gap

| Capability | State |
|---|---|
| Whole-session manual compaction (`sessions.compact` + `sessions_compact`) | exists |
| Whole-session automatic compaction (safeguard + preemptive) | exists |
| Compaction quality gates (`compaction-validated-pipeline`, `compaction-damage-rules`, `compaction-addressability`) | exists |
| Compaction checkpoint retention + artifact viewer | exists |
| Summarize *from* / *up to* a located point, keeping the rest verbatim | **missing** |

`compactRange` does not exist anywhere in the repo (`git grep compactRange` is empty), so
this is a new surface rather than a missing option on an existing one.

## Required surface

- **Gateway**: `sessions.compactRange` accepting `key` plus exactly one of `fromLeafId`
  (summarize that point to the tail) or `toLeafId` (summarize the head to that point).
  An id that is not present in the transcript, or not on the parent's active branch, must
  fail closed — never silently fall back to a whole-session compaction (the same rule
  #180 applies to `sessions.fork`'s `fromLeafId`).
- **Transcript surgery**: the branch-walk helpers already exist
  (`session-compaction-checkpoints.ts` `forkCompactionCheckpointTranscriptAsync` /
  `readSessionLeafIdFromTranscriptAsync`, and `readBranch` in the fork runtime). The range
  operation must reuse them instead of re-implementing leaf addressing.
- **Checkpoint**: write a new compaction checkpoint before rewriting, so the pre-operation
  leaf remains recoverable through the existing checkpoint surfaces.
- **Summary path**: the range summary goes through `compaction-validated-pipeline` and is
  subject to `compaction-damage-rules` / `compaction-addressability`. A range compaction
  that skips those gates is a defect, not a shortcut.
- **UI**: message-level "summarize from here" / "summarize up to here" entry points, i18n in
  all four locales, and an Electron E2E in the same change.

## Decisions (agent-driven, 2026-10-13)

These replace the former "owner input required" questions. They are decided here so a
follow-up implementation is not blocked (the agent is the mainline developer per
`AGENTS.md`); nothing below needs a publisher answer.

1. **Boundary is the selected entry, inclusive on the kept side.** The transcript model puts
   the compaction summary at the *head* and replays the suffix from `firstKeptEntryId`
   (`agent-core/src/harness/session/session.ts` `buildSessionContext`). So both params name
   the point where the verbatim tail begins:
   - `toLeafId` (summarize up to here) => summarize `[start .. toLeafId]`, keep
     `(toLeafId .. tail]`; the selected entry is folded into the summary.
   - `fromLeafId` (summarize from here) => keep `[fromLeafId .. tail]` verbatim, summarize
     everything strictly before it; the selected entry is the first kept entry.
   This is a deliberate difference from Claude Code's wording ("summarize the newer side"):
   that direction is *not representable* in this model, because the summary is always emitted
   before the retained tail, so a range only ever summarizes a prefix and keeps the newer
   side byte-identical. Recording it is the "state a deliberate difference" option; no
   context-builder change is implied.
2. **Addressable unit is the transcript entry id**, identical to `sessions.fork`'s
   `fromLeafId` (#180). Both surfaces resolve entry ids through the same branch walk, so a
   user-message id is never accepted as a boundary.
3. **Safeguard interaction stays on the existing policy, with one hard guard.** A range
   compaction can only *lengthen* the verbatim tail relative to the pipeline's own
   `firstKeptEntryId`; if the requested keep boundary is newer than the pipeline's computed
   boundary the range is not fully summarized and entries would be lost, so the handler must
   fail closed against the written checkpoint instead of shipping the partial result. No new
   schema field and no frozen-default change; the existing pressure check keeps its behaviour.

## Implementation status (2026-10-13)

Implemented (agent-driven). The gateway surface, the pipeline cut-point override, the
host-api / main bridge, and the per-message UI entry points are in place:

- `CompactionSettings.keepFromEntryId` pins the retained tail; `prepareCompaction` validates
  it against the active branch (absent / off-branch / not a valid cut point fail closed) and
  summarizes only the prefix. `agent-session.compact(custom, { keepFromEntryId })` threads it,
  and the manual hardening step is skipped when a located boundary is set.
- `sessions.compactRange` accepts `key` plus exactly one of `fromLeafId` / `toLeafId`,
  resolves the keep boundary against the active branch (`resolveRangeCompactionKeepEntry`),
  and delegates to the single `sessions.compact` path so the validated pipeline, the
  pre-operation checkpoint, and the admission rules are shared. A boundary that is absent,
  off-branch, or that leaves an empty retained tail fails closed.
- `sessions.compactRange` is exposed through `shared/host-api/contract.ts`,
  `electron/services/sessions-api.ts`, and `src/lib/host-api.ts`; the user-message hover bar
  offers "Summarize up to here" / "Summarize from here" (i18n in en/zh/ja/ru).

Verified locally: `prepare-compaction.test.ts` (cut-point pin + fail-closed),
`sessions.compaction-range.test.ts` (boundary resolution), `host-services.test.ts` (host
proxy), and `tests/e2e/chat-session-compact-range.spec.ts` (hover action -> host call).
`tsgo` node/web/test + core, `i18n:lint`, and eslint are clean.

Byte-identity: `ranged-compaction-transcript.test.ts` drives the real transcript state and
writer with the cut point `prepareCompaction` selects for an explicit `keepFromEntryId`, and
asserts that every original entry (header + all messages) is byte-identical after the write -
only the new compaction entry is appended. This covers the "untouched side is proven
byte-identical by a test" acceptance item at the transcript-surgery layer; the LLM summary
step itself is the existing pipeline and is not re-tested here.

## Non-goals

- Do not change compaction defaults, thresholds, or the whole-session path's behaviour.
- Do not add a parallel message-replacement mechanism: reuse the existing replacement and
  seal-attribution surfaces.
- Do not attempt to make the compaction lossless — `compaction-damage-rules` already records
  that it is not; the point of a range is to *limit* what is touched.