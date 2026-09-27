# RC-10 — agent-driven live acceptance

Owner policy (`AGENTS.md` §Human-in-the-loop policy): **there is no human operator.** The driver *is*
the operator, and every artifact here is labelled `driven_by: agent`. Nothing in this directory was
performed or supplied by a human.

## Provider

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
| H-01 | Normal desktop task; context lineage explains selected and omitted sources; completes normally | **PASS** — `acceptance/H-01/` |
| H-02 | Controlled Cron workflow; desktop Inbox decision; approval produces one effect and one receipt | blocked on a real channel target |
| H-03 | H-02 through one real channel; delivery returns to the origin | blocked on a real channel target |
| H-04 | Restart while approval pending; pending state recovers, no effect before approval | blocked on a real channel target |
| H-05 | Restart after the effect completed; not repeated; recovery states what is irreversible | blocked on a real channel target |
| H-06 | Deny, cancel, fork, hand off; denial/cancel create no effect | blocked on a real channel target |

### H-01 evidence (`acceptance/H-01/`)

Run `3d205b8d-6483-4099-8b88-d3549d14629f` on candidate `5512d8f9`, 75 s, `stopReason=task-complete`.
The workspace's tests went `1 -> 0`: the model genuinely fixed the seeded `lineTotal` bug. Context
lineage is present as the requirement demands — 12 context receipts carrying explicit **selected (2)**
and **omitted (5)** source refs, 12 wire receipts, 6 correlation pairs. Screenshots, session
transcript, `events.jsonl`, `hashes.json` and a credential scan (0 hits) are alongside it.

## Why H-02..H-06 are blocked, and on exactly what

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
