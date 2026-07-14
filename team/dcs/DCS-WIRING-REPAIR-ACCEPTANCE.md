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
| D3 | workspace fingerprint / invalidate | **CONFIRMED closed (slice)** + residual chain | W6 |
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

### D3 - CONFIRMED closed (vertical slice) + residual

**Closed:**

- `computeWorkspaceFingerprint` + in-memory session bind + invalidate `working-memory:${sessionId}` on mismatch.
- Production embedded attempt call site: `run/attempt.ts:1244-1264`.
- Counters: `workspaceScopeInvalidated` / `workspaceScopeBound` in `dcs-observability.ts`.
- Tests: `workspace-fingerprint.test.ts`.

**Residual (not closed):**

- Chat->Main `normalizeRootPath` fingerprint producer not wired (`electron/services/workspaces-api.ts` path).
- No Gateway `chat.send` fingerprint field; attempt uses `effectiveWorkspace` local authority.
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
| High D3 | SLICE LIVE; full Chat authority chain residual |
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
