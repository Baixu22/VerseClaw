# RC-10 — agent-driven live acceptance

Owner policy (`AGENTS.md` §Human-in-the-loop policy): **there is no human operator.** The driver *is*
the operator, and every artifact here is labelled `driven_by: agent`. Nothing in this directory was
performed or supplied by a human.

## Current driver (2026-09-29)

H-02..H-06 now have separate real-product implementations. They use Electron,
the Main host API, the source Gateway, persistent SQLite records, and a local IRC
peer. The local model endpoint is scripted; its usage values are synthetic and
no paid provider credentials are required. All evidence is agent-driven.

```text
node artifacts/runtime-authority-convergence/rc-10/driver.mjs --list-scenarios
node artifacts/runtime-authority-convergence/rc-10/driver.mjs --repo . --development --scenario OPERATOR-ALL
pnpm run test:e2e:run tests/e2e/rc10-operator-live.spec.ts --workers=1
```

The E2E command reuses existing builds. After product source changes, build the
affected desktop/runtime once before running it. Use `check:rc10:dev` during
development; this does not launch Electron or the full acceptance suite.

The scenarios verify:

- H-02: create a command Cron job, click the real Inbox approval, observe one IRC
  result and one applied EffectReceipt.
- H-03: an IRC message drives a scripted model to create an agentTurn Cron job;
  both origin and Cron model calls have paired Context/Wire receipts, Inbox
  approves the real delivery, and the lineage endpoint links the effect.
- H-04: restart with an approval pending, read the same pending identity from
  SQLite and lineage, and observe no result delivery. The temporary intent is
  denied afterwards. This tests pending-state recovery, not continuation of an
  interrupted command after a later approval.
- H-05: restart after delivery, retain the same applied receipt/recovery record,
  and observe no repeated message.
- H-06: deny and cancel through real product paths with zero result effects;
  fork and send the product-generated handoff to a separate receiving session.
  The persisted Cron result must appear in the draft and the receiver, with
  paired receiver receipts and no replay of the original channel effect.

The startup defects from the previous round remain covered. This round also
fixes the desktop's skipped device pairing/token authentication (UI only for pairing,
then the Main backend role with its issued device token), agentTurn Cron's
missing approval wrapper, automatic failure notifications that bypassed the
approval boundary, IRC session keys rejected by ReceiptStore, and oversized
ContextCandidate references rejected during the first model call. Source labels
remain readable and full candidate identities are hashed within the existing
receipt reference bound.

Latest driver-completion evidence is under `completion-audit/`. The earlier
`operator-dev/` H-06 check is superseded because a source path alone did not
prove a useful handoff. It does not replace RC-09
Executor/Verifier acceptance or a candidate-bound RC-10 verdict. H-01's archived
run below remains historical.

## Correction (2026-09-28): the blocker was not a missing channel target

The earlier reading below ("H-02..H-06 blocked on a real channel target") was
wrong. A live probe showed the product accepted a full IRC channel config
(`channels.configured=irc`, `validateCredentials` valid) and the gateway still
never started it. Root cause, both fixed in `93b876df1`:

- **Desktop launch path** hardcoded `OPENCLAW_SKIP_CHANNELS=1` for the source
  runtime and never synced the `channels` block into the isolated source config.
- **The vendored source runtime** never called `startChannels()` from
  `startGatewaySidecars`; it only logged
  "skipping channel start (channel gateway handlers disabled)".

With both fixed, a self-hosted IRC peer observes `rc10bot` register and join
`#rc10`, and the gateway reports `irc:connected`. H-02..H-06 therefore need no
external credential; the remaining work is the driver scenarios themselves.

## Development loop (2026-09-28)

Run `pnpm run check:rc10:dev` while changing this path. It checks channel config,
sidecar startup, real IRC transport, driver arguments, types and lint without a
build or Electron launch. `test:integration` also includes the channel regression.
The supplied startChannels callback uses the real IRC client; this check does not
exercise the full plugin manager or replace live product acceptance.

The first repair rejected unimplemented scenario names rather than letting them
fall through to H-01. The current driver implements H-02..H-06 and still rejects
unknown names before credentials or side effects.

The archived RC-09 pass and H-01 run identify older candidates. They are historical
evidence, not current-head acceptance. Finish scoped development, freeze the
candidate, then execute one full Executor/Verifier cycle and the six scenarios.
Do not re-sign old results or repeat the full suite after every local edit.

## Historical H-01 provider

Owner-supplied, used through the product's own provider path (`providers.save`):

| Field | Value |
| --- | --- |
| base URL | `http://127.0.0.1:3065/v1` |
| protocol | `openai-responses` (the product appends `/responses`; matches the given endpoint) |
| model | `glm-5.3-flash` |
| key | process environment only (`RC10_PROVIDER_KEY`) — never written to any file |

Provider id inside the run is `rc10-live`. Verified live before use: `/v1/responses` answered
`PROBE_OK` and `/v1/models` listed the catalogue.

## Scenario status

| ID | Requirement | Status |
| --- | --- | --- |
| H-01 | Normal desktop task; context lineage explains selected and omitted sources; completes normally | historical **PASS** on `5512d8f9`; current frozen candidate not yet run — `acceptance/H-01/` |
| H-02 | Controlled Cron workflow; desktop Inbox decision; approval produces one effect and one receipt | implemented; current evidence: completion-audit/e2e/report.json |
| H-03 | H-02 through one real channel; delivery returns to the origin | implemented; current evidence: completion-audit/e2e/report.json |
| H-04 | Restart while approval pending; pending state recovers, no effect before approval | implemented; current evidence: completion-audit/e2e/report.json |
| H-05 | Restart after the effect completed; not repeated; recovery states what is irreversible | implemented; current evidence: completion-audit/e2e/report.json |
| H-06 | Deny, cancel, fork, hand off; denial/cancel create no effect | implemented; current evidence: completion-audit/e2e/report.json |

### H-01 evidence (`acceptance/H-01/`)

Run `3d205b8d-6483-4099-8b88-d3549d14629f` on candidate `5512d8f9`, 75 s, `stopReason=task-complete`.
The workspace's tests went `1 -> 0`: the model genuinely fixed the seeded `lineTotal` bug. Context
lineage is present as the requirement demands — 12 context receipts carrying explicit **selected (2)**
and **omitted (5)** source refs, 12 wire receipts, 6 correlation pairs. Screenshots, session
transcript, `events.jsonl`, `hashes.json` and a credential scan (0 hits) are alongside it.

## Historical investigation (superseded by the correction above)

The channel/credential blockers below describe earlier attempts, not current
requirements. Current gaps are scenario implementation and frozen-candidate
acceptance.

### Earlier diagnosis: why H-02..H-06 were thought blocked

Every remaining scenario routes through the cron announce path, whose first step is
`resolveCronAnnounceDelivery(cfg, agentId, { channel, to })`
(`openclaw_runtime/src/cron/delivery.ts:46`). That must resolve a **real channel delivery target**
before the operator-slice intent is even created, so an announce target is on the critical path of
all five scenarios — including the deny path, which resolves the target before deciding to send
nothing.

Channel survey (`openclaw_runtime/extensions/*/openclaw.plugin.json`): Discord, Slack, Telegram,
WhatsApp, clickclack and friends all require an external credential; `webhooks` is **inbound-only**
("authenticated inbound webhooks"); `qa-channel` is a test fixture and `HUMAN-ACCEPTANCE.md`
explicitly forbids fixture evidence here. A real credential is therefore a **resource** the owner has
agreed to supply, not a task-level question — see `AGENTS.md` §Human-in-the-loop policy item 4.

## Recon already done, so the next round is implementation only

- Cron surfaces: `cron.add` / `cron.run` / `cron.runs` (`cron.add` requires the `operator.admin`
  scope — `openclaw_runtime/src/gateway/methods/core-descriptors.ts:258`).
- `cron.add` payload: `delivery: { mode: "announce", channel, to, accountId? }`
  (`openclaw_runtime/src/cron/types.ts:33`), `schedule: { kind: "every" | "at" | "cron", … }`.
- Inbox surfaces: `inbox.operator.list`, `inbox.operator.decide`, `inbox.operator.lineage`
  (`openclaw_runtime/src/gateway/server-methods/inbox.ts:156-158`). Listing filters to intents whose
  `requested_by_client_id` is the operator-slice actor; decide requires a **verified device
  identity**, not a display name.
- Operator slice: `cron/delivery.ts:140` enables it when `runtime.rc05.operatorSliceEnabled` (default
  `true`, `runtime-feature-leaves.ts:180`) or `RC05_OPERATOR_SLICE`; with `cronAutoApprove` false the
  intent stays `approval_pending` for the Inbox and the ledger is marked applied **only after** the
  real send executor reports success. An approve therefore yields one effect + one receipt; a deny or
  an expiry yields zero effect.
- Operator RPCs should go over the **direct gateway websocket** with an operator token and
  `['operator.admin','operator.read','operator.approvals']`, which is the pattern
  `artifacts/live-model-cdp/20260922-senseaudio-journey-J04/driver-r3.mjs` already proves.
- Channel account configuration is a host-api module (`shared/host-api/contract.ts:5230`):
  `channels.saveConfig({ channelType, accountId?, config })` → `channels.setEnabled` →
  `channels.accounts` / `channels.targets({ channelType })` → gateway restart. That is the
  product path for installing the credential, so the driver never writes a config file by hand.
- **A webhook delivery plan carries no channel** (`cron/delivery-plan.ts:92` sets
  `channel: undefined` for `mode === "webhook"`), so the operator slice cannot be exercised through
  webhook mode — an announce *channel* is genuinely required. This was checked specifically before
  concluding that H-02..H-06 are channel-bound.
- `cron.add` shape constraints (`cron/service/jobs.ts`): `sessionTarget: "main"` requires
  `payload.kind: "systemEvent"`; channel delivery is only valid for `sessionTarget: "isolated"`,
  which needs `payload.kind: "agentTurn"`. `wakeMode: "now"` is the manual-run mode
  (`cron/isolated-agent.test-harness.ts:61-63`).

## Environment blocker: intermittent native Electron crash (0xC0000409 / 0x80000003)

Every RC-09 engineering acceptance attempt after the channel fix has come down to a **single**
electron-e2e failure that is a native Electron crash, never a product assertion:

| Attempt | Result | The failing e2e test |
| --- | --- | --- |
| `083ec4f1` | 2 e2e + 1 unit | `app-smoke.spec.ts:23:7`, `first-product-journey-fp-p1-07.spec.ts:334:7` |
| `10fa388e` | 1 e2e | `work-mode-intensity.spec.ts:138:9` (test 311 of 326) |

Playwright reports `Error: worker process exited unexpectedly (code=3221226505, signal=null)`
(0xC0000409). The Windows event log gives the real signature:

```
出错应用程序名称: electron.exe，版本: 40.8.4.0
出错模块名称: KERNELBASE.dll
异常代码: 0x80000003
错误偏移: 0x0000000000118e12
```

`0x80000003` is `STATUS_BREAKPOINT`: Chromium/Electron hit a **fatal CHECK** and called
`DebugBreak()`, whose `__fastfail` then surfaces as 0xC0000409. It strikes a different spec each
time and never the same assertion, so it is not spec-specific.

Evidence that this is resource-driven rather than a product defect:

- `%LOCALAPPDATA%\CrashDumps` holds 10 `electron.exe.*.dmp` minidumps since 2026-09-27 14:13, and
  dumps also exist from windows where the acceptance **passed** — the crash is frequent and only
  fails a test when it lands mid-test.
- During the attempts the machine sat at **30.3 GB commit of a 50.9 GB limit with 2-4 GB free RAM**
  (15.2 GB physical), and V8/Chromium OOM is a fatal-CHECK path.
- Both crashed specs pass **4/4 in isolation**, and the attempt that failed at test 311 of 326
  otherwise reported 315 passed / 1 failed / 10 skipped.

Mitigations applied for the retry: kill every leftover `electron.exe` before launching, run the
acceptance as a detached process, and keep monitoring to process counts / RAM only — the earlier
recursive directory scans over the multi-GB worktree were themselves load during the e2e phase.

## RC-10 defect: configuring a bundled channel makes the gateway refuse to start

Reproduced end to end and root-caused on 2026-09-27 (probe run `2026-09-27T12-41-43-821Z`). This is why
H-02..H-06 cannot run: every one of them needs an announce channel, and installing one bricks the
gateway.

**The chain, from the app log:**

1. `channels.saveConfig({ channelType: "qqbot", … })` returns `ok: true` and logs
   *"Channel config saved {channelType: qqbot, accountId: default, configFile: …}"*, then
   *"Installed QQBot plugin from bundled mirror"*.
2. The app restarts the gateway. The new gateway process exits with code 1 and its stderr says:
   ```
   Error: Invalid config at …\user-data\openclaw-source-state\openclaw.json.
   plugins.entries.qqbot: Invalid input
   Run "openclaw doctor --fix" to repair, then retry.
   ```
3. The app detects an invalid config and runs its recovery path, `doctor --fix`. That recovery path
   then throws and replaces the real error:
   ```
   TypeError: Invalid value for env
       at new ForkUtilityProcess (electron browser_init)
       at async Object.runDoctorRepair
   ```

**Two distinct defects, each proven:**

- **A — the saved plugin entry violates the runtime schema.**
  `plugins.entries.qqbot` is written as `{ enabled, accounts, defaultAccount }`, but
  `PluginEntrySchema` (`openclaw_runtime/src/config/zod-schema.ts:745-774`) is `.strict()` and accepts
  only `enabled`, `hooks`, `subagent`, `llm`, `config`. The two channel-shaped keys are unknown, so the
  strict object rejects the snapshot and the gateway refuses to start. Any bundled channel therefore
  bricks the gateway. Note the split that makes it worse: the channel account itself is written to the
  *isolated* `home/.openclaw/openclaw.json` (`channels.qqbot.accounts.default`), while the entry the
  gateway validates lives in `user-data/openclaw-source-state/openclaw.json` — which carries no
  `channels.qqbot` at all.
- **B — the recovery path cannot run, and hides A.**
  `electron/gateway/supervisor.ts:304-310` builds the doctor-repair fork env as
  `OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : baseEnvPatched.OPENCLAW_SKIP_CHANNELS`.
  When the variable is unset and `skipChannels` is false the value is `undefined`; Electron's
  `utilityProcess.fork` rejects non-string env values with `TypeError: Invalid value for env`. A local
  check confirms the message is Electron's, not Node's — `child_process.spawnSync` accepts object,
  `undefined` and number env values without complaint. So the app's own repair path crashes and its
  error replaces the actionable "invalid config" diagnostic.

**Working around A is not possible from the driver.** Supplying the credential through the manifest's
`channelEnvVars` avoids the bad entry and the gateway does start healthy — but the product then
registers no account and knows no target (`channels.configured` → `[]`,
`channels.targets` → `[]`), so a cron announce still has nothing to resolve.

**Not patched on purpose.** Fixing A touches `electron/` product code, which would move the candidate
past the already-accepted RC-09 commit `ae489d4a5` and invalidate that engineering acceptance. That is
a scope decision for the owner, not something an acceptance run should decide by itself.

### Status: A and B fixed and verified (2026-09-27, owner-authorized)

The owner authorized fixing both and re-running the RC-09 engineering acceptance. Commit `bd42f81c3`:

- **A** — `saveChannelConfig` no longer mirrors the channel account map into `plugins.entries.<id>`;
  the entry carries enablement only, and the account stays in `channels.<id>`. Nothing read the
  mirrored copy: account read-back goes through `channels.<id>`, and `setEnabled` already wrote
  `enabled` alone.
- **B** — `runOpenClawDoctorRepair` coerces both skip-channels fallbacks to `''`, so the recovery path
  can no longer replace the real diagnostic with `TypeError: Invalid value for env`.

Tests: `tests/unit/channel-config.test.ts` now asserts the plugin entry carries no
`accounts`/`defaultAccount` and that the account map stays in `channels.<id>` (17 passing), and the new
`tests/unit/gateway-doctor-repair-env.test.ts` reads the fork env and **was verified to fail without
fix B** by reverting it (`AssertionError: expected [ [ 'OPENCLAW_SKIP_CHANNELS', … ] ] to deeply equal []`).

End-to-end verification after rebuilding Electron — CHANNEL-PROBE run `2026-09-27T13-26-59-074Z`, a
path that previously crashed:

| Observation | Before | After |
| --- | --- | --- |
| `gateway.restart` | `{"code":"INTERNAL","message":"Invalid value for env"}` | `ok`, path `restart` |
| Gateway health | `state: error`, never ready | `healthy`, `reasons: []` |
| `channels.configured` | `[]` | qqbot, `defaultAccountId: default`, account `configured: true`, `isDefault: true` |
| Gateway stderr | `plugins.entries.qqbot: Invalid input` | no config error |

The channel still reports `disconnected`/`connected: false` and `channels.targets` is still empty, so
H-02..H-06 still need a QQ delivery target before the announce can resolve.

## Channel findings (2026-09-27)

1. **No bundled channel could be configured at all until the plugin mirrors existed.** The first
   `channels.saveConfig` failed with `Bundled QQBot plugin mirror not found`, and
   `build/openclaw-plugins` was entirely absent from the checkout. `pnpm run bundle:openclaw-plugins`
   creates it (qqbot, discord, whatsapp, wecom, dingtalk, feishu-openclaw-plugin, openclaw-weixin).
2. **A config-configured channel account breaks gateway start-up.** With the qqbot account saved,
   `gateway.restart` returns `{"code":"INTERNAL","message":"Invalid value for env"}` and
   `gatewayReady` never becomes true. The account is written correctly to the *isolated* profile
   (`channels.qqbot.accounts.default` in `…/home/.openclaw/openclaw.json`), and the owner's real
   `~/.openclaw/openclaw.json` stays untouched — so this is a product bug in the gateway start-up
   environment assembly, not a driver or credential problem. Likely locus:
   `electron/gateway/config-sync.ts` (provider keys, DCS flags, source-runtime isolation env).
3. **Credentials supplied through the channel's declared `channelEnvVars` avoid that crash.** With
   `QQBOT_APP_ID` / `QQBOT_CLIENT_SECRET` on the Electron process (`RC10_CHANNEL_VIA=env`) the
   gateway starts and reports `healthy`. But the product then registers **no account**
   (`channels.configured` → `[]`) and knows **no target** (`channels.targets` → `[]`), so a cron
   announce still has nothing to resolve.
4. `channels.validateCredentials` returns `valid: true` together with the warning *"No online
   validation available for this channel type"*. That is a structural pass and must **not** be read
   as proof the credential reaches QQ; live connectivity still has to be proven separately.

### What H-02..H-06 still need

- A **QQ delivery target** the bot may push to (group or user id). `channels.targets` is empty, so
  nothing can be discovered locally. H-03's "delivery returns to the origin" also has to work
  without a human action, because the owner performs none.
- Either the config-account start-up bug fixed, or a supported way to register an account that does
  not go through it.

## Findings recorded while getting H-01 green

1. **A non-`fullAccess` workspace hangs the agent.** In `acceptEdits` the model's `edit` call never
   settles; the gateway's stuck-session watchdog then calls `abort_embedded_run` (556 s) and
   synthesises an `aborted` tool result, so the task can never finish. This is the known residual that
   a non-fullAccess workspace waits on an approval with no in-app entry point. H-01 therefore runs
   `fullAccess`; H-04/H-06 will exercise the approval path deliberately.
2. `runtime_receipts` lives in `<userData>/openclaw-source-state/state/openclaw.sqlite`. The lineage
   columns are `selected_json` / `omitted_json` (digests and refs only — never raw prompt or tool
   text), and `kind` includes `shadow_context` / `shadow_wire` as well as `context` / `wire`.

## Reproducing

```bash
RC10_PROVIDER_KEY=... RC10_PROVIDER_BASE_URL=http://127.0.0.1:3065/v1 RC10_PROVIDER_MODEL=glm-5.3-flash \
  node artifacts/runtime-authority-convergence/rc-10/driver.mjs --scenario H-01 --timeout-min 12
```

Raw runs go to `%LOCALAPPDATA%/ClawX-live-data/rc10/<scenario>/<stamp>/`; only the curated evidence is
copied into `acceptance/` here. The driver requires a clean worktree and refuses to run otherwise.
