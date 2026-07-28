# TASK-P1-02: working-memory injection actually lands in prompt

| field | value |
|-------|-------|
| **id** | `TASK-P1-02` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `backlog` |
| **blockedBy** | TASK-P0-01 |
| **owner** | TBD |
| **gapRefs** | GAP-P1-02, M-01 |
| **estimate** | 1-2w |
| **lastUpdated** | 2026-07-22 |

## Goal (user-visible outcome)
When working-memory is on, long sessions show real injection (exactly-once); off restores baseline bytes.

## Why this exists
Part of dcs-visible-production: visible features must be production-usable, not shelfware.

## Non-goals
- Joint-system GA claims
- Flipping unrelated flags
- Scope expansion beyond this task

## Context / code anchors
- `assembler.ts` DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS working_memory false
- producers edit/write/apply_patch envelopes
- `handlers/working-memory-handler.ts`

## Acceptance criteria
- [ ] Settings/config on -> injection observable (snapshot or e2e)
- [ ] exactly-once / budget safe
- [ ] long-session soak note (short 1h ok first)
- [ ] kill works

## Implementation slices (one PR / one session each)
1. config key kebab/snake + UI
2. injection visibility harness
3. token budget/dedup regression
4. human long-session record
5. docs

## Test / evidence commands
```powershell
# fill when implementing
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | task doc persisted; implementation not started |
| 2026-07-25 | D3 closeout | done | Chat→Main→Gateway workspace fingerprint chain wired: Main produces trusted `workspaceFingerprint` from workspace rootPath (`shared/workspace-fingerprint.ts:30` + `electron/services/workspaces-api.ts:470` + `electron/services/chat-api.ts:448-457`) and forwards it via Gateway `chat.send` schema field (`openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts:92`); runtime mirrors the same pure helper locally (`openclaw_runtime/src/context-engine/workspace-fingerprint.ts:44`) so embedded attempt binds the same authority fingerprint. TDD: 5 chat-api tests + 4 schema tests + 7 runtime fingerprint tests all green. No flag defaults changed; no new config surface. Hardens the working-memory invalidation this task depends on. See `team/dcs/DCS-WIRING-REPAIR-ACCEPTANCE.md` D3. |
| 2026-07-25 | D3 closeout (consumer) | done | Consumer-side wiring landed: Gateway `chat.send` reads `params.workspaceFingerprint` into `ctx.WorkspaceFingerprint` (`openclaw_runtime/src/gateway/server-methods/chat.ts:3243`, `:4033`); `MsgContext` carries the field (`openclaw_runtime/src/auto-reply/templating.ts:330`); `FollowupRun.run.workspaceFingerprint` carries it (`openclaw_runtime/src/auto-reply/reply/queue/types.ts:114`); `runPreparedReply` injects ctx→run (`openclaw_runtime/src/auto-reply/reply/get-reply-run.ts:1331`); `buildEmbeddedRunBaseParams` forwards run→`RunEmbeddedAgentParams.workspaceFingerprint` (`openclaw_runtime/src/auto-reply/reply/agent-runner-run-params.ts:87`, `openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts:122`); embedded attempt prefers the trusted fingerprint via `resolveTrustedWorkspaceFingerprint` (`openclaw_runtime/src/context-engine/workspace-fingerprint.ts:82`, consumed at `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:1267`), preserving `bindSessionWorkspaceFingerprint` mismatch-invalidate `working-memory:${sessionId}` semantics + `workspaceScopeInvalidated` counter. TDD: 5 new consumer-side tests (trusted preferred, fallback on undefined/empty, empty-on-empty, trusted drives invalidate on mismatch) added RED-first then turned GREEN; total 12 fingerprint tests green. No flag defaults changed; no new config surface. Closes整改要求 ①. See `team/dcs/DCS-WIRING-REPAIR-ACCEPTANCE.md` D3 consumer-side section. |

## Handoff notes (for next agent)
- Read `../STATUS.md` first; only implement slices marked next.
- Keep this file updated; keep STATUS.md metadata-only.
- Link commits/PRs here when they exist.

## Hard locks (do not violate)
- Do not flip production defaults to "prove usable".
- SEKB: no auto writeback / cutoverAllowed stays false unless separate product policy change.
- Browser private network default deny.
- packaging path: defaultsUnchanged; no auto default-on.
- Prefer Settings/config-sync over env-only expert paths for end-state UX.
