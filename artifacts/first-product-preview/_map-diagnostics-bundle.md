FP-P1-06 is already implemented end-to-end in the working tree (uncommitted). Here is the map.

## Bottom line

**FP-P1-06 already exists as uncommitted work in the tree.** `git status` shows `M electron/services/diagnostics-api.ts` plus untracked `electron/services/support-bundle.ts`, `tests/unit/support-bundle-redaction.test.ts`, `tests/e2e/support-bundle-fp-p1-06.spec.ts`. The full path — contract type → main-process builder → preload/host-api → Settings UI button → i18n (en/ja/ru/zh) → unit + e2e tests — is wired. What is left is verification/commit, not construction.

---

## 1. `electron/services/diagnostics-api.ts` (87 lines)

Two RPC methods on the `diagnostics` service:

| Method | Returns |
|---|---|
| `gatewaySnapshot()` | `capturedAt`, `platform`, `gateway` (status + `buildGatewayHealthSummary` + capability snapshot), `sandbox` (`buildSandboxStatus`), `channels` (`buildChannelAccountsView({probe:false})`), and three log tails: `verseClawLogTail`, `gatewayLogTail`, `gatewayErrLogTail` |
| `exportSupportBundle()` | Delegates to `exportSupportBundle({ gatewayManager })` from `./support-bundle` |

Local helper `readTail(filePath, tailLines=200)` reads backwards in 64 KiB chunks. `gatewaySnapshot` is **in-memory only** — no export-to-file. The export capability lives entirely in `support-bundle.ts`.

Contract: `shared/host-api/contract.ts:4770-4773` (`diagnostics: { gatewaySnapshot, exportSupportBundle }`), result type `SupportBundleExportResult` at `contract.ts:1891`. Renderer binding: `src/lib/host-api.ts:1183-1186`.

## 2. Child counters — the real gap

`openclaw_runtime/src/context-engine/dcs-observability.ts` (272 lines) exports singleton `dcsObservability` with `DcsObservabilitySnapshot`: ~28 counters covering CVK/DCS injection calls+chars, `injectionDuplicateSuppressions`, workspace scope bind/invalidate, `contextLadderActionHits` (map), VToken assembly (calls/successes/errors/chars/tokens/sources), context orchestrator (calls/killSwitchHits/errors/charsAdded), injection budget (overflows/truncations/drops/requested/applied), and turn injection accounting (turns/killedTurns/applied/requested/dropped/truncated/dropAlerts). Also has `writeSoakSnapshot(targetDir)` — an explicit operator-only on-disk dump, never auto-called.

`coding-observability.ts` (260 lines) exports singleton `codingObservability` with `CodingObservabilitySnapshot` (~40 counters: factstore hits/misses, touch latency, stale blocks, journal latency/failures, undo, syntax/diag/verify, approvals, wave conflicts, writeSet prediction, merge, taskPass/Fail, `compactionLayerHits`), plus `rates()` (10 derived ratios) and `CODING_METRIC_NAMES`.

**RPC bridge — partial.** There is no dedicated observability-counter RPC. The only channel is `runtime.flags.ack` (`openclaw_runtime/src/gateway/server-methods/runtime-flag-ack.ts:21`, descriptor `openclaw_runtime/src/gateway/methods/core-descriptors.ts:25`, scope `operator.read`). Inside, `openclaw_runtime/src/context-engine/runtime-flag-ack.ts:275` calls `readInjectionBudgetEvidence()` → `dcsObservability.snapshot()` but **projects only the 7 `turnInjection*` counters** into `injectionBudget.counters`.

So today the bundle mirrors 7 of ~28 DCS counters and **0 of ~40 coding counters**. `codingObservability.snapshot()` has exactly one non-test caller repo-wide (`coding-long-chat-curve.ts:177`) — it is unreachable from the main process. Widening this means either extending `RuntimeFlagAckPayload.injectionBudget` or adding a new `operator.read` method (e.g. `runtime.observability.snapshot`).

Note `electron/services/observability-api.ts` is a **different** subsystem (traces/spans dashboard: `dashboardSnapshot`, `traces`, `trace`, `reportTrace`, `queryTraces`, `traceGraph`, `traceNodeDiagnostics`, `clearTraces`) — not DCS/coding counters.

## 3. Redaction utilities

Bundle-specific (in `electron/services/support-bundle.ts`), two pure exported functions:
- `redactSupportBundleText(text)` → `{ sanitized, findings }`, 8 patterns: `openai-style-key`, `anthropic-key`, `github-token`, `aws-access-key`, `slack-token`, `bearer-token`, `env-assignment`, `windows-user-path`, `home-user-path`
- `verifyRedaction(sanitized)` → array of still-matching types; non-empty ⇒ export aborts (hard lock)

Pre-existing utilities available for reuse:
- `electron/utils/logger.ts:104` `redactLogText()` — the strongest set (canary tokens, Bearer/Basic, sk-/sk-proj-/sk-ant-, ENV assignment, JSON `"apiKey":"..."`, Authorization / X-Api-Key headers). Already applied before ring-buffer and disk, so `logger.readLogFile()` output is pre-redacted.
- `electron/services/observability-redaction.ts` — `sanitizeAttributes`, `summarizeRedactedContent`, `contentFingerprint`, `sanitizeTraceForPersistence`, `truncatePreview`
- `electron/utils/channel-config.ts:28,35` `redactChannelSecretValue` / `redactChannelFormValues`
- `electron/gateway/ws-trace.ts:17` `redactGatewayFrameForTrace`
- `shared/mcp/secret-ref.ts:41` `redactMcpEnvMap`; `shared/agent-browser/network-context.ts:20,32,42`; `shared/verseshell/extraction.ts:94` `redactApprovalSecrets`; `shared/privacy/ui-error-sanitize.ts:7`
- `electron/main/ipc/host-invoke-security.ts:105` `sanitizeHostErrorMessage`

## 4. Provider credential storage

Two-layer. `electron/utils/store.ts` (320 lines, `electron-store`) holds **settings only, no provider keys** — but does hold `gatewayToken` (sealed via `safeStorage`, `sealGatewayToken`/`openGatewayToken`, decrypted transparently by `getSetting('gatewayToken')`). **`getAllSettings()` returns the raw store including `gatewayToken`** — `support-bundle.ts` correctly cherry-picks fields and never spreads `settings`.

Real key store: `electron/services/secrets/secret-store.ts` (`getProviderSecret` / `setProviderSecret` / `deleteProviderSecret` / `hasProviderSecret` / `listProviderSecretAccountIds`), encrypted at rest as `{ format: 'safeStorage-v1', ciphertext }`. Legacy wrapper `electron/utils/secure-storage.ts:36,54` (`storeApiKey` / `getApiKey`).

Shape to redact against — `electron/shared/providers/types.ts:188`:
```ts
export type ProviderSecret =
  | { type: 'api_key'; accountId: string; apiKey: string }
  | { type: 'oauth'; accountId: string; accessToken: string; refreshToken: string;
      expiresAt: number; scopes?: string[]; email?: string; subject?: string }
  | { type: 'local'; accountId: string; apiKey?: string };
```
The `oauth` variant (`accessToken` / `refreshToken`, opaque, no `sk-`/`gh` prefix) is **not matched by any pattern in `REDACTION_PATTERNS`** unless it happens to appear after `Bearer ` or in an `env-assignment`. `logger.redactLogText` does cover `"accessToken":"..."` / `"refreshToken":"..."` JSON forms; `support-bundle.ts` does not. That is the main redaction gap worth closing.

The bundle currently emits provider **type + verification state only** (`vendorId`, `authMode`, `enabled`, `hasKey` boolean, `validation`) via `listProviderAccounts()` + `getProviderService().listAccountsKeyInfo()`. Note `listAccountsKeyInfo()` also returns `keyMasked` (`maskApiKey` at `provider-service.ts:45`, first-4 + stars + last-4) — the bundle correctly reads only `hasKey`.

## 5. Settings components

`src/components/settings/` contains 7 files: `AgentDevWorkbenchPanel.tsx`, `ContextLayersExplainer.tsx`, `DcsProdFlagsPanel.tsx`, `ImageGenerationSettings.tsx`, `ProjectRulesCenter.tsx`, `ProvidersSettings.tsx`, `VtokenBridgePanel.tsx`.

The export button is **not** in any of these — it lives inline in `src/pages/Settings/index.tsx`, in the `system` section (state at lines 565-589, JSX at 1651-1680), `data-testid="settings-support-bundle"` / `settings-support-bundle-export` / `settings-support-bundle-result`. i18n key `supportBundle.*` in `shared/i18n/locales/{en,ja,ru,zh}/settings.json`.

The only other observability surface is `DcsProdFlagsPanel.tsx:632-680` (`settings-dcs-observability-panel`), which renders `DcsProdObservabilitySnapshot` — kill-switch state, view-tools env, enabled writable flag ids. It shows **no numeric counters**, so it is the natural host if counter display is wanted alongside the export.

## 6. Archives

- Root `package.json`: `tar ^6.2.1` only. **No `jszip`, `adm-zip`, `archiver`, or `yauzl` at the app level.**
- `openclaw_runtime/package.json`: `jszip 3.10.1` and `tar 7.5.15`.

The runtime already has a complete, more mature bundle writer that the Electron implementation did not reuse:
- `openclaw_runtime/src/logging/diagnostic-support-bundle.ts` (143 lines) — `jsonSupportBundleFile`, `jsonlSupportBundleFile`, `textSupportBundleFile`, `supportBundleContents`, `writeSupportBundleDirectory`, `writeSupportBundleZip` (dynamic `import("jszip")`, DEFLATE level 6, mode `0o600`, dirs `0o700`), with path-traversal guards (`assertSafeBundleRelativePath` + `isPathInside` re-check after `path.resolve`)
- `openclaw_runtime/src/logging/diagnostic-support-export.ts` (812 lines) — `buildDiagnosticSupportExport`, `writeDiagnosticSupportExport`, `DiagnosticSupportExportManifest`, version const
- `openclaw_runtime/src/logging/diagnostic-support-log-redaction.ts` (219 lines) — `sanitizeSupportLogRecord`
- `openclaw_runtime/src/logging/diagnostic-stability.ts` (774 lines)

**The Electron implementation writes a single plain `.json` file, not an archive** — `join(app.getPath('userData'), 'support-bundles')`, filename `verse-claw-support-<iso>.json`, 5 MiB cap with log-tail-drop-first degradation. If a true archive is required, `writeSupportBundleZip` is the ready-made primitive but `jszip` would need hoisting to the root `package.json`.

---

## Exists vs must be built

**Exists (working tree, uncommitted):** the whole feature — `SupportBundleExportResult` contract type, `buildSupportBundle`/`exportSupportBundle`, 8-pattern redaction with fail-closed verification, redaction report embedded in the output, provider-type-only projection, `runtimeMirror` from live `runtime.flags.ack`, journal summary (paths + `hadPrior` + `toolName`, never contents, capped 20 sessions × 100 metas), size cap, host-api binding, Settings UI button, 4-locale i18n, unit test (5 planted fake secrets), e2e test (real Electron + real gateway child, plants a key in secure storage and a key-shaped label).

**Must be built (if the task demands full counter mirroring or an archive):**
1. Widen the child→main counter channel. `runtime.flags.ack` exposes only 7 `turnInjection*` counters; the other ~21 DCS counters and **all** `codingObservability` counters have no RPC path. Needs either an extended ack payload or a new `operator.read` gateway method.
2. Cover the `oauth` `ProviderSecret` variant (`accessToken` / `refreshToken`) in `REDACTION_PATTERNS` — currently only caught incidentally via the `bearer-token` pattern.
3. Zip/archive output, if `.json` is insufficient — requires hoisting `jszip` to the root `package.json` or reusing the runtime writer across the process boundary.

**Key files (absolute):**
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\electron\services\diagnostics-api.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\electron\services\support-bundle.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\src\context-engine\dcs-observability.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\src\context-engine\coding-observability.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\src\context-engine\runtime-flag-ack.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\src\gateway\server-methods\runtime-flag-ack.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\openclaw_runtime\src\logging\diagnostic-support-bundle.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\electron\services\secrets\secret-store.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\electron\shared\providers\types.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\electron\utils\logger.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\src\pages\Settings\index.tsx`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\shared\host-api\contract.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\unit\support-bundle-redaction.test.ts`
- `C:\Users\27933\Desktop\clawx\ClawX-maturity-p0\tests\e2e\support-bundle-fp-p1-06.spec.ts`