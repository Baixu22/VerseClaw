# DCS Wiring Repair Acceptance (D1-D8)

**Date**: 2026-07-14  
**Source windows**: W1-W6 COMPLETE reports under `team/dcs/`  
**Repo**: `C:\\Users\\27933\\Desktop\\clawx\\ClawX`  
**Authority**: acceptance closes a debt only when production wiring (or an explicit residual with file:line) is evidenced - unit green alone is not enough.

## Summary

| ID | Topic | Status | Window |
|----|-------|--------|--------|
| D1 | Fake tool names / missing context_* agent tools | **CONFIRMED closed** | W2 |
| D2 | Phase producer never called; attempt DCS deps missing | **CONFIRMED closed** | W1 |
| D3 | workspace fingerprint / invalidate | **CONFIRMED closed** (slice + Chat→Main→Gateway producer chain + consumer-side attempt trusted-fingerprint wiring) | W6 |
| D4 | SEKB island | **CONFIRMED closed (flag-gated)** | W4 |
| D5 | empty toolEntries | **CONFIRMED closed** | W3 |
| D6 | flags default false / no real E2E | **CONFIRMED closed (E2E)**; defaults remain false | W5 |
| D7 | dual-injection observability | **CONFIRMED closed** | W6 |
| D8 | bookkeeping / over-claim producers | **CONFIRMED closed** (honesty in W6 docs) | W6 |

## Per-debt detail

### D1 - CONFIRMED closed

- Agent tools `context_read` / `context_search` / `context_write` registered on production coding tool assembly (W2).
- Evidence: `DCS-W2-COMPLETE.md`; unit + tool registration tests.

### D2 - CONFIRMED closed

- TaskLoop phase transition calls `runAgentHarnessTaskPhaseChangeHook` (W1).
- Attempt/compact pass sink/store into `buildEmbeddedExtensionFactories` via `resolveEmbeddedDcsExtensionDeps`.
- Evidence: `DCS-W1-COMPLETE.md`; `task-loop-controller.ts` emit path; `dcs-extension-deps.ts`.

### D3 - CONFIRMED closed (vertical slice + Chat→Main→Gateway producer chain + consumer-side attempt wiring)

**Closed (vertical slice, W6):**

- `computeWorkspaceFingerprint` + in-memory session bind + invalidate `working-memory:${sessionId}` on mismatch.
- Production embedded attempt call site: `run/attempt.ts:1244-1264`.
- Counters: `workspaceScopeInvalidated` / `workspaceScopeBound` in `dcs-observability.ts`.
- Tests: `workspace-fingerprint.test.ts`.

**Closed (Chat→Main→Gateway chain, D3 closeout 2026-07-25):**

- Chat→Main `normalizeRootPath` fingerprint producer wired: Main now looks up the workspace's rootPath via `getWorkspaceRootPathById` (`electron/services/workspaces-api.ts:470`) and produces the trusted authority fingerprint via the shared `computeWorkspaceFingerprint` helper (`shared/workspace-fingerprint.ts:30`, imported at `electron/services/chat-api.ts:11-12`). The runtime mirrors the same pure function locally at `openclaw_runtime/src/context-engine/workspace-fingerprint.ts:44` so no cross-package CJS/ESM import is introduced; both copies are pinned byte-identical by tests.
- Main forwards both `workspaceId` and `workspaceFingerprint` into `chat.send` rpcParams (`electron/services/chat-api.ts:448-457`). When rootPath lookup fails, `workspaceId` is still forwarded for Task Ledger continuity but no fingerprint is produced (agent-config fallback path, no false invalidation).
- Gateway `chat.send` schema accepts `workspaceFingerprint` (`openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.ts:92`, `Type.Optional(Type.String())` under `additionalProperties: false`).
- Tests: `tests/unit/chat-api-workspace-fingerprint.test.ts` (5 cases — workspaceId forwarding, fingerprint generation/forwarding, absence when no workspaceId, absence when rootPath lookup fails, no lookup call when workspaceId absent) + `openclaw_runtime/packages/gateway-protocol/src/schema/logs-chat.test.ts` (4 cases — schema accepts fingerprint with/without workspaceId, accepts absence, rejects unknown fields).
- TDD: RED phase first (tests committed before the chat-api/schema wiring), then GREEN.
- No flag defaults changed; no new config surface; root `pnpm run typecheck:node` + `typecheck:web` green; runtime `tsgo:core` pre-existing `shared/*.ts` CommonJS/`verbatimModuleSyntax` errors unchanged and unrelated to this change.

**Closed (consumer side, D3 closeout 2026-07-25):**

- Gateway `chat.send` handler reads `params.workspaceFingerprint` and forwards it into `ctx.WorkspaceFingerprint` (`openclaw_runtime/src/gateway/server-methods/chat.ts:3243` extract, `:4033` ctx injection). Absent → agent-config fallback path (no false invalidation).
- `MsgContext` carries the trusted fingerprint field (`openclaw_runtime/src/auto-reply/templating.ts:330`, `WorkspaceFingerprint?: string`).
- `FollowupRun.run` carries the trusted fingerprint field (`openclaw_runtime/src/auto-reply/reply/queue/types.ts:114`, `workspaceFingerprint?: string`).
- `runPreparedReply` injects `ctx.WorkspaceFingerprint` into `FollowupRun.run.workspaceFingerprint` (`openclaw_runtime/src/auto-reply/reply/get-reply-run.ts:1331`).
- `buildEmbeddedRunBaseParams` forwards `run.workspaceFingerprint` into `RunEmbeddedAgentParams` (`openclaw_runtime/src/auto-reply/reply/agent-runner-run-params.ts:87`).
- `RunEmbeddedAgentParams` carries the trusted fingerprint field (`openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts:122`, `workspaceFingerprint?: string`).
- Embedded attempt prefers the trusted fingerprint over the locally computed `effectiveWorkspace` fingerprint via `resolveTrustedWorkspaceFingerprint` (`openclaw_runtime/src/context-engine/workspace-fingerprint.ts:82`, consumed at `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:1267`). `bindSessionWorkspaceFingerprint` semantics unchanged: compare against the previous session-scoped binding and invalidate `working-memory:${sessionId}` on mismatch, counting `workspaceScopeInvalidated`.
- Tests: `openclaw_runtime/src/context-engine/workspace-fingerprint.test.ts` adds 5 consumer-side cases (trusted fingerprint preferred, fallback to local compute on undefined/empty, empty-on-empty, trusted fingerprint driving invalidate on mismatch with previous binding). Total 12 cases (7 pre-existing + 5 new) all green.
- TDD: RED phase first (5 new tests failed with `resolveTrustedWorkspaceFingerprint is not a function`), then GREEN after implementing the pure helper + the ctx → FollowupRun → RunEmbeddedAgentParams → attempt wiring.
- No flag defaults changed; no new config surface; runtime `tsgo:core` shows no new errors in touched files; root `pnpm run typecheck:node` green; DCS regression suite (`workspace-fingerprint` / `chat-api-workspace-fingerprint` / `logs-chat` / `dcs-observability` / `dcs-extension-deps` / `extensions.working-memory`) all green.

**Residual (deferred, not blocking):**

- ACP `acp_cwd_passthrough` label not instrumented.
- No dedicated workspace A/B isolation E2E in this repair series.

### D4 - CONFIRMED closed (flag-gated)

- SEKB install on embedded path when enabled; `confirm_and_save` can write experience via sink; trajectoryCapture when enabled (W4).
- Default remains off (`runtime.contextBlock.sekb.enabled` / `OPENCLAW_SEKB_ENABLED`).
- Residual: no Settings UI; W5 E2E kept SEKB explicitly off (optional SEKB-on E2E).

### D5 - CONFIRMED closed

- Real `toolEntries` from attempt tool list into tool_registry producer (W3).
- Flag default false preserved.

### D6 - CONFIRMED closed (E2E evidence)

- Windows Electron/Gateway off/on E2E: `tests/e2e/dcs-production-wiring-w5.spec.ts` (W5).
- Defaults remain false in production config; test-only flags in isolated E2E home only.

### D7 - CONFIRMED closed

- CVK chars: `attempt.ts:3176` -> `recordCvkSystemPromptAddition`.
- DCS transformContext/assembler chars + suppressions: `assembler.ts` append paths -> `recordDcsTransformContextInjection`.
- Tests: `dcs-observability.test.ts` + assembler dual-injection case.
- Budget constant pre-existing: `KNOWLEDGE_INJECTION_CHAR_BUDGET` (no dynamic cross-trim per addendum 6).

### D8 - CONFIRMED closed (honesty)

- README + external dispatch + this acceptance file state post-wiring truth.
- Explicit correction: **producer unit PASS does not imply a production caller existed**; W1-W5 closed the real callers. ROUND COMPLETE docs that only had unit green for producers remain historical; do not re-read them as product-live without the W* reports.

## Honesty board (do not re-debate)

| Claim | Truth after W6 |
|-------|----------------|
| Infrastructure ready | TRUE |
| Stage 2/5 product revenue ready | FALSE (flags default off; no Settings control plane) |
| Fatal D1/D2 | CLOSED |
| High D3 | CLOSED (slice + Chat→Main→Gateway producer chain + consumer-side attempt trusted-fingerprint wiring, 2026-07-25) |
| High D4/D5/D6 | CLOSED as above |
| Med D7 | CLOSED |
| Low D8 over-claims | CORRECTED |

## Gate snapshot (W6)

| Gate | Exit |
|------|------|
| focused unit (fingerprint + observability + assembler) | 0 |
| `pnpm run test:dcs` | 0 |
| `pnpm run lint:dcs` | 0 |
| `pnpm run typecheck` | 0 |

## References

- `team/dcs/DCS-W1-COMPLETE.md` - `DCS-W6-COMPLETE.md`
- `team/dcs/DCS-WIRING-REPAIR-DISPATCH.md`
- `team/dcs/dcs-v1.6.1-addendum.md` (addendum 6)
- `C:\\Users\\27933\\Desktop\\clawx\\team\\claude\\DCS-P0-WORKSPACE-BINDING-DECISION.md`
