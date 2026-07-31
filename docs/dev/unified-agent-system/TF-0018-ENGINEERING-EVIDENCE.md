# TF-0018 UAS-07 Engineering Evidence

## Qualification

This document records engineering evidence only. It does not close TF-0017,
TF-0018, or TF-0019; it does not change frozen locks; and it contains no real
cohort, provider-cost, soak, ROI, or graduation evidence.

Runtime Memory remains independent from SEKB: Role Memory uses its own SQLite
store, while SEKB uses the OpenClaw state database. Runtime Memory remains
proposal-first and its write/use gates default to off.

## Acceptance Evidence

| Acceptance criterion | Implementation evidence | Test evidence |
| --- | --- | --- |
| Unapproved candidates cannot persist | `memory-store.ts:513` identifies automatic sources; `memory-store.ts:517` converts an otherwise accepted automatic proposal to `needs_review`; `memory-store.ts:877` stores the proposal record and only writes a card at `memory-store.ts:900` for an accepted decision. | `tests/unit/tf0018-automatic-proposal-no-persist.test.ts:28` proves a trace-origin proposal remains review-only and durable cards remain empty. |
| Corrections and deletions propagate to later context | `shared/types/memory.ts:74` and `memory/types.ts:68` expose `correctionRef`; `memory-store.ts:244`, `267`, `412`, `455`, and `488` migrate, deserialize, and serialize it. Update/archive set it at `memory-store.ts:961` and `1023`; supersede links both cards at `1040` and `1048`; reviewed proposals pass it at `1236` and `1259`; poison revoke creates and stores an applied tombstone reference at `1641`, `1687`, and `1691`. | `tests/unit/tf0018-correction-propagation.test.ts:32` proves superseded and tombstoned cards are not injected, current/reviewed cards are injected, and the correction reference points to an applied tombstone proposal. |
| Conflicting facts do not silently overwrite | `gatekeeper.ts:142` normalizes scope identities; `gatekeeper.ts:151` prevents cross-key conflict comparison; `gatekeeper.ts:364` turns a contradiction into a review conflict rather than an accepted replacement. | `tests/unit/tf0018-conflict-no-silent-overwrite.test.ts:29` proves both `is not` to `is` and reverse-polarity contradictions remain `needs_review`, record an open conflict, and leave the active fact unchanged. |
| Workspace and session cross-contamination is zero | `memory-card.ts:38` applies exact-match, fail-closed filtering to keyed workspace, session, task, and project cards. The role-memory provider applies it at `role-memory-context-provider.ts:172` and `184`; chat-turn wiring carries session/workspace/task context at `chat-turn-memory-injection.ts:229` and `context-orchestrator.ts:448`; role-spawn applies the same filter at `role-spawn.ts:176` and `192`. | `tests/unit/tf0018-cross-workspace-session-isolation.test.ts:28` proves each turn receives only its own workspace and session cards. `tests/unit/role-spawn.test.ts` covers the role-spawn injection path. |
| SEKB automatic writeback is zero | `knowledge/sekb/golden-path.ts:73` declares `autoWriteback: false`; the explicit confirm path is documented and invoked at `golden-path.ts:220`. | `tests/unit/tf0018-sekb-no-auto-writeback.test.ts:21-55` proves distillation creates suggestions without persisting a principle until `confirm_and_save` is explicitly called. |

## Scope-Safety Rules

- A `workspace`, `session`, or `task` card requires both a non-empty scope key
  and an exact context match.
- A keyed `project` card requires an exact workspace match.
- An unkeyed workspace/session/task card does not inject; a role/global card
  keeps its existing non-keyed behavior.
- `archived`, `tombstone`, superseded, and expired cards are excluded by the
  normal injectable-card checks.
- Context and conflict filtering are fail-closed. Missing turn scope cannot
  widen access to a keyed card or a conflict that only names another scoped
  card.

## Validation Results

- `pnpm run typecheck` passed: the generated extension bridge plus both node
  and web TypeScript projects exited with zero errors.
- `pnpm test` passed: the main suite reported `6479 passed, 52 skipped`; the
  isolated permissions/runtime-memory stage reported `25 passed`; and the
  three OpenClaw runtime DCS stages reported `20/229`, `5/10`, and `10/79`
  passing files/tests respectively.
- The focused TF-0018 command over the five acceptance tests and
  `tests/unit/role-spawn.test.ts` passed: `6 files, 24 tests`.
- `pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config
  test/vitest/vitest.unit.config.ts src/context-engine/chat-turn-memory-injection.test.ts`
  passed: `1 file, 1 test`.

These outcomes establish engineering coverage only; they do not assert Task
Forest closure or real-cohort qualification.

## Explicit Non-Claims

- No autonomous Runtime Memory writeback was added.
- No Runtime Memory data was moved into VerseShell.
- No SEKB auto-writeback was added.
- No Task Forest node state, `liveReady`, `productApproved`, or `defaultOn`
  value is changed by this work.
- No real cohort evidence or product graduation conclusion is asserted.
