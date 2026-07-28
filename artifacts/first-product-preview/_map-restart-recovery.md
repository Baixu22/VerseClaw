I have all the facts needed.

## FP-P1-05 restart/recovery + kill/rollback map

### 1. GatewayManager restart path

**Entry point:** `C:/Users/27933/Desktop/clawx/ClawX-maturity-p0/electron/gateway/manager.ts:683` `async restart()`

Sequence:
- `manager.ts:684-693` — defer check via `GatewayRestartController.isRestartDeferred` (state=`starting`/`reconnecting` or `startLock` → mark deferred, return without restarting).
- `manager.ts:695-699` — in-flight join (`restartInFlight`).
- `manager.ts:701-718` — `GatewayRestartGovernor.decide()` cooldown gate. `restart-governor.ts:14-16` cooldown is **2500 ms**; suppression emits `gateway.restart.suppressed` telemetry (`manager.ts:715-716`) and **returns success-shaped `void`** — the caller cannot distinguish "restarted" from "suppressed".
- `manager.ts:722-734` — `stop()` then `start()`. On `start()` failure: `shouldReconnect = true` + `scheduleReconnect()` then **rethrows** (`manager.ts:729-732`).
- `manager.ts:736-751` — records executed, emits `gateway.restart.executed`.
- `manager.ts:752-767` — `finally` flushes any deferred restart.

Other recovery paths: heartbeat-triggered restart at `manager.ts:1416-1417` and `manager.ts:1441-1442`; reload→restart fallbacks at `manager.ts:792-796, 815-817, 838-839, 850-852, 860-862`; cooldown constant `RESTART_COOLDOWN_MS` used at `manager.ts:1486`.

**Generation counter:** `electron/gateway/generation.ts`
- `generation.ts:12` module-level `let currentGeneration = 0` (**in-memory only — resets to 0 on every app restart**).
- `generation.ts:15-18` `nextGatewayGeneration()` bump; `generation.ts:21-23` `getCurrentGatewayGeneration()`.
- `generation.ts:10` env key `VERSE_CLAW_GATEWAY_GENERATION`.
- Stamped at spawn: `electron/gateway/process-launcher.ts:171` `stampGatewayGeneration(runtimeEnv, nextGatewayGeneration())`.
- Read by runtime: `openclaw_runtime/src/context-engine/runtime-flag-ack.ts:46` (`RUNTIME_FLAG_ACK_GENERATION_ENV = "VERSE_CLAW_GATEWAY_GENERATION"`), consumed at `runtime-flag-ack.ts:374`.
- Stale-generation guard: `electron/services/dcs-flag-ack.ts:133` — an ack whose `gatewayGeneration !== expected` is discarded (`sawStaleGeneration = true`).

**Restart triggered from RPC:** `electron/services/gateway-api.ts:362` (`gateway.restart` module action). Also `electron/main/ipc-handlers.ts:276` (proxy change), `:1172`; `electron/services/settings-api.ts:93,99`; `electron/services/agents-api.ts:89-91,247`; `electron/services/channels-api.ts:1343,1351` (debounced); `electron/services/providers/provider-runtime-sync.ts:197`.

**Flag-flip restart + ack:** `electron/services/dcs-prod-flags-api.ts:281` (`setFlag`) and `:497` (`setPreview`), each followed by `getCurrentGatewayGeneration()` at `:298` / `:354` / `:514` and `collectRuntimeFlagAck`.

**Failure handling (restart failure — drill scenario 7):** `dcs-prod-flags-api.ts:283-296` is the *only* place that converts a restart throw into a user-visible outcome: `status: 'pending-restart'`, `failureReason: 'restart-failed'`, `operatorHintKey: 'developer.dcsProdFlags.ackHint.restartFailed'`. The generic RPC path `gateway-api.ts:360-364` returns `{ success: true }` unconditionally after `await gatewayManager.restart()` and has **no failure branch** — a governor-suppressed restart returns success identically to a real one.

### 2. Kill switch semantics

`C:/Users/27933/Desktop/clawx/ClawX-maturity-p0/openclaw_runtime/src/context-engine/enhancement-kill-switch.ts`

- `:22-23` env key `VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH`; `:25-31` accepts `1|true|yes|on` → true, `0|false|no|off` → false, anything else → `null`.
- `:52-70` `isContextEnhancementKillSwitchEngaged(cfg, env)`. **Env-true short-circuits first** (`:57-58`); config `runtime.contextEnhancement.killSwitch === true` second (`:60-64`). `:66-69` catch → **returns `true` (fail-closed)**.
- Asymmetry worth noting: env `0`/`false` does **not** override a config-true kill — `envTruthy` returning `false` just falls through to the config check.
- `:75-80` `isContextEnhancementAllowed` = negation.

**Config-kill freshness (per-request):** `openclaw_runtime/src/context-engine/kill-switch-config-source.ts`
- `:46-71` `resolveKillSwitchConfig()` reads `openclaw.json` cached against `size:mtimeMs` (`:33-36`). A config write changes the stamp → next turn re-reads. **This is the mechanism that makes a mid-session config kill take effect without a restart.**
- `:23-27` `KILL_SWITCH_CONFIG_UNREADABLE` sentinel whose `runtime` getter throws → the helper's catch returns `true`.
- **Env-form kill has no equivalent live path**: `process.env` in the gateway child is fixed at spawn, so an env kill requires a gateway restart.

**Per-request consult sites:**
| Site | Line | Config source |
|---|---|---|
| `assembler.ts` `assemble()` | `:172-173` via `resolveAssembleKillSwitchConfig` (`:133-135`) | `request.cfg` else disk |
| `assembler.ts` `#appendWorkingMemory` | `:294` | passed `killCfg` |
| `assembler.ts` `#appendToolRegistry` | `:335` | passed `killCfg` |
| `assembler.ts` `#appendKnowledge` | `:385` | passed `killCfg` |
| `context-orchestrator.ts` | `:258` (ledger `killed`), `:263` (early return with `reason: "enhancement-kill-switch"`) | `cfg` param |
| `chat-turn-memory-injection.ts` `resolveMemoryInjectPilotConfig` | `:72` | `value` param |
| `chat-turn-vtoken-injection.ts` `resolveVtokenAssemblyConfig` | `:148` | `value` param |
| `attempt.ts` CVK prepend | `:3263` `isContextEnhancementKillSwitchEngaged(params.config)` | **`params.config` — a run-scoped snapshot, not the mtime-cached disk read** |
| `electron/services/vtoken-bridge.ts` | `:64-67` | env only, main-process |
| `electron/services/dcs-prod-flags-api.ts` | `:192-193` observability | env only |

**Kill effect boundary:** `openclaw_runtime/src/context-engine/turn-injection-budget.ts:137-153` — `beginTurnInjectionBudget({killed: true})` creates a **zero-total** ledger; `:142-143` returns any *existing* ledger for the same `turnId` unchanged. `turnId` is `${sessionKey}::${runId}` (`attempt.ts:1993-1995`), and `endTurnInjectionBudget` fires at `attempt.ts:5593`. So the kill boundary is **"start of the next turn"** — a flip mid-turn cannot zero an already-created ledger. This bound is implemented but nowhere asserted or documented as the drill's required upper bound.

### 3. Session history persistence across app restart

Persistence is on disk and survives app restart:
- `openclaw_runtime/src/config/sessions/paths.ts:11-19` — sessions live under `<stateDir>/agents/<agentId>/sessions`.
- `paths.ts:35-37` `resolveDefaultSessionStorePath` → `sessions.json` (session index/metadata).
- `paths.ts:250-266` `resolveSessionTranscriptPathInDir` → `<sessionId>.jsonl` transcripts (topic variant `<sessionId>-topic-<n>.jsonl`).
- `paths.ts:62-87` (`openclaw_runtime/src/config/paths.ts`) `resolveStateDir` — `OPENCLAW_STATE_DIR` override else `~/.openclaw`, with legacy-dir fallback.
- Store write-through: `openclaw_runtime/src/config/sessions/session-file.ts:8-60` `resolveAndPersistSessionFile` persists `sessionFile` into `sessions.json` via `updateSessionStore`.
- Renderer reads history over RPC `chat.history` (`electron/services/workspace-permissions.ts:64-65` allowlists `chat.history` and `sessions.list`).
- Electron-side settings (including the DCS flag store keys) are a **separate** electron-store `settings.json` in userData: `electron/utils/store.ts:233-235` (`new Store({ name: 'settings' })`), accessors `:245`, `:257`; DCS defaults `:200-201` are `false`.

### 4. Write journal persistence

**On disk, and it explicitly rehydrates across restart.**

`C:/Users/27933/Desktop/clawx/ClawX-maturity-p0/openclaw_runtime/src/agents/tools/write-journal.ts`
- `:52-54` `journalDirFor` → **`<workspaceRoot>/.openclaw/journal/<sessionId>`** (workspace-relative, not stateDir).
- `:142` snapshot file `<seq padded 4>-<basename>.pre`; `:168-180` sidecar `<snapshot>.meta.json` with `seq/relPath/absPath/hadPrior/toolName/createdAtMs/lineage`.
- `:50` `const journals = new Map<string, WriteJournal>()` — in-memory index, keyed `${resolve(workspaceRoot)}::${sessionId}`.
- `:61-97` `rehydrateJournalFromDisk` — comment at `:56-59` names FP-P1-04/FP-P1-05 directly: reads all `*.meta.json`, sorts by `seq`, sets `nextSeq`. Called from `:109` inside `getOrCreateWriteJournal` on first touch after a cold start. **Disk is the source of truth, so journal + undo do survive gateway restart and app restart**, provided the same `workspaceRoot` + `sessionId` are supplied.
- `:198-252` `undoLastWrites` — hard-stop-on-first-failure, entry retained, `journalDir` reported.
- Wiring: `openclaw_runtime/src/agents/agent-tools.ts:787-791` (`wrapToolWithWriteJournal`), `:956-960` (`createUndoWriteTool`). Enablement `agent-tools.ts:761`, default **true** (`openclaw_runtime/src/context-engine/coding-runtime-flags.ts:97-105`).

**Defect found — the lineage generation field is written from an env var nothing sets.** `write-journal.ts:162-163` reads `process.env.VERSE_GATEWAY_GENERATION`, but the launcher stamps `VERSE_CLAW_GATEWAY_GENERATION` (`generation.ts:10`, `process-launcher.ts:171`) and the runtime ack reads that same `VERSE_CLAW_*` name (`runtime-flag-ack.ts:46`). The only other producer of the un-prefixed name is the standalone bench script `scripts/measure-flag-ack-latency.mjs:105`. So in the real product every journal entry's `lineage.gatewayGeneration` is **absent**, and the "which gateway generation produced this write" evidence the drill needs across a restart does not exist.

### 5. Existing restart/recovery specs

**No restart/recovery E2E spec exists.** `tests/e2e/` has 124 spec files; none is named for restart/recovery/rollback. What exists:

- `tests/e2e/gateway-lifecycle.spec.ts:131` "shows gateway restart progress in the sidebar" and `:223` "chat sidebar history reloads when gateway becomes ready after restart" — both drive `gateway:status-changed` via `electronApp.evaluate` with **fully mocked IPC** (`installIpcMocks`). No real child process, no real restart. Assertions are on `sidebar-gateway-restarting` `data-state` (`:184-186`, `:220`, `:259`, `:274`).
- `tests/e2e/runtime-launch-contract-fp-p0.spec.ts:379` — real `restartGateway: true` flag flip; asserts generation is numeric (`:195`) and that `ack.gatewayGeneration === result.gatewayGeneration` (`:415`). Single flip, not mid-session.
- `tests/e2e/dcs-flag-ack-tuning-fp-p1-09.spec.ts:92` — five real restart→ack cycles for latency tuning; explicitly excludes the restart itself from measurement (`:4-9`). No session in flight.
- `tests/e2e/dcs-preview-optin-fp-p1-03.spec.ts:96` — phases: prereq gate → applied → **off → baseline parity** (`:182-213`, asserts `turnEffectProbe.wouldChangeTurn === false`) → **kill switch** (`:214-225`, writes `runtime.contextEnhancement.killSwitch: true` to `openclaw.json`, expects ack `failed` + `killed`). Kill is applied *between* flips, never mid-session.
- `tests/e2e/coding-loop-fp-p1-04.spec.ts:333` — real journal on disk, undo restores, partial-undo failure retains `journalDir` (`:461-481`). **All within one app lifetime — never restarts.**
- Unit: `tests/unit/gateway-manager-restart-recovery.test.ts:30` (reconnect re-enabled when `start()` fails), `:82`; `tests/unit/gateway-restart-governor.test.ts`; `tests/unit/gateway-startup-recovery.test.ts`; `tests/unit/dcs-flag-ack.test.ts:97` (stale generation `'6'` vs expected `'7'`).
- `artifacts/first-product-preview/` has `FP-P0-05..07`, `FP-P1-01/02/03/09` — **no `FP-P1-05/` directory**.

### 6. TASK-OPS-02 (read-only reference)

`C:/Users/27933/Desktop/clawx/ClawX-maturity-p0/docs/dev/dcs-visible-production/tasks/TASK-OPS-02.md` — "Real kill/rollback drill", status `done` 2026-07-22, gapRef O-04, 0.5d.

Drill described: execute the runbook kill order for real via the Settings panel (enable → disable) plus a packaging post-check, record a before/after artifact `artifacts/dcs-deep-test-week1/rollback-drill.json` with `kind: live-supervised-electron`, verify baseline recovery (settings panel + flags off + smoke defaults `defaultsUnchanged=true`), and confirm the enhanced path is unreachable without opt-in. Evidence: 3 Playwright toggle-restore tests, `dcs:prod-p0:smoke`, 6 unit env-kill tests, redLines all safe.

Its own Honesty section is the gap FP-P1-05 exists to close: *"This is a live supervised Electron kill path, not a multi-hour free-form human chat kill... Optional residual: calendar free-form session wall-clock kill."* It is a **short-path toggle/restore drill with no session in flight and no restart dimension at all**.

---

### Drill scenario coverage — which have NO supporting implementation

| # | Scenario | Status | Basis |
|---|---|---|---|
| 1 | **Gateway restart mid-session** | **NO supporting impl/test** | `restart()` (`manager.ts:683`) and ack re-establishment (`dcs-prod-flags-api.ts:281-320`) exist, but nothing ties them to a *live session*. No code path re-establishes ack for an in-flight turn, and no test restarts while a turn is running. Journal survives (§4) but is unverified across restart. |
| 2 | **App restart mid-session** | **NO supporting impl/test** | Session store on disk (§3) and journal rehydrate (`write-journal.ts:61-97`) make it *plausible*, but there is zero test that relaunches Electron and resumes. `gateway-lifecycle.spec.ts:223` is fully mocked, not an app restart. **Additionally `generation.ts:12` resets `currentGeneration` to 0 on app restart** — after relaunch the host expects generation `1` again, so pre-restart lineage/ack evidence is not distinguishable across app lifetimes. |
| 3 | **Mid-session kill flip** | **PARTIAL — config form only; no test** | Config kill is genuinely live per-turn via `kill-switch-config-source.ts:46-71` (mtime-keyed). But (a) **env-form kill cannot take effect without a gateway restart** — `process.env` is frozen at spawn (`process-launcher.ts:167-171`); (b) `attempt.ts:3263` evaluates against `params.config`, a run-scoped snapshot, so the CVK path may not observe a mid-run config kill the way `assembler.ts:172` does; (c) the effect boundary ("next turn", from `turn-injection-budget.ts:142-143`) is **not documented and not asserted anywhere** — this is exactly the acceptance criterion "kill 生效延迟有明确上界并记录". No mid-session kill test exists; `dcs-preview-optin-fp-p1-03.spec.ts:214` flips kill between operations only. |
| 4 | **Undo after kill** | **NO supporting impl/test** | Journal and kill switch are fully independent subsystems — `write-journal.ts` never imports the kill switch, so undo *should* keep working. But nothing asserts it, and the interaction is untested. `coding-loop-fp-p1-04.spec.ts:333` exercises undo with no kill involved. |
| 5 | **Flag-off rollback parity** | **COVERED** | `dcs-preview-optin-fp-p1-03.spec.ts:182-213` asserts `turnEffectProbe.wouldChangeTurn === false` after disable, plus per-flag `effective-<key>: false`. This is the one scenario with real automation. Not exercised mid-session, and not automated as a reusable parity assertion (acceptance slice 5). |
| 6 | **App version rollback (N → N-1)** | **NO supporting impl at all** | `electron/utils/store.ts:233-235` creates the settings store with **no `migrations`, no `schemaVersion`, no version field**. Nothing detects a downgrade, nothing reconciles DCS flag keys (`store.ts:130-131`, defaults `:200-201`) against an older binary that may not know them. `applyDcsProdFlagsToGatewayEnv` (`electron/utils/dcs-prod-flags-env.ts:22-48`) reads whatever is in the store — an N-written flag ON would be re-applied by N-1 with no guard. The "flag 状态安全（不残留 ON）" requirement has zero implementation. |
| 7 | **Restart failure** | **PARTIAL — one path only** | `dcs-prod-flags-api.ts:283-296` handles it well (`failureReason: 'restart-failed'` + `operatorHintKey`). But the generic RPC `gateway-api.ts:360-364` returns `{ success: true }` with **no try/catch and no failure branch**, and `manager.ts:701-718` **silently returns on governor cooldown suppression** — a suppressed restart is indistinguishable from an applied one to every caller except the ack-based flag path. `ipc-handlers.ts:276`, `settings-api.ts:93,99`, `agents-api.ts:91` all `await restart()` with no failure surfacing. "不静默" is violated on every non-flag path. |

**Summary: 5 of 7 have no supporting implementation or test (1, 2, 4, 6, and the env-kill half of 3); 2 are partial (3, 7); 1 is covered (5).** The two hardest gaps are **#6 (app version rollback — nothing exists, not even a schema version to build on)** and **#7's silent-suppression hole in `manager.ts:701-718`**. The concrete bug to fix before any drill is the `VERSE_GATEWAY_GENERATION` / `VERSE_CLAW_GATEWAY_GENERATION` mismatch at `write-journal.ts:162`, which silently voids the journal's cross-restart lineage evidence.