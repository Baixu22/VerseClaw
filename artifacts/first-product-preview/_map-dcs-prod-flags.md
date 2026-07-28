Confirmed — all four `PREVIEW_EFFECTIVE_KEYS` match the child's emitted spelling. The map is complete.

# DCS Production Flags Control Plane — Map for FP-P1-03

**Important finding up front: FP-P1-03 is already substantially implemented and landed** (commit `138cd5136 feat(dcs): add production hardening and evidence gates`). The preview combo switch, prereq gating, one-restart/one-ack flip, kill-switch display, i18n, and a real-DOM E2E spec all exist. `DcsProdFlagsPanel.tsx` and `shared/dcs/prod-flags-catalog.ts` are currently dirty in the working tree. Treat this as a map of an existing feature to extend/verify, not a greenfield build.

---

## 1. `shared/dcs/prod-flags-catalog.ts` (289 lines)

Pure catalog, no writes. Types at `:7` `DcsProdFlagRisk` (`'baseline-on' | 'opt-in' | 'shadow-only' | 'api-only' | 'request-only' | 'read-only'`), `:15` `DcsProdFlagKind` (`'env' | 'config' | 'api' | 'request' | 'info'`), `:17` `DcsProdFlagEntry`.

`DCS_PROD_FLAGS` at `:30` — 15 entries, verbatim ids in array order with line, kind, key, defaultValue:

| # | id | line | kind | key | default | risk |
|---|---|---|---|---|---|---|
| 1 | `context-view-tools` | `:32` | env | `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` | `false` | opt-in |
| 2 | `context-tools-alias` | `:46` | env | `OPENCLAW_DCS_CONTEXT_TOOLS` | `false` | opt-in |
| 3 | `working-memory` | `:59` | config | `runtime.contextBlock.working-memory.enabled` | `false` | opt-in |
| 4 | `tool-registry` | `:74` | config | `runtime.contextBlock.tool-registry.enabled` | `false` | opt-in |
| 5 | `stale-write-guard` | `:87` | config | `runtime.coding.staleWriteGuard.enabled` | `false` | opt-in |
| 6 | `write-journal` | `:99` | info | `runtime.coding.writeJournal.enabled` | `true` | baseline-on |
| 7 | `worktree-backend` | `:112` | config | `runtime.coding.worktree.backend` | `'inprocess'` | opt-in |
| 8 | `isolation-request` | `:126` | request | `request.isolation \| plan.isolation` | `'shared'` | request-only |
| 9 | `symbol-lease` | `:140` | config | `runtime.coding.symbolLease.enabled` | `false` | opt-in |
| 10 | `symbol-lease-mode` | `:153` | config | `runtime.coding.symbolLease.mode` | `'memory'` | opt-in |
| 11 | `patch-flow` | `:165` | api | `applyPatchProposalsSerial() / recommendIsolationMode()` | `false` | api-only |
| 12 | `context-ladder` | `:178` | api | `applyContextLadder(...)` | `false` | api-only |
| 13 | `routing-memo-shadow` | `:191` | config | `runtime.coding.routingMemo.shadow` | `false` | shadow-only |
| 14 | `sekb-experience-shadow` | `:204` | config | `runtime.coding.sekb.experienceShadow` | `false` | shadow-only |

(Note: entry 5 `stale-write-guard` closes at `:98` with `},  {` on one line — a formatting quirk, not a bug.)

Other exports: `DCS_PROD_METRIC_EXPORT` `:218` (writeSide/waveSide/shadowSide/sources key lists), `listEnhancementFlagsDefaultOff()` `:251`, `assertCatalogDefaultHonesty()` `:261` — the latter is a guard asserting 8 named ids stay `false`, backend stays `inprocess`, isolation stays `shared`. **If you add a flag to the combo you must keep it passing.**

## 2. `shared/dcs/prod-flags-control.ts` (414 lines)

- `:11` `DcsProdFlagApplyStatus` — union of `'applied' | 'pending-restart' | 'error' | 'read-only' | 'unsupported' | 'saved' | 'restarting' | 'runtime-acknowledged' | 'failed'`.
- `:28` **`DCS_FLAG_ACK_STATES`** verbatim, ordered: `'saved', 'pending-restart', 'restarting', 'runtime-acknowledged', 'applied', 'failed'`. Type `DcsFlagAckState` at `:37`.
- `:40` **`DCS_FLAG_ACK_REQUIRED_FIELDS`** verbatim, the seven: `'gatewayGeneration', 'childPid', 'effectiveFlags', 'configSource', 'runtimeBuildOrConfigHash', 'turnEffectProbe', 'degradedReason'`.
- `:53` `DcsFlagRuntimeAck` (host-side mirror), `:70` `DcsFlagAckFailureReason` = `'restart-failed' | 'ack-timeout' | 'ack-incomplete' | 'ack-stale-generation' | 'gateway-not-running' | 'flag-rejected'`.
- `:79` `missingDcsFlagAckFields()`, `:116` `isCompleteDcsFlagAck()`. Note `:107-109`: `degradedReason: null` is valid, `undefined` is not.
- `:142` **`DCS_WRITABLE_FLAG_SPECS`** — 7 writable specs (id / storeKey / targetKey), in order: `context-view-tools`→`dcsContextViewToolsEnabled` (env, alias `OPENCLAW_DCS_CONTEXT_TOOLS`) `:143`; `working-memory`→`dcsWorkingMemoryEnabled` `:152`; `tool-registry`→`dcsToolRegistryEnabled` `:160`; `stale-write-guard`→`dcsStaleWriteGuardEnabled` `:168`; `symbol-lease`→`dcsSymbolLeaseEnabled` `:176`; `routing-memo-shadow`→`dcsRoutingMemoShadowEnabled` `:184`; `sekb-experience-shadow`→`dcsSekbExperienceShadowEnabled` `:192`. All `defaultEnabled: false`. `context-tools-alias` is deliberately NOT writable (it rides the primary's `envAlias`).
- Helpers: `listWritableFlagSpecs()` `:212`, `getWritableFlagSpec()` `:216`, `isWritableFlagId()` `:220`, `getConfigPathValue()` `:225`, `setConfigPathValue()` `:237` (non-mutating), `asBooleanFlag()` `:260`.
- Result types: `DcsProdFlagStateRow` `:271`, `DcsProdFlagsSnapshot` `:283`, `DcsProdObservabilitySnapshot` `:293`, `DcsProdFlagSetPayload` `:309`, **`DcsProdFlagSetResult` `:316`** (has `ackTrail`, `runtimeAck`, `ackMissingFields`, `failureReason`, `operatorHintKey`, `gatewayGeneration`, **`ackWaitMs` `:336`**), **`DcsProdFlagAckRequeryResult` `:344`** (the RequeryResult).
- **FP-P1-03 types already here:** `DCS_PREVIEW_COMBO_FLAG_IDS` `:373` = `'context-view-tools', 'working-memory', 'tool-registry', 'stale-write-guard'` (typed `satisfies readonly DcsWritableFlagId[]`); `DcsPreviewPrereq` `:380` = `'providerVerified' | 'workspaceSelected' | 'permissionChosen'`; `DcsPreviewState` `:382`; `DcsPreviewSetPayload` `:392`; `DcsPreviewSetResult` `:398`. The doc comment `:357-372` records the deliberate exclusions (shadow flags, symbol-lease, VToken/RM/SEKB/Browser).

## 3. `electron/services/dcs-prod-flags-api.ts` (561 lines)

**RPC surface — `createDcsProdFlagsApi()` at `:552`**, registered in `electron/main/ipc-handlers.ts:194` as module `dcsProdFlags`. Five methods verbatim:
- `getFlags` `:554` → `getDcsProdFlagsSnapshot()`
- `setFlag` `:555` → `setDcsProdFlag()`
- `requeryAck` `:556` → `requeryDcsFlagAck()`
- `getPreview` `:557` → `getDcsPreviewState()`
- `setPreview` `:558` → `setDcsPreview()`

Contract declared at `shared/host-api/contract.ts:4514-4520`; renderer client at `src/lib/host-api.ts:727-734`.

Functions: `readAckTuning()` `:49`, `storeEnabled()` `:59`, `readConfigEnabled()` `:68`, `writeConfigEnabled()` `:81` (wrapped in `withConfigLock`), `buildRow()` `:90`, `getDcsProdFlagsSnapshot()` `:151`, `buildDcsProdObservability()` `:184`, **`setDcsProdFlag()` `:220`**, re-export `applyDcsProdFlagsToGatewayEnv` `:343`, **`requeryDcsFlagAck()` `:350`**, `resolveDcsPreviewPrereqs()` `:384`, `previewComboSpecs()` `:413`, `getDcsPreviewState()` `:420`, **`setDcsPreview()` `:439`**.

**setFlag sequence** (`:220-337`): reject non-writable → `unsupported` `:226`; `restartGateway` defaults to `process.env.VERSE_CLAW_E2E !== '1'` `:239`; write `setSetting(storeKey)` `:246`; if config kind write openclaw.json `:249`; if env kind mirror `process.env` + alias `:254-262`; **if not restarting or gateway not running → early return `pending-restart` with `ackTrail: ['saved','pending-restart']` and `failureReason: 'gateway-not-running'` `:267-278`**; `gatewayManager.restart()` `:281`, on throw → `pending-restart` + `restart-failed` `:283-296`; then `getCurrentGatewayGeneration()` `:298` → `collectRuntimeFlagAck({...})` `:301` with `requestAck: gatewayManager.rpc('runtime.flags.ack', { requestedFlags: { [spec.targetKey]: enabled } })` `:305-307`; `ackWaitMs` measured `:300`/`:310`.

**`requeryDcsFlagAck()` `:350`** — no save, no restart. Same `collectRuntimeFlagAck` but `rpc('runtime.flags.ack', {})` with empty params `:360` (so no `rejectedFlags` computed), reusing the *current* generation `:354`.

**`setDcsPreview()` `:439`** — the FP-P1-03 combo path. Refuses when prereqs missing `:450-463` (returns `status: 'error'` + `missingPrereqs`); writes all 4 specs in one loop `:466-480`; **one** restart `:497`; **one** ack covering all combo targetKeys via `requestedFlags` built at `:516`.

**`resolveDcsPreviewPrereqs()` `:384`** — `providerVerified` from `settings.setupProviderVerification?.status === 'verified'` `:387` OR any provider account with `metadata.validation.status === 'valid'` `:391-396`. Workspace check `:404`: `Boolean(workspace?.rootPath) && workspace.id !== 'default'` — the auto-created `default` profile does not count, and failing it pushes **both** `workspaceSelected` and `permissionChosen` `:406`.

## 4. `electron/services/dcs-flag-ack.ts` (205 lines)

Constants `:28-30`: `DCS_FLAG_ACK_TIMEOUT_MS = 60_000`, `DCS_FLAG_ACK_POLL_INTERVAL_MS = 250`, `DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS = 4_000`. `resolveDcsFlagAckTuning()` `:43` clamps operator overrides (timeout 1s–600s, poll 50ms–10s; `≤0`/non-finite → default).

`DcsFlagAckOutcome` `:65` — note `state` is only `'applied' | 'failed' | 'pending-restart'`. `DcsFlagAckDeps` `:74`.

**`collectRuntimeFlagAck()` `:98`** — trail seeded `['saved','pending-restart','restarting']` at `:101`. Loop `:119`: `requestAck()` throw → treated as `undefined` `:124`; incomplete → remember `lastMissing` `:129`; complete → **generation match at `:133`**: mismatch sets `sawStaleGeneration`/`lastStaleAck` and keeps polling `:136-137`; match → push `runtime-acknowledged` `:139`, then if `rejectedFlags.length > 0` → `failed` + `'flag-rejected'` `:140-149`, else push `applied` `:150`. Exponential backoff `:157-158`.

Terminal branches: stale generation → `failed`/`ack-stale-generation` `:162-171`; incomplete → `failed`/`ack-incomplete` `:173-182`; **timeout while still running → `pending-restart` (retryable, not failed) + `ack-timeout` `:184-193`**; timeout while stopped → `failed` + `ack-timeout` `:196-203`. The five `operatorHintKey` values are at `:147, :169, :180, :192, :202`.

Generation source: `electron/gateway/generation.ts` — `GATEWAY_GENERATION_ENV = 'VERSE_CLAW_GATEWAY_GENERATION'`, `nextGatewayGeneration()`, `getCurrentGatewayGeneration()`, `stampGatewayGeneration()`.

## 5. `src/components/settings/DcsProdFlagsPanel.tsx` (811 lines)

Components: `riskTone()` `:46`, `statusTone()` `:61`, **`AckDetail()` `:90`**, `FlagRow()` `:170`, `ViewToolsDiscoverBanner()` `:222`, **`DcsPreviewCard()` `:307`**, `DcsProdFlagsPanel()` `:439` (renders `<DcsPreviewCard />` first at `:580`).

`PREVIEW_EFFECTIVE_KEYS` `:31-36` — the child-side (snake) spellings: `'dcs.contextViewTools.enabled'`, `'runtime.contextBlock.working_memory.enabled'`, `'runtime.contextBlock.tool_registry.enabled'`, `'runtime.coding.staleWriteGuard.enabled'`. **Verified these match the child's emitted keys exactly.**

`AckDetail` renders: status badge `:111` (`developer.dcsProdFlags.status.${result.status}`), trail joined with `' → '` `:120`, hint `:127`, requery button `:130` (shown only when `failureReason === 'ack-timeout'`, gated at `:103`), child identity line `:144` (`pid · generation · hash · turnEffect [· degraded]`), missing fields `:152`, rejected flags list `:157`.

Toggle flow `onToggle` `:519`: calls `hostApi.dcsProdFlags.setFlag({ id, enabled })` `:523` — note it does **not** pass `restartGateway`, so the E2E-env default applies. **`result.status !== 'applied'` never shows a success toast `:539`**; only `applied` does `:546`. `onRequeryAck` `:452` merges the requery outcome into the stored result.

`DcsPreviewCard` `:307`: `hostApi.dcsProdFlags.getPreview()` `:315`; `blocked = missing.length > 0 && !state?.enabled` `:326`; `killSwitchEngaged` from `runtimeAck.turnEffectProbe.killSwitchEngaged` `:327`; toggle **always** `restartGateway: true` `:335` (deliberate, incl. E2E); switch disabled when `busy || blocked || !state` `:369`; kill-switch overrides the status label `:406-408`.

i18n (`shared/i18n/locales/{en,ja,ru,zh}/settings.json`): `developer.dcsProdFlags.*` — `status.*` (9 keys, one per `DcsProdFlagApplyStatus`), `ackHint.*` (7: `gatewayNotRunning`, `restartFailed`, `ackTimeoutRunning`, `ackTimeoutStopped`, `ackIncomplete`, `staleGeneration`, `flagRejected`), `risk.*` (6), `viewToolsDiscover.*`, `observability.*`, `requeryAck`, `requerying`. `developer.dcsPreview.*` — `title`, `description`, `prereqTitle`, `prereqs.{providerVerified,workspaceSelected,permissionChosen}`, `partial`, `setFailed`, `appliedOn`, `appliedOff`, `killed`, `killSwitchNote`.

Test ids: `settings-dcs-preview-card`, `-switch`, `-partial`, `-prereqs`, `-missing-${prereq}`, `-ack`, `-ack-state`, `-ack-trail`, `-killswitch`, `-effective`, `-effective-${key}`; and `settings-dcs-flag-ack-detail`, `-state`, `-trail`, `-hint`, `-requery`, `-child`, `-missing`, `-rejected`.

## 6. Where effective flags come back from the child

Two files in `openclaw_runtime`:

**`openclaw_runtime/src/gateway/server-methods/runtime-flag-ack.ts`** — handler `"runtime.flags.ack"` at `:21`, `normalizeRequestedFlags()` `:8` (drops non-boolean values; returns `undefined` when empty). Method descriptor registered at `openclaw_runtime/src/gateway/methods/core-descriptors.ts:25` with `scope: "operator.read"`; also listed in `openclaw_runtime/src/gateway/server-methods.ts:368` and allow-listed at `electron/services/workspace-permissions.ts:111`.

**`openclaw_runtime/src/context-engine/runtime-flag-ack.ts`** (456 lines) — the payload builder:
- `RUNTIME_FLAG_ACK_GENERATION_ENV = "VERSE_CLAW_GATEWAY_GENERATION"` `:46`; `RUNTIME_FLAG_ACK_REQUIRED_FIELDS` `:49` (same seven, runtime-side copy).
- **`RuntimeFlagAckPayload` `:109`** — `schema: "runtime-flag-ack/v1"`, plus `launchEnv` `:114` and `injectionBudget` `:121` which are **carried but NOT in the required seven** (documented `:388-395`).
- **`resolveEffectiveRuntimeFlags()` `:193`** — the authoritative key list: 4 context-block keys (snake, from `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS` in `assembler.ts:59-64`), 9 `runtime.coding.*` keys `:206-216`, plus `runtime.vtoken.assembly.enabled` `:221`, `dcs.contextViewTools.enabled` `:222`, `runtime.contextEnhancement.killSwitch` `:223`. **Kill switch forces all context-block flags to `false` `:201`.**
- **`normalizeRequestedFlagId()` `:304`** — the kebab→snake bridge. Host sends `runtime.contextBlock.working-memory.enabled`; runtime stores `..._memory...`. Regex `:305`, and env names `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS`/`OPENCLAW_DCS_CONTEXT_TOOLS` → `dcs.contextViewTools.enabled` `:310-312`. The doc comment `:293-303` notes that without this a healthy flag is falsely reported `unknown-to-runtime`.
- `buildRuntimeFlagAck()` `:317` — reject reasons `'unknown-to-runtime'` `:343`, `'kill-switch-engaged'` / `'not-adopted-by-runtime'` `:353`; `degradedReason` joins `'config-file-absent'` `:332` and `'partial-flag-reject'` `:358`, else `null` `:382`; hash is sha256 over `{flags, configStamp, origin}` sliced to 32 chars `:361-370`; `gatewayGeneration` falls back to the literal `"unknown"` when the env is unset `:374`.
- `TURN_EFFECT_FLAGS` `:251` (6 surfaces) drives `wouldChangeTurn` via `buildTurnEffectProbe()` `:260`.

## Supporting files

- `electron/utils/dcs-prod-flags-env.ts` — `applyDcsProdFlagsToGatewayEnv()`; explicit `0/false/no/off` in `process.env` always wins over the store toggle.
- `electron/utils/store.ts:130-136` — the 7 flag store keys, all defaulting `false` at `:200-206`; ack tuning `dcsFlagAckTimeoutMs` / `dcsFlagAckPollInitialMs` at `:142-143`, both default `0` (= use measured defaults) at `:207-208`.
- `electron/gateway/config-sync.ts:40` — prelaunch env injection.
- `electron/services/support-bundle.ts:122` (raw ack, 15s timeout) and `:236` (`dcsPreview` via `getDcsPreviewState`).
- E2E: `tests/e2e/dcs-preview-optin-fp-p1-03.spec.ts` — real DOM + real gateway child, 4 phases (prereq-blocked → applied → baseline parity off → kill-switch shows `killed`, never `applied`). Related: `runtime-launch-contract-fp-p0.spec.ts`, `config-schema-parity-fp-p0-06.spec.ts`, `coding-loop-fp-p1-04.spec.ts`, `dcs-prod-p0-settings.spec.ts`.
- Runtime unit tests: `openclaw_runtime/src/context-engine/runtime-flag-ack.test.ts`; catalog guard test `openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts`.

## Implementer cautions

1. **Two spellings of the same flag.** Host `targetKey` is kebab; child `effectiveFlags` is snake. The only bridge is `normalizeRequestedFlagId()`. Adding a context-block flag to the combo requires updating `PREVIEW_EFFECTIVE_KEYS` (`DcsProdFlagsPanel.tsx:31`) with the **snake** form, or the UI silently renders `undefined`.
2. **Two independent copies of the seven required fields** — `prod-flags-control.ts:40` and `runtime-flag-ack.ts:49` — with two separate validators. They must be edited together.
3. `assertCatalogDefaultHonesty()` (`prod-flags-catalog.ts:261`) will fail the build if any of the 8 named ids stops defaulting to `false`.
4. `setFlag` inherits the `VERSE_CLAW_E2E` restart default; `setPreview` from the UI hardcodes `restartGateway: true`. Don't unify these without re-reading `DcsProdFlagsPanel.tsx:335`.
5. `requeryAck` sends **empty** params, so it can never produce `rejectedFlags` — a flag rejected by the child will requery as `applied`. Relevant if you extend requery to the preview combo.