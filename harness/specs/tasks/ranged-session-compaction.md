---
lifecycleStatus: active
id: ranged-session-compaction
title: Compaction with a located range (summarize from here / up to here)
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Compaction is all-or-nothing — manual `sessions.compact` and the automatic safeguard both replace the whole transcript with a summary — so a user who goes wrong at turn 40 of 60 can only summarize everything (losing all original text) or start a new session (losing all context). Claude Code exposes two located variants ("summarize from here" / "summarize up to here") that keep the untouched side verbatim. This spec records the capability gap, the required gateway surface, and the constraints a range compaction must satisfy so it cannot become a second, unvalidated summary path.
touchedAreas:
  - harness/specs/tasks/ranged-session-compaction.md
  - openclaw_runtime/src/gateway/server-methods/sessions.lifecycle.ts
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/agents/agent-hooks/compaction-damage-rules.test.ts
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

## Open questions (owner input required before implementation)

1. **Where does the boundary land relative to the selected message?** "Summarize up to here"
   can include the selected turn or stop just before it. Fork hit the same question and
   resolved it as "the branch keeps everything *before* the point" (#180); compaction should
   either reuse that convention or state a deliberate difference.
2. **What is the addressable unit** — the transcript entry id (as fork uses) or a
   user-message id? Fork's `fromLeafId` is an entry id, so entry ids keep the two surfaces
   consistent.
3. **Interaction with the automatic safeguard**: after a range compaction the transcript is
   shorter, so the next pressure check may summarize the newly short transcript again. The
   policy for that (and its observability) must be decided, not inherited by accident.

## Non-goals

- Do not change compaction defaults, thresholds, or the whole-session path's behaviour.
- Do not add a parallel message-replacement mechanism: reuse the existing replacement and
  seal-attribution surfaces.
- Do not attempt to make the compaction lossless — `compaction-damage-rules` already records
  that it is not; the point of a range is to *limit* what is touched.
