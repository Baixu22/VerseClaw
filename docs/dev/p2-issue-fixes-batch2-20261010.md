# P2 issue batch 2: Gateway endpoint single source, Session Activity unknown state, error-message i18n

Date: 2026-10-10 (agent-driven)
Base: private `main` = `c0dfc7ded` ("fix(harness,repo): close P2 batch 1")
Issues closed by this change: **#89, #121, #120** (all `[P2]`).

This batch fixes two user-visible defects and one duplicated-source-of-truth
defect. No product default value, feature flag, product lock, packaged artifact
or release state changes, and no claim of human execution is made anywhere here.

## #89 - Gateway port hardcoded in eight-plus places

**Reported:** five literal sites plus rule-detection regexes and localized copy.

**Verified:** the literal appeared in eleven production sites across four layers:
`electron/utils/config.ts` (its own "constant"), `electron/utils/store.ts` and
`src/stores/settings.ts` (defaults), `src/stores/gateway.ts` (initial status),
`src/lib/mock-host-bridge.ts` (fixture), `electron/main/index.ts` (Control-UI
header-override URL filter), three rule-detection regexes plus the generated
`AGENTS.md` copy in `electron/services/project-rules-api.ts`, comments in
`electron/utils/webview-security.ts` and `src/stores/chat/runtime-event-actions.ts`,
and four localized `settings.renderer.gatewayFetchBanMissing.description` strings.

**Change**

- New `shared/gateway-endpoint.ts` is the single source: `OPENCLAW_GATEWAY_PORT`,
  the loopback hosts, the derived `host:port` pairs, HTTP origins, webRequest URL
  filters, a regex-escaped alternation source and a human-readable list formatter.
- Every site above derives from it. The rule detector builds its three regexes
  from `GATEWAY_HOST_PORT_REGEX_SOURCE`, `hasGatewayFetchBan` checks the derived
  pairs, and the generated `AGENTS.md` line uses `formatGatewayHttpOrigins()`.
- Localized copy no longer names the port; it says "the local Gateway endpoint",
  so translated text cannot go stale when the port changes.
- The per-process override (`VERSE_CLAW_PORT_OPENCLAW_GATEWAY`) is unchanged: the
  constant is the default, not a hard-coded runtime value.

**Guard:** `tests/unit/gateway-endpoint-single-source.test.ts` fails if `18789`
appears in any file under `electron/`, `src/` or `shared/` other than the
constant module, and pins the derived pairs/origins/filters/copy/regex-escaping
so a port change cannot silently change their shape. Rule:
`harness/specs/rules/gateway-endpoint-single-source.md` (added).

**Boundary:** documentation (this file, `AGENTS.md`, READMEs) may still state the
default port in prose; that is descriptive text, not a load-bearing duplicate.

## #121 - background activity read failure rendered as empty

**Verified at HEAD:** `readGoalWakeRowsForSession` caught query failures and
returned empty arrays; Main marked `runtimeAvailable = true` for any *fulfilled*
RPC even without a projection; the renderer store never consumed that flag and
replaced the snapshot with an empty seed before every read; and the panel only
warned for git/terminal availability, returning `null` when nothing else existed.
A failed background read therefore looked exactly like "no background activity".

**Change (owner -> gateway -> Main -> store -> panel)**

- `session-lifecycle-owner-views.ts`: the goal-wake read returns
  `read: 'known' | 'unknown'` and `collectSessionLifecycleOwnerViews` carries it
  as `goalWakeRead`; the function still never throws (the ledger's
  degrade-to-omission contract is unchanged).
- `session-activity-projection.ts` / `session-activity.ts`: the projection now
  reports `ownerRead` and the `session.activitySnapshot` handler forwards it, so
  a goal-wake DB failure inside the gateway no longer arrives at Main as a
  successful empty projection.
- `electron/services/session-activity-api.ts`: `known` requires the RPC to
  resolve **and** report `ownerRead: 'known'`; `ownerRead: 'unknown'` marks the
  read failed (`failedAt`) and keeps `runtimeAvailable` false; a response that
  omits the state stays unknown without a failure mark; an unsupported RPC stays
  unknown and silent.
- `shared/types/session-activity.ts`: `backgroundRead { state, readAt, failedAt }`
  plus `backgroundReadFailed()`; empty snapshots seed `unknown` (unread is not
  read-empty) and `classifySessionActivity` escalates a failed read so the rail
  can appear even when the card would otherwise be empty.
- `src/stores/session-activity.ts`: `load` keeps the previous snapshot, a failed
  read preserves the last good `readAt` (stale marking) instead of erasing rows.
- `SessionActivityPanel.tsx`: `session-activity-background-unknown` with the
  existing retry affordance, and `session-activity-background-stale` for retained
  rows; both are reachable in the early-return path.
- `chat.json` (en/zh/ja/ru): `sessionActivity.background.unknown` / `.stale`.

**Tests:** `tests/unit/session-activity-{background-read,owner-read-status}.test.ts`
(table-driven: RPC timeout, owner-read exception, missing projection, missing
snapshot, unsupported RPC, gateway-reported owner-read failure, omitted read
state, successful-empty, run-ended-with-live-background-work, recovery and stale
marking), extended `session-activity-panel.test.tsx`, and the runtime shard
(`session-activity*.test.ts`, `session-lifecycle-*`) including a new handler case
proving `ownerRead: 'unknown'` reaches the response.

## #120 - unified user error exit hardcoded English

**Verified at HEAD:** `error-message.ts` returned English prose per class,
`user-error.ts` i18n'd only the error-reference label, the unit test pinned
English as the contract, and the runtime provider classifier returned English
prose. `normalizeAppError` classified mostly from the raw message string, and
`invokeHost` still drops structured error fields (issue #118, confirmed open).

**Change**

- `error-model.ts`: `AppErrorCode` / `APP_ERROR_CODES` gain `AUTH_PERMANENT`,
  `BILLING`, `OVERLOADED`, `MODEL_NOT_FOUND` and `CONVERSATION_STATE` (an
  existing provider class that had no home in the taxonomy). A structured
  `ErrorSignals` layer reads `code`/`status`/`reason` from the thrown value and
  its `cause`/`error`/`response`/`data` chain; `classifySignals` runs **before**
  the message heuristic, so changing the display language cannot change the
  class. Explicit `AppError` codes stay authoritative.
- `error-message.ts`: one copy table keyed by
  `common:errors.<slug>.{what,responsibility,nextStep}` (built by
  `errorCopyKeys()` so the scheme cannot drift), resolved through the existing
  renderer i18next instance; per-class `action` and `retryable`. `UNKNOWN` keeps
  redaction and now falls back to localized copy instead of English.
- `user-error.ts`: `describeUserError` returns the localized message plus
  responsibility/next-step, an action and a retryability flag; the toast keeps
  the error reference and the UNKNOWN/redaction behaviour.
- `shared/i18n/locales/{en,zh,ja,ru}/common.json`: `errors` block, 14 slugs ×
  three parts, existing `common` namespace (no new namespace, `resources.ts`
  untouched).
- `provider-request-error-classifier.ts`: returns neutral `reason` +
  `messageKey` + params; `technicalMessage` is redacted while detection keeps
  reading the raw text, so redaction cannot change the class.
- Retry affordances became explicit: `verify_then_retry` (timeout may already
  have had an upstream effect), `wait_then_retry` (rate limit / overloaded),
  and non-retryable `fix_credentials` / `top_up_balance` / `choose_another_model`
  / `start_new_session` for refusal, billing, model and conversation-state
  classes.

**Residuals (recorded, not hidden)**

- The `invokeHost` layer still forwards only `error.message` (#118), so the
  renderer reaches the structured path only when the throwing layer preserves
  `code`/`status`/`reason`; the E2E therefore exercises the untranslated-message
  fallback while the structured classifier is unit-tested. No further mapping
  change is needed once #118 lands.
- The runtime keeps `userMessage` (English) for its non-renderer chat-channel
  consumer, which is outside this batch's scope and is documented in the code.

## Gates executed on the candidate (agent-driven)

| Gate | Command | Result |
| --- | --- | --- |
| Related unit suites | `node node_modules/vitest/vitest.mjs run <20 files>` | 20 files / **116 tests passed**, exit 0 |
| Runtime gateway shard | `node node_modules/vitest/vitest.mjs run --config test/vitest/vitest.gateway-methods.config.ts <4 files>` | 4 files / **36 tests passed**, exit 0 |
| Typecheck (node/web/test) | `tsgo --noEmit -p tsconfig.{node,web,test}.json --composite false` | all exit 0 |
| i18n lint | `node scripts/i18n-lint.mjs` | `i18n lint passed.`, exit 0 |
| Lint (changed files) | `node node_modules/eslint/bin/eslint.js <all changed TS/TSX> --max-warnings 120` | exit 0 (1 pre-existing `any` warning in `electron/main/index.ts`, within the repo budget) |
| Comms regression | `node scripts/comms/replay.mjs` + `node scripts/comms/compare.mjs` | exit 0, all metrics PASS (0.00% deltas) |
| Electron E2E | build (`vite build`, main + renderer) then `playwright test tests/e2e/error-i18n.spec.ts tests/e2e/session-activity-background-read.spec.ts --workers=1` | **4 passed** (50.9s), exit 0 |
| Harness spec | `node harness/src/cli.mjs validate --spec harness/specs/tasks/p2-issue-fixes-batch2-20261010.md` | `Spec is valid`, exit 0 |
| Policy docs | `node scripts/validate-policy-docs.mjs` | 10 checks PASS, exit 0 |
| Artifact retention | `node scripts/check-repository-artifacts.mjs` | passed (18018 tracked paths) |
| Whitespace | `git diff --check` / `git -c core.whitespace=cr-at-eol diff --check` | see note below |

**Whitespace note:** `git diff --check` reports trailing whitespace on the two
lines added to `electron/main/index.ts`. That file is stored as CRLF
(`git ls-files --eol` -> `i/crlf w/crlf`), so git's default whitespace rules
treat the CR at end of line as trailing whitespace. With the correct setting for
a CRLF file (`core.whitespace=cr-at-eol`) the same diff is clean. Nothing was
re-encoded; the same condition is recorded in the earlier P1 handoff.

**Credential scan:** 2 hits over the 51 changed files, both the synthetic
`sk-` + digit-ramp redaction fixture in `tests/unit/user-error.test.ts` (the test
that proves UNKNOWN redaction). The evidence driver classifies them as
`synthetic-redaction-fixture`; 0 unreviewed findings.

**Environment note:** the Electron E2E gate needs the pinned Node 24.16
(`scripts/windows-test-node.mjs` rejects Windows Node 24.0-24.15) and an Electron
binary that this checkout lacked; the binary was installed into the existing
`node_modules` (postinstall had not run) and the specs were executed with
`D:\ClawX\resources\bin\win32-x64\node.exe` (v24.16.0). This is environment
repair, not a product change.

## Boundaries

- Not run: full repository unit suite, full `harness:ci`, Agent Dev deep-test or
  audit, packaging/installer, cross-platform checks, real provider calls.
- `pnpm run <script>` cannot be used in the junction-based candidate worktree
  (pre-run dependency verification aborts without a TTY); the wrapped `node`
  commands were invoked directly, and `playwright` was invoked through its CLI
  with the pinned Node.
- Evidence is `driven_by: agent`; no human action, verdict or data is claimed.
