# DCS W6 COMPLETE - D3 fingerprint slice + D7 dual-injection observability + docs honesty

**Date**: 2026-07-14  
**Window**: W6 / D3 + D7 + docs  
**Commits** (via committer + explicit file lists):
- 8e50a751c feat(runtime): dcs workspace fingerprint and dual-injection observability (D3+D7 co-landed: shared attempt.ts + dcs-observability)
- a463d6f37 docs(dcs): record wiring repair acceptance
- 612ab830d docs(dcs): note w6 commit SHAs
- 0191e54c0 docs(dcs): fix w6 acceptance encoding

## Result

Critical: **0**. Important: **0**.

production wiring status: **partial-live** (D3 vertical slice live on embedded attempt; full Chat->Main trusted-root propagation residual)

## Goal

1. **D3**: land the R2-deferred minimal workspace authority fingerprint / invalidate vertical slice (invalidate-no-schema decision).
2. **D7**: record actual character counts + exactly-once suppression counts for CVK `systemPromptAddition` and DCS transformContext/assembler injection (reuse in-memory counter base; no fake dashboard).
3. **Docs**: honest wiring-repair status; close D1-D8 acceptance table with residuals where true.

## D3 - workspace fingerprint slice (LIVE, partial)

### What is live

| Piece | Location |
|-------|----------|
| Fingerprint compute | `openclaw_runtime/src/context-engine/workspace-fingerprint.ts:36` ? `computeWorkspaceFingerprint` = sha256(normalized absolute root).slice(0,16) |
| Session bind + invalidate | `workspace-fingerprint.ts:69` ? `bindSessionWorkspaceFingerprint` |
| Counter | `dcs-observability.ts` ? `workspaceScopeInvalidated` / `workspaceScopeBound` |
| Production call site | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:1244-1264` ? after DCS deps resolve, bind `effectiveWorkspace` fingerprint; mismatch ? `workingMemoryStore.invalidate('working-memory:'+sessionId)` |
| Store capability | `dcs-extension-deps.ts` ? `workingMemoryStore` Pick includes `invalidate` |

Behavior:

- In-memory last fingerprint per `sessionKey` (not BlockStore schema, not openclaw.json).
- Missing/empty fingerprint ? skip (agent-config fallback path; no false invalidation).
- Mismatch -> invalidate `working-memory:${sessionId}` then re-bind; counts `workspace_scope_invalidated`.
- Optional `enqueue` preserves S1-B same-session queue semantics for callers that pass it.

### NOT DONE / residual (honest)

| Residual | file:line / note |
|----------|------------------|
| Chat->Main trusted rootPath fingerprint producer | `src/stores/chat.ts` / `electron/services/chat-api.ts` / `electron/services/workspaces-api.ts` `normalizeRootPath` ? not wired this window |
| Gateway `chat.send` fingerprint field | `openclaw_runtime/src/gateway/server-methods/chat.ts` / `get-reply.ts` ? not added |
| ACP cwd passthrough observability label | decision open point; not instrumented as `acp_cwd_passthrough` |
| Matched A/B isolation E2E for workspace switch | not in W5 suite; still residual |
| Cross-process fingerprint persistence | intentionally out of scope (decision: memory only) |

Fingerprint authority today is **runtime effectiveWorkspace** on embedded attempt, not yet the full Main-resolved workspaceId chain.

## D7 - dual-injection observability (LIVE)

| Channel | Call site | Counter API |
|---------|-----------|-------------|
| CVK `systemPromptAddition` | `attempt.ts:3176` after context-engine assemble | `dcsObservability.recordCvkSystemPromptAddition(chars)` |
| DCS transformContext / assembler | `assembler.ts` `#appendWorkingMemory` / `#appendToolRegistry` / `#appendKnowledge` | `recordDcsTransformContextInjection({ chars, suppressed? })` |
| Exactly-once suppress | same append paths when heading already present | `injectionDuplicateSuppressions` |
| Budget constant (pre-existing) | `assembler.ts` `KNOWLEDGE_INJECTION_CHAR_BUDGET = 2000` | declared ceiling only; no cross-point dynamic trim (addendum 6) |

In-memory registry: `openclaw_runtime/src/context-engine/dcs-observability.ts` (same pattern as deprecation-counters; snapshot/reset; not a product dashboard).

## Tests

| File | Proof |
|------|-------|
| `workspace-fingerprint.test.ts` | bind / unchanged / invalidate+counter / enqueue path / skip empty fingerprint |
| `dcs-observability.test.ts` | CVK chars, DCS chars, suppression increment, detached snapshot |
| `assembler.test.ts` | dual-injection assemble records chars + exactly one suppression on second point |

## Gates (all exit 0)

| Gate | Exit | Notes |
|------|------|-------|
| Focused unit (3 files) | **0** | 45 tests |
| `pnpm run test:dcs` | **0** | unit 16/163 + runtime-config 5/10 + agents 10/57 |
| `pnpm run lint:dcs` | **0** | type-aware oxlint |
| `pnpm run typecheck` | **0** | node + web |

## production wiring status: partial-live

- D1 tools, D2 phase producer, D3 fingerprint slice, D4 SEKB path, D5 toolEntries, D6 E2E, D7 counters: closed or live as listed in `DCS-WIRING-REPAIR-ACCEPTANCE.md`.
- Remaining product residual: full Chat workspace authority chain + optional SEKB-on E2E + A/B isolation E2E.

## Honesty corrections

- **Producer unit PASS != production caller.** R2 producer envelope unit green only proved tool success paths emit envelopes; production attempt/tool assembly must still be verified separately (W1-W5 did that for phase/tools/registry/SEKB/E2E).
- **Infrastructure green != Stage 2/5 revenue ready.** Flags remain default false; SEKB default off.
- **Fingerprint COMPLETE for this window means the vertical slice**, not the full R2 path-map Chat?Main?Gateway chain.

## Remaining residual debt after W6

1. Full workspace authority propagation (Chat workspaceId ? Main rootPath fingerprint ? Gateway ? get-reply ? attempt) ? residual above.
2. Optional SEKB-on Electron experience write E2E (W5 kept SEKB off).
3. No Settings/UI control plane for DCS flags (intentional).
