# DCS Wiring Repair Dispatch (D1-D8)

**Date**: 2026-07-14  
**Purpose**: Turn DCS from "infrastructure + unit green" into "production wiring live".  
**Status board source of truth for debt**: acceptance audit 2026-07-14 (D1-D8).  
**Repo**: `C:\Users\27933\Desktop\clawx\ClawX`  
**Branch policy**: stay on `main`; no worktree, rebase, reset, stash, push unless operator asks.

## Bottom line (do not re-debate)

- Infrastructure ready = TRUE (handlers, assembler, flags, large unit suite).
- Stage 2 / Stage 5 product revenue ready = FALSE.
- Fatal opens: **D1** (fake tool names in prompts) + **D2** (phase producer never called; attempt does not pass DCS deps).
- High: D3 fingerprint missing, D4 SEKB island, D5 empty toolEntries, D6 flags default false / no real E2E.
- Med: D7 dual-injection observability only declares budget constant.
- Low: D8 bookkeeping mostly fixed; some ROUND COMPLETE docs over-claim producers.

## Fixed constraints (every window)

1. Read before coding:
   - `AGENTS.md`
   - `team/dcs/dcs-v1.6-spec.md`
   - `team/dcs/dcs-v1.6.1-addendum.md`
   - `team/dcs/README.md`
   - this file
   - relevant ROUND COMPLETE honesty sections
2. Stay on `main`. No branch/worktree/rebase/reset/stash/push.
3. Serial `pnpm` / Vitest only.
4. Commits only via `openclaw_runtime/scripts/committer` + explicit file list.
5. No unrelated refactors. No new Settings/UI/host-api control plane. No blanket lint suppressions. No skip/weaken assertions for green.
6. Default flags stay **false** unless a window explicitly enables them inside tests/E2E only.
7. Prefer minimal production wiring over new abstraction layers.
8. Every COMPLETE report must include an honest line:
   - `production wiring status: <dead|partial|live>`
   - list of remaining open callers / missing E2E

## Recommended window order

| Window | Code | Scope | Exit criteria |
|---|---|---|---|
| W1 | D2 + attempt wiring | Phase producer + factory deps | production can write task_state |
| W2 | D1 | Agent tools context_read/search/write | tools callable; no fake-only instruction |
| W3 | D5 | Real toolEntries into tool_registry | flag-on writes real registry Block |
| W4 | D4 | SEKB install + confirm_and_save production path | experience Block can be written |
| W5 | D6 | Real Windows Electron/Gateway E2E off/on | one real spawn path evidence |
| W6 | D3+D7 (+docs) | fingerprint slice + observability counters + honest docs | residual debt closed or explicitly deferred |

Do **not** parallelize W1/W2/W3 on the same files (`extensions.ts`, `attempt.ts`). Serial only.

---

# WINDOW PROMPT W1 — D2 Task phase producer + attempt DCS deps

Copy everything below the line into a new Codex window.

---
/goal no budget cap

# DCS W1: D2 fatal repair — task_phase_change producer + attempt wiring

## Mission
Make Stage 2 *writable* on the real product path:

1. A real TaskLoop / runtime phase transition must call `runAgentHarnessTaskPhaseChangeHook`.
2. Embedded attempt must pass DCS runtime deps into `buildEmbeddedExtensionFactories` so task-state factory can set handler config and (when applicable) child handoff.

Do **not** implement context_* agent tools yet (W2). Do **not** invent UI.

## Mandatory reading
- AGENTS.md
- team/dcs/DCS-WIRING-REPAIR-DISPATCH.md (this file)
- team/dcs/dcs-v1.6-spec.md (Stage 2 / task_state / HandoffPack)
- team/dcs/dcs-v1.6.1-addendum.md
- openclaw_runtime/src/agents/harness/lifecycle-hook-helpers.ts
- openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts
- openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
- openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts (~2190 factory call)
- openclaw_runtime/src/agents/task-loop-controller.ts (`runtimeTaskStatusForTaskLoop`, lifecycle shadow emitters)
- openclaw_runtime/src/plugins/hook-types.ts (`PluginHookTaskPhaseChangeEvent`)

## Known broken facts (treat as true)
- `runAgentHarnessTaskPhaseChangeHook` has **zero production callers** (tests only).
- `plugin-sdk/agent-harness-runtime.ts` does not re-export it.
- `task-loop-controller` maps phase→RuntimeTaskStatus and emits **shadow** events only; never task_phase_change.
- Production `buildEmbeddedExtensionFactories({...})` in attempt.ts passes only cfg/session/model — no sink/store/toolEntries/trajectory/objective/parentSessionId.
- `buildTaskStateFactory` returns undefined when no sink and no store.

## Implementation requirements

### A. Production phase producer
- Choose the **single authoritative** phase transition site already owned by TaskLoop / harness lifecycle (prefer reusing existing lifecycle transition points; do not invent a second bus).
- On each meaningful status change, call once:
  `runAgentHarnessTaskPhaseChangeHook({ event: { sessionId, taskId, fromStatus, toStatus }, ctx, hookRunner? })`
- Map statuses through existing `RuntimeTaskStatus` (reuse `runtimeTaskStatusForTaskLoop` or equivalent). Do not invent a parallel status enum.
- Exactly-once per transition (no double fire on shadow + primary).
- Failures: log/warn; never crash TaskLoop.

### B. Attempt factory deps
In `attempt.ts` (and compact path if it also builds factories and needs parity for session restore):
- Construct or resolve:
  - BlockStore-backed `workingMemoryStore` (or shared session store)
  - `contextBlockSink` via `createContextBlockSink`
  - when available: `objective`, `parentSessionId`, `trajectoryCapture`
- Pass them into `buildEmbeddedExtensionFactories`.
- Do **not** hard-enable feature flags.

### C. Tests (must prove production wiring, not only helpers)
Add/adjust tests that fail if caller is removed:
1. TaskLoop / lifecycle unit: phase transition invokes `runAgentHarnessTaskPhaseChangeHook` once with correct from/to.
2. Attempt/factory wiring unit or characterization: production builder path supplies sink/store so `getTaskStateHandlerConfig()` is set.
3. Existing task-state / harness-integration tests still pass.
4. Negative: when sink missing, behavior remains safe (no throw).

### D. Out of scope for W1
- context_read/search/write agent tool registration (W2)
- toolEntries fill (W3)
- SEKB install hooks production (W4)
- Electron E2E (W5)
- workspace fingerprint (W6)
- Settings / i18n / host-api

## Gates (serial, all exit 0)
- focused vitest for touched paths
- `pnpm run test:dcs`
- `pnpm run typecheck` (or runtime-scoped typecheck if already the project pattern)
- `pnpm run lint:dcs`
- if attempt/task-loop touched broadly: relevant agents vitest config

## Commit
Use committer helper + explicit files:
`fix(runtime): wire dcs task_phase_change producer`

## Deliverable
Write `team/dcs/DCS-W1-COMPLETE.md` with:
- file:line for producer call site
- file:line for attempt factory deps
- test commands + exit codes
- honest line: `production wiring status: partial` (tools still missing)
- remaining debt: D1 D3 D4 D5 D6 D7

## Done only if
- Critical=0 Important=0
- producer call site exists outside tests
- attempt passes sink/store
- gates exit 0
- COMPLETE report on disk

---

# WINDOW PROMPT W2 — D1 Register context tools

Copy everything below the line into a new Codex window **after W1 lands**.

---
/goal no budget cap

# DCS W2: D1 fatal repair — register context_read / context_search / context_write as real agent tools

## Mission
Stop instructing agents to call non-existent tools. Implement and register real agent-callable tools that wrap existing library functions, then keep CHILD_CONTEXT_READ_INSTRUCTION only if the tool truly exists.

## Mandatory reading
- team/dcs/DCS-WIRING-REPAIR-DISPATCH.md
- team/dcs/DCS-W1-COMPLETE.md (must exist and claim producer partial)
- dcs-v1.6-spec Stage 5 tool section
- openclaw_runtime/src/context-engine/tools/context-search-tool.ts
- openclaw_runtime/src/context-engine/tools/context-write-tool.ts
- openclaw_runtime/src/context-engine/handlers/task-loop-handler.ts (CHILD_CONTEXT_READ_INSTRUCTION)
- openclaw_runtime/src/agents/agent-tools.ts / openclaw-tools.ts tool assembly
- openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts tool creation path

## Known broken facts
- Only library exports `searchContext` / `writeContext` exist; **no** `context_read` implementation file.
- No agent tool catalog registration for `context_read|context_search|context_write`.
- Child prompt still says use `context_read` tool.
- tool_registry / knowledge summaries advertise expand_tool names that are not registered.

## Implementation requirements
1. Implement `context_read` as an agent tool (not only a free function):
   - Read named Block types needed by Stage 2/3 (`task_state`, `tool_registry`, and any spec-required targets).
   - Use BlockStore / session-scoped query APIs already in tree.
   - Enforce session authorization rules already used by BlockStore (do not bypass).
2. Wrap `searchContext` → agent tool `context_search`.
3. Wrap `writeContext` → agent tool `context_write` (ANTI-7 whitelist + write_origin already in library).
4. Register tools in the same production tool assembly path used by embedded coding runs (not a dead plugin-only path).
5. Wire tool runtime deps (blockStore, contextBlockSink, sessionId) from attempt/session context — no global mutable hacks beyond existing patterns.
6. Tests:
   - unit: each tool schema + happy path + auth/reject path
   - registration test: tool names appear in production tool list builder
   - child instruction test: instruction remains accurate only because tool exists
7. Do not change CodeGraph tools, DCS injection protocol, or flag defaults.

## Gates
- tool unit tests
- `pnpm run test:dcs`
- typecheck + lint:dcs
- any agent-tools focused tests touched

## Commit
`feat(runtime): register dcs context agent tools`

## Deliverable
`team/dcs/DCS-W2-COMPLETE.md`
- tool registration file:line
- proof names appear in production catalog builder
- honest: D2 may be live, D1 now live for tools; D4/D5 still open

## Done only if
- agent can invoke three tools in unit/integration without mocks of the catalog itself
- no remaining "use context_read" instruction without registration
- gates exit 0

---

# WINDOW PROMPT W3 — D5 tool_registry real entries

Copy after W2.

---
/goal no budget cap

# DCS W3: D5 repair — pass real toolEntries into tool_registry factory

## Mission
When `runtime.contextBlock.tool-registry.enabled === true`, production before_agent_start must write a `tool_registry` Block built from the **actual** agent tool list for that attempt.

## Mandatory reading
- team/dcs/DCS-WIRING-REPAIR-DISPATCH.md
- W1/W2 COMPLETE
- openclaw_runtime/src/context-engine/handlers/tool-registry-handler.ts
- openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts (`buildToolRegistryFactory`)
- attempt.ts tool assembly site (tools list after normalize)

## Requirements
1. Map production tools → `ToolRegistryEntry[]` (name, description/schema summary as handler expects).
2. Pass `toolEntries` + `contextBlockSink` into `buildEmbeddedExtensionFactories`.
3. Keep factory omission when flag off / missing deps.
4. Tests: flag on + real entries → sink receives tool_registry; flag off → no write; empty tools → safe behavior.
5. No UI. Flags default remain false.

## Commit
`feat(runtime): wire tool_registry entries from agent tools`

## Deliverable
`team/dcs/DCS-W3-COMPLETE.md`

---

# WINDOW PROMPT W4 — D4 SEKB production bridge

Copy after W3.

---
/goal no budget cap

# DCS W4: D4 repair — SEKB experience bridge production callers

## Mission
Make SEKB no longer an island:
1. Production path can install SEKB harness hooks **when explicitly enabled** (config/env already preferred; no new Settings UI).
2. `DistillationTool.confirm_and_save` production call sites that already exist or are the natural distillation completion path must pass `{ contextBlockSink, sessionId }` when available.
3. Terminal phase trajectory capture receives a real `trajectoryCapture` instance when SEKB enabled (ties to W1 config).

## Mandatory reading
- team/dcs/DCS-WIRING-REPAIR-DISPATCH.md
- team/dcs/DCS-ROUND6-COMPLETE.md Not delivered section
- harness/specs/tasks/dcs-stage5-sekb-closure.md
- openclaw_runtime/src/knowledge/sekb/*

## Requirements
- Keep ANTI-7 / ANTI-8.
- Best-effort sink failures must not break SEKB save.
- Tests prove: install called under enablement; confirm_and_save writes experience Block through sink on production-shaped call path.
- Still no full Electron E2E (W5).

## Commit
`feat(runtime): connect sekb experience bridge to production path`

## Deliverable
`team/dcs/DCS-W4-COMPLETE.md`

---

# WINDOW PROMPT W5 — D6 real product E2E

Copy after W4.

---
/goal no budget cap

# DCS W5: D6 repair — real Windows product E2E for DCS wiring

## Mission
Prove one real path (prefer Windows Electron + Gateway coding chat, or the closest existing real harness already used by T3 CodeGraph E2E patterns):

### Cases
1. Flags default off: no DCS always-on leakage; tools may exist but Blocks not forced.
2. Flags on (test-only env/config): working_memory and/or tool_registry and/or task_state observable in store after real actions.
3. context_read/search/write callable for non-destructive reads; write respects whitelist.
4. Explicit SEKB off remains off; if SEKB on fixture exists, experience write optional.
5. Record counts: tools total, schema chars/UTF-8 bytes if useful — **E2E helper only**, no production metrics framework.

## Requirements
- No mock BlockStore for the primary evidence case.
- No skip to green.
- Reuse T3 E2E patterns where possible; do not regress CodeGraph 15-tool suite.

## Commit
`test(e2e): prove dcs production wiring on windows path`

## Deliverable
`team/dcs/DCS-W5-COMPLETE.md` with raw command results.

---

# WINDOW PROMPT W6 — D3 fingerprint + D7 observability + honesty docs

Copy after W5 (or parallel only if no file overlap with open windows).

---
/goal no budget cap

# DCS W6: D3 + D7 + docs honesty

## Mission
1. D3: implement the minimal workspace authority fingerprint / invalidate path deferred from R2 (do not boil the ocean; follow addendum + coding-runtime-workspace task facts). If still too large, deliver a vertical slice with honest NOT DONE remainder — do not claim COMPLETE for unfinished fingerprint.
2. D7: dual-injection observability counters for CVK systemPromptAddition vs DCS transformContext/assembler injection (char counts + duplicate suppression count). Use existing observability base; no fake dashboard.
3. Docs: update team/dcs/README.md and external DCS-ROUND-DISPATCH status for wiring repair; correct over-claims that "producer PASS" meant production caller.

## Commit(s)
- `feat(runtime): dcs workspace fingerprint slice` (if code)
- `feat(runtime): dcs dual-injection observability`
- `docs(dcs): record wiring repair acceptance`

## Deliverable
`team/dcs/DCS-W6-COMPLETE.md` + final `team/dcs/DCS-WIRING-REPAIR-ACCEPTANCE.md` summarizing D1-D8 final state.

---

# Operator checklist (preview)

Before opening windows:
- [ ] main clean enough or known dirty files unrelated
- [ ] pnpm install already healthy
- [ ] this dispatch file committed or at least saved on disk for handoff
- [ ] open **one** window at a time: W1 → W2 → W3 → W4 → W5 → W6

Success definition for whole program:
- D1/D2 no longer fatal
- D4/D5 have production callers
- D6 has at least one real E2E evidence pack
- D3/D7 either live or explicitly residual with file:line
- worktree clean after final docs commit
