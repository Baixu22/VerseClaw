I have everything needed. Here is the map.

## 1. `runtime-flag-ack.ts` — current shape

**File**: `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\src\context-engine\runtime-flag-ack.ts`

### `resolveConfigSource` — line 156-173 (module-private, not exported)

Type at line 61-68: `{ path: string; exists: boolean; origin: "env-override" | "state-dir" }`. It answers **"which file did the child read"** only — it is file-level, not per-flag. `origin` is decided solely by `env.OPENCLAW_CONFIG_PATH?.trim()` (line 157-159); `path` comes from `resolveConfigPath(env)` (`openclaw_runtime/src/config/paths.ts:195`), `exists` from `fs.existsSync`. There is no flag dimension anywhere in this type. This is exactly the gap FP-P1-10 records.

### `resolveEffectiveRuntimeFlags` — line 193-225 (exported)

Signature: `(cfg?: OpenClawConfig, env: NodeJS.ProcessEnv = process.env) => Record<string, boolean | string>`. Three groups, all producing bare values with no provenance:

- **line 197**: `const killed = isContextEnhancementKillSwitchEngaged(cfg, env)` — computed once, up front.
- **lines 198-202** context-block (4 flags): loop over `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS`; `contextBlock[name] = killed ? false : readContextBlockFlag(cfg, key)`. **This ternary is where kill provenance is destroyed** — a killed flag is indistinguishable from a default-off flag in the output map.
- **lines 206-216** coding (9 flags): a flat literal calling one leaf resolver each, `cfg` only, no `env`, no `overrides`.
- **lines 221-223**: `runtime.vtoken.assembly.enabled` = `resolveVtokenAssemblyConfig(cfg).enabled`; `dcs.contextViewTools.enabled` = `isDcsContextViewToolsEnabled(env)`; `runtime.contextEnhancement.killSwitch` = `killed`.

`readContextBlockFlag` (line 237-248, private) is the 4th resolver family: reads `cfg?.runtime?.contextBlock[<kebab key>].enabled` via the kebab map at line 227-235, falls back to `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS[flag]` (all `false`, `assembler.ts:59-64`). Config-vs-default is already distinguishable internally at line 245-247 (`typeof enabled === "boolean"` branch) but the information is discarded on return.

## 2. `coding-runtime-flags.ts` — leaf resolvers

**File**: `openclaw_runtime\src\context-engine\coding-runtime-flags.ts` (209 lines, 9 live resolvers + 1 deprecated no-op).

Uniform signature: `(cfg?: OpenClawConfig, overrides?: {<specificKey>?: T}) => T`. **No resolver in this file reads `env` at all** — precedence is `overrides` (in-process caller argument, not env) → `cfg.runtime.coding.<leaf>` → `DEFAULT_CODING_FEATURE_FLAGS`. So for coding flags the FP-P1-10 `env` source category is currently *unreachable*; the honest enum for these is `override | config | default | kill`.

Three representative resolvers verbatim:

```ts
/** Block stale full-file writes (C2-2). Default false (shadow). */
export function isCodingStaleWriteGuardEnabled(
  cfg?: OpenClawConfig,
  overrides?: { staleWriteGuardEnabled?: boolean },
): boolean {
  if (typeof overrides?.staleWriteGuardEnabled === "boolean") {
    return overrides.staleWriteGuardEnabled;
  }
  const fromConfig = readCodingLeaf(codingConfigFrom(cfg), "staleWriteGuard");
  return fromConfig ?? DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.staleWriteGuard.enabled"];
}
```
(line 85-94 — the simple shape, shared with `parseOnTouch`/`writeJournal`, all delegating to `readCodingLeaf` at line 49-58 which returns `undefined` when the leaf is absent or non-boolean.)

```ts
/** C4-H worktree backend. Default inprocess (safe). */
export function resolveWorktreeBackend(
  cfg?: OpenClawConfig,
  overrides?: { backend?: WorktreeBackend },
): WorktreeBackend {
  if (overrides?.backend === "inprocess" || overrides?.backend === "git") {
    return overrides.backend;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.worktree) as CodingFlagLeaf | undefined;
  if (leaf?.backend === "git" || leaf?.backend === "inprocess") {
    return leaf.backend;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"];
}
```
(line 109-121 — the enum-valued shape; `resolveSymbolLeaseMode` line 139-151 is its twin.)

```ts
/** C7-1 routing memo JSONL dual-write shadow. Default false (no cutover / no prompt injection). */
export function isCodingRoutingMemoShadowEnabled(
  cfg?: OpenClawConfig,
  overrides?: { routingMemoShadow?: boolean },
): boolean {
  if (typeof overrides?.routingMemoShadow === "boolean") {
    return overrides.routingMemoShadow;
  }
  const leaf = asRecord(codingConfigFrom(cfg)?.routingMemo) as CodingFlagLeaf & {
    shadow?: boolean;
  } | undefined;
  if (typeof leaf?.shadow === "boolean") {
    return leaf.shadow;
  }
  if (typeof leaf?.enabled === "boolean") {
    return leaf.enabled;
  }
  return DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.routingMemo.shadow"];
}
```
(line 192-209 — the **dual-key** shape: a named sub-key wins, then `enabled` is accepted as an alias. Same in `isCodingPatchFlowDefault` line 154-169 (`default` then `enabled`) and `isCodingSekbExperienceShadowEnabled` line 172-189 (`experienceShadow` then `enabled`). An `explain()` for these three must report *which config key* matched, or the operator cannot find the line to edit.)

`isCodingFactViewsEnabled` (line 65-70) is a deprecated hardcoded `return false` — needs no explain sidecar, but if one is added it should report a distinct `removed` source rather than `default`.

## 3. `chat-turn-vtoken-injection.ts` — `resolveVtokenAssemblyConfig`

**Line 144-194.** Signature is `(value: unknown) => VtokenAssemblyConfig` — note it takes `unknown`, not `OpenClawConfig`, and **takes no `env` parameter**; env is read via module-level `process.env` defaults inside the two helpers. Precedence for `.enabled`:

1. **line 145-147**: `if (!isVtokenAssemblyEnvEnabled()) return {...DEFAULT, enabled: false}` — env kill. `isVtokenAssemblyEnvEnabled` is at `openclaw_runtime/src/context-engine/vtoken-rpc-client.ts:413-420`: only an explicit `0|false|no|off` returns false; unset returns `true`.
2. **line 148-150**: `if (isContextEnhancementKillSwitchEngaged(value)) return {...DEFAULT, enabled: false}` — enhancement kill (env or config), returns identically to case 1. **These two early returns are byte-identical in output**, so an explain sidecar must distinguish `kill:vtoken-env` / `kill:enhancement-env` / `kill:enhancement-config` at the point of branch, not after.
3. **line 157**: `const enabled = assembly?.enabled === true || isVtokenAssemblyEnvForcedOn();` — config-true OR env canary (`vtoken-rpc-client.ts:423-427`). This single `||` fuses config and env into one boolean; source attribution requires splitting it.

The six numeric/enum sub-fields (lines 158-183) each go through `resolvePositiveInt` (line 428+) / `resolveRenderMode` / `resolveSessions` with clamp+fallback — out of scope for writable-flag attribution, but note a clamped-out-of-range config value currently reports as the default with no signal.

## 4. `dcs-context-tools-flags.ts` — resolvers

**File**: `openclaw_runtime\src\context-engine\dcs-context-tools-flags.ts` (43 lines).

- `isDcsContextViewToolsEnabled` — **line 25-32**. `(env = process.env) => boolean`, pure env, **no `cfg` at all**: `isTruthyEnvValue(env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS) || isTruthyEnvValue(env.OPENCLAW_DCS_CONTEXT_TOOLS)`. The `||` fuses primary key and alias; an explain must report *which* env key was truthy (`dcs-prod-flags-env.ts:36/41` writes both, so in production they agree, but a hand-set alias is a real operator case). `isTruthyEnvValue` is `openclaw_runtime/src/infra/env.ts:69-81` — one-way truthy only, so an explicit `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=0` is indistinguishable from unset at this layer.
- `resolveContextToolSchemaMode` — line 38-43. `OPENCLAW_DCS_CONTEXT_TOOL_SCHEMA_MODE`, `full` vs default `summary`. Not a writable flag in `DCS_WRITABLE_FLAG_SPECS`; no ack exposure today.

Note this file is **not** kill-switch aware: `isDcsContextViewToolsEnabled` ignores the enhancement kill switch, and `resolveEffectiveRuntimeFlags:222` calls it outside the `killed ?` ternary. So `dcs.contextViewTools.enabled` can report `true` in the ack while `turnEffectProbe.activeSurfaces` is `[]` (`buildTurnEffectProbe` line 264-266 empties the list when killed). Per the FP-P1-10 hard lock ("kill 生效时不得归因为 default"), this flag's attribution under kill needs an explicit decision: it is genuinely env-sourced-true, but its effect is killed.

## 5. Kill switch interaction — three different layers, three different behaviours

`isContextEnhancementKillSwitchEngaged` is at `openclaw_runtime\src\context-engine\enhancement-kill-switch.ts:52-70`. Precedence inside it: env `VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH` truthy (line 57-58) → config `runtime.contextEnhancement.killSwitch === true` (line 60-64) → `false`; the `catch` at line 66-68 **fails closed to `true`**. env-kill vs config-kill is already structurally distinguishable here (two separate branches) — an `explainKillSwitch()` returning `"env" | "config" | "fail-closed" | "none"` is a ~10-line change and is the cheapest slice of this task.

Where kill overrides values:

| layer | file:line | mechanism |
|---|---|---|
| ack aggregation, context-block only | `runtime-flag-ack.ts:201` | `killed ? false : readContextBlockFlag(...)` — overwrite after resolution, provenance lost |
| vtoken | `chat-turn-vtoken-injection.ts:148-150` | early return before config read — resolver never runs |
| assembler (real turn) | `assembler.ts:172-173` | `resolveAssembleKillSwitchConfig(request)` then `killed` gate |
| coding flags (9) | — | **not kill-gated at all** — `runtime-flag-ack.ts:206-216` sits outside the ternary |
| view tools | — | **not kill-gated** — `runtime-flag-ack.ts:222` |

So "kill" is not a uniform layer. Only 4 of 13 ack flags are kill-suppressed, and the suppression happens *after* the leaf resolver returns, in the aggregator, not in the resolver. A resolver-level `explain()` for the context-block family would report `config`/`default` and would be **wrong** unless the aggregator overrides the source to `kill` at line 201 — which is the exact hard-lock the task names.

## 6. `DcsProdFlagsPanel.tsx` — `AckDetail`

**File**: `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\src\components\settings\DcsProdFlagsPanel.tsx`, `AckDetail` at **line 90-168**.

**`configSource` is not rendered anywhere in this file.** Verified by grep — zero occurrences. The ack line at line 144-149 renders only:

```tsx
pid {ack.childPid} · generation {ack.gatewayGeneration} · hash{' '}
{ack.runtimeBuildOrConfigHash} · turnEffect{' '}
{String(ack.turnEffectProbe.wouldChangeTurn)}
{ack.degradedReason ? ` · degraded ${ack.degradedReason}` : ''}
```

So `configSource.path` / `.exists` / `.origin` cross the IPC boundary (typed at `shared/dcs/prod-flags-control.ts:57`, persisted into the support bundle at `electron/services/support-bundle.ts:128`) but are dropped at the UI. FP-P1-10 acceptance "保留原有『child 读到哪份 config 文件』信息" therefore requires **adding** that display, not preserving it.

Existing test ids in `AckDetail`: `settings-dcs-flag-ack-detail` (107), `-state` (114), `-trail` (119), `-hint` (125), `-requery` (134), `-child` (144), `-missing` (152), `-rejected` (157). A per-flag attribution list needs a new id in that family.

**i18n**: block `developer.dcsProdFlags` starts at **line 454** of `shared/i18n/locales/{en,zh,ja,ru}/settings.json` — same line number in all four locales. Sub-blocks: `status` (475-485), `ackHint` (486-494), `risk`, `viewToolsDiscover` (503-513), `observability` (516-525), then `requeryAck`/`requerying` at 526-527 (the block's last keys — the natural insertion point). ja/ru currently carry English strings for the newest keys, consistent with the task's "ja/ru 键位齐" (keys present, translation not required). **There is no `configSource` i18n key today**; a new `developer.dcsProdFlags.configSource.*` sub-block (`env` / `config` / `default` / `killEnv` / `killConfig` / `override` / `file` / `origin.env-override` / `origin.state-dir`) must be added to all four.

## Per-writable-flag resolver map

`DCS_WRITABLE_FLAG_SPECS` (`shared/dcs/prod-flags-control.ts:142-200`) defines exactly **7 writable flags**. Each row: the resolver that actually decides the value.

| # | flag id | controlKind | ack key | **deciding resolver — file:line** |
|---|---|---|---|---|
| 1 | `context-view-tools` | env | `dcs.contextViewTools.enabled` | `isDcsContextViewToolsEnabled` — `dcs-context-tools-flags.ts:25` |
| 2 | `working-memory` | config | `runtime.contextBlock.working_memory.enabled` | `readContextBlockFlag` — `runtime-flag-ack.ts:237` (private; kill-overridden at `:201`) |
| 3 | `tool-registry` | config | `runtime.contextBlock.tool_registry.enabled` | `readContextBlockFlag` — `runtime-flag-ack.ts:237` (same, kill-overridden at `:201`) |
| 4 | `stale-write-guard` | config | `runtime.coding.staleWriteGuard.enabled` | `isCodingStaleWriteGuardEnabled` — `coding-runtime-flags.ts:85` |
| 5 | `symbol-lease` | config | `runtime.coding.symbolLease.enabled` | `isCodingSymbolLeaseEnabled` — `coding-runtime-flags.ts:125` |
| 6 | `routing-memo-shadow` | config | `runtime.coding.routingMemo.shadow` | `isCodingRoutingMemoShadowEnabled` — `coding-runtime-flags.ts:192` |
| 7 | `sekb-experience-shadow` | config | `runtime.coding.sekb.experienceShadow` | `isCodingSekbExperienceShadowEnabled` — `coding-runtime-flags.ts:172` |

Caveat on rows 2-3: the resolver the *ack* uses (`readContextBlockFlag`) is **not** the resolver the *production turn* uses. Real turns read via `isWorkingMemoryEnabled` / `isToolRegistryEnabled` at `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:107-113` (`cfg?.runtime?.contextBlock?.["working-memory"]?.enabled === true`, kebab, strict `=== true`, no default table). Two independent readers of the same config path. An explain sidecar attached only to `readContextBlockFlag` attributes what the *ack* computed, which is the right scope for FP-P1-10, but the duplication is worth noting since the ack's whole premise is "report what the child really runs with".

## How many resolvers need an `explain()` sidecar

**Minimum for the 7 writable flags: 6 sidecars.**

1. `isDcsContextViewToolsEnabled` — `dcs-context-tools-flags.ts:25` (must split the `||` to name the winning env key)
2. `readContextBlockFlag` — `runtime-flag-ack.ts:237` (covers writable flags #2 and #3 — one sidecar, two flags; currently private, must be exported or the explain must live beside it)
3. `isCodingStaleWriteGuardEnabled` — `coding-runtime-flags.ts:85`
4. `isCodingSymbolLeaseEnabled` — `coding-runtime-flags.ts:125`
5. `isCodingRoutingMemoShadowEnabled` — `coding-runtime-flags.ts:192` (dual-key: must report `shadow` vs `enabled`)
6. `isCodingSekbExperienceShadowEnabled` — `coding-runtime-flags.ts:172` (dual-key: `experienceShadow` vs `enabled`)

Plus **2 non-optional support pieces** that are not per-flag resolvers but are required by the acceptance criteria:

7. `isContextEnhancementKillSwitchEngaged` — `enhancement-kill-switch.ts:52` — needed for `env-kill` vs `config-kill` (AC line 50), which no per-flag resolver can produce.
8. `resolveEffectiveRuntimeFlags` — `runtime-flag-ack.ts:193` — the aggregator must override source to `kill` at the `:201` ternary and assemble the map; the hard lock cannot be satisfied at leaf level alone.

**Total for the writable set: 8 functions touched (6 leaf sidecars + kill explain + aggregator).**

If the ack's full 13-key `effectiveFlags` map is to carry attribution uniformly rather than just the 7 writable flags — which is the simpler contract and what `runtime-flag-ack.ts:206-216`'s "enumerate explicitly so a new leaf shows up as a compile error" comment already implies — add the 4 remaining coding resolvers (`isCodingParseOnTouchEnabled:73`, `isCodingWriteJournalEnabled:97`, `resolveWorktreeBackend:109`, `resolveSymbolLeaseMode:139`, `isCodingPatchFlowDefault:154`) and `resolveVtokenAssemblyConfig:144`: **14 functions total**.

Note `resolveVtokenAssemblyConfig` is the most expensive single sidecar — three fused decision points (two identical early-return kills at `:145`/`:148`, one `||` at `:157`) and a signature taking `unknown` with implicit `process.env`, so an explain variant needs an explicit env parameter threaded through `isVtokenAssemblyEnvEnabled` / `isVtokenAssemblyEnvForcedOn` (`vtoken-rpc-client.ts:413`, `:423`) to be testable.

The task doc's preference for the sidecar approach (line 41: "倾向旁路，避免改动所有调用点的签名") is well-founded — the coding resolvers have live production callers at `openclaw_runtime/src/agents/agent-tools.ts` (10 references) and `openclaw_runtime/src/agents/patch-flow-graduation.ts` (2), so changing return types to `{value, source}` would ripple into the turn path.