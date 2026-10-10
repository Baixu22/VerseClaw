# P2 issue batch 4: gateway argv secret, error-governance calibration, endpoint request budget

Date: 2026-10-10 (agent-driven)
Base: private `main` = `15f0327b5` ("fix(eval): bind each LoCoMo score to its live judge receipt")
Issues closed by this change: **#130, #115, #123** (all `[P2]`).

This batch removes a credential exposure from the Gateway launch path, calibrates
the error/problem governance draft into decisions the tree can actually enforce,
and gives the enabled OpenAI-compatible HTTP endpoints a post-authentication
request budget. No tool policy, product default value, frozen product lock,
packaged artifact or release state changes, and no claim of human execution is
made anywhere here.

## #130 - the shared Gateway token was passed in the process argv

**Verified at HEAD:** `electron/gateway/config-sync.ts` built
`['gateway', '--port', <port>, '--token', appSettings.gatewayToken, '--allow-unconfigured']`;
`electron/gateway/process-launcher.ts` sanitized that argv **only for the log
line** and forked the child with the raw `finalArgs`; `electron/gateway/manager.ts`
redacted `--token` in a summary string. The token was therefore visible to any
same-user process that can read another process's command line.

**Change**

- `buildGatewayProcessArgs(port)` (new, exported) is the single launch-args
  builder for both runtime modes and deliberately emits no secret flag. The token
  reaches the Gateway through `OPENCLAW_GATEWAY_TOKEN` in the fork environment,
  which was already set; `batchSyncConfigFields` additionally persists
  `gateway.auth.mode = "token"` and the token into the runtime `openclaw.json`
  before launch, so the server has a config source as well.
- `stripGatewaySecretArgs(args, secrets)` (new, exported) is the second line of
  defence: if a future edit puts `--token` / `--password` / `--gateway-token`
  back into the launch args, the launcher strips the flag+value pair from the
  **real** spawn argv (logged without the value) instead of passing it to the
  child. Values that do not match a known secret are left untouched.
- `utilityProcess.fork` now receives the guarded args.

**Tests:** `tests/unit/gateway-argv-secret-exposure.test.ts` (8) pins the builder,
the strip helper (all three flags, non-matching values, valueless flag, no
mutation) and a real child process: a positive control proves an explicit
`--token` is observable in the OS-delivered argv, and the fixed path proves the
child's argv carries no token while `OPENCLAW_GATEWAY_TOKEN` still reaches it.
`tests/unit/gateway-env-token-auth.test.ts` (4) proves the runtime resolves token
auth from the environment alone and does not mint a replacement token. The
existing `tests/integration/channel-startup.integration.test.ts` now asserts the
real `prepareGatewayLaunchContext` output: token-free `gatewayArgs` plus the env
token.

**Environment limitation (recorded, not hidden):** external command-line readback
is unavailable on this machine — `Win32_Process.CommandLine` via
`Get-CimInstance` returned an empty string and `wmic` reported "No Instance(s)
Available" for a child this session had just started. The probe therefore asserts
the argv the operating system delivered to the child (`process.argv` written by
the child) rather than reading it from a third process. The exposure claim from
the audit is not re-demonstrated here; the fix is verified at the argv-content
level plus the retained env/config auth sources.

**Related exposure not fixed in this batch:**
`electron/utils/control-ui-device-pairing.ts:125` still passes `--token <value>`
to the short-lived `devices approve` child. It is the same class of defect but a
different code path and outside issue #130's scope; it is recorded here as a
follow-up candidate.

## #115 - error-governance draft could not be used as an effective spec

**Verified in the current tree:** `HostResponse` really is declared twice
(`shared/host-api/types.ts` renderer-facing with optional `id`/`error`, and
`electron/main/ipc/host-contract.ts` Main-facing with required
`error.code`/`message`); a **third** `AppErrorCode` union lives in
`electron/main/ipc/request-helpers.ts`; `src/lib/host-api-client.ts` throws a bare
`Error` built from `error.message`, dropping `code`/`details`; `src/lib/error-model.ts`
has no `CODE_SIGNALS` entry for `INTERNAL`, so it classifies as `UNKNOWN`; the
waiting/approval unions are `AgentBrowserTaskStatus` (8 members) and
`AgentBrowserTaskApproval.status` (4 members). The draft's cited documents and
identifiers (`docs/governance/manus-alignment-*`, `DEC-2x`, "100 RPM") do not
exist anywhere in this tree, and `src/lib/api-client.ts` does not exist either.
`failover-policy.ts` allows a billing *cooldown probe* while excluding billing
from the transient slot, so "billing must not be retried" was not adopted as
written.

**Change (calibration, not refactor)**

- `harness/specs/rules/error-governance-boundary.md` (new): seven hard rules
  (one envelope, one closed class per layer, missing mapping fixed or declared,
  waiting/approval stays fail-closed, declared gaps stay honest, correlation ids
  stay separate, no human prerequisite). Every rule names its executable check,
  and a machine-readable `json error-governance-surface` block carries the
  declared surface (envelope, allowed error types, the four host codes and their
  renderer classifications, the declared `INTERNAL -> UNKNOWN` gap, the two error
  surfaces, three probed code-level gaps, and the full waiting/approval decision
  taxonomy).
- `scripts/check-error-governance.mjs` + `.d.mts` (new): 16 checks that reconcile
  that block with the real files (importing the real
  `src/lib/error-model.ts` classifier instead of re-declaring it) and fail closed
  on a missing/unparsable surface block, a missing rule, an unresolvable
  reference, an undeclared gap or a stale declared gap. `--surface <json>`
  deep-merges an override so one axis can be mutated per fixture.
- `harness/specs/scenarios/gateway-backend-communication.md`: the rule is wired
  into `requiredRules`, a short "Error governance across this boundary" section
  was added, and the stale `src/lib/api-client.ts` flow reference was corrected
  to `src/lib/host-api-client.ts`.
- `docs/dev/error-governance-decision-record.md` (new): each draft item marked
  existing / gap / proposal against re-verified paths and symbols; states that
  `HostResponse` and `AppError` are reused and that no third envelope is created;
  disambiguates local `requestId` vs redacted provider `requestId`, per-layer
  code/type stability, recoverability vs replay safety vs profile/model switch vs
  post-fix retry vs cooldown probing, and refusal vs thrown `FailoverError`;
  declares versioning/deprecation windows only for contracts with an independent
  consumer and explicitly does **not** freeze the "100 RPM" suggestion or any
  product default. The record is registered as a reviewed repository input
  because `/docs/**` is gitignored.
- No human prerequisite remains: an `agent-driven-labelling` and
  `no-human-prerequisite` check scan the rule, the record and the scenario, and
  every artifact is labelled `driven_by: agent`.

**Tests:** `tests/unit/error-governance-boundary.test.ts` (39) covers the
current-tree pass, the waiting/approval fail-closed resolution, and 13
deliberately broken governance axes (auto-approval declared, executed action
without decision, effects during wait, missing/unknown waiting type, parallel
envelope, parallel error type, missing mapping, undeclared unknown mapping,
out-of-range error surface, missing/unparsable surface block, stale declared gap,
human prerequisite, missing reference), each asserted through the real CLI plus
nine fixture files under `tests/unit/fixtures/error-governance/`. The intentional
CLI failure is recorded in the evidence package (exit 1 with
`FAIL no-auto-approval`).

**Residual:** the three code-level gaps (renderer drops the host error code →
#118, duplicated `HostResponse`, duplicated `AppErrorCode` unions) are declared
with executable probes rather than fixed, because `src/**`, `shared/host-api/**`
and `electron/**` were outside this batch's write scope. `src/lib/api-client.ts`
is still named by other policy text (`AGENTS.md`, several rules/task specs,
`.github/workflows/comms-regression.yml`); only the scenario's flow claim was
corrected here, and `docs/architecture-overview.md:24` already records that class
of staleness.

## #123 - enabled OpenAI-compatible endpoints had no request budget

**Verified at HEAD:** `AuthRateLimiter` counts only *failed* authentication
attempts and a successful authentication resets that counter; the shared
`handleGatewayPostJsonEndpoint` helper (used by Chat Completions, Responses and
Embeddings) checked method/auth/scope/body and then admitted the request with no
budget, so a valid credential loop reached the model unbounded.

**Change**

- `openclaw_runtime/src/gateway/http-endpoint-budget.ts` (new): an in-process
  budget built on the existing `createFixedWindowRateLimiter`, with
  `${endpointKind}:${clientKey}` buckets where `clientKey` is the auth limiter's
  own `normalizeRateLimitClientIp(resolveRequestClientIp(...))` normalisation, a
  bounded bucket map (10k entries) and a declared loopback exemption.
- `http-endpoint-helpers.ts`: the budget is consumed exactly once, after
  method/auth/scope/body checks and before any handler work or SSE headers, so an
  over-budget request never reaches the model.
- `http-common.ts`: `sendEndpointRequestBudgetExceeded` returns a stable `429`
  with `Retry-After` and wording that never claims authentication failure
  (distinct from `sendRateLimited`).
- Chat Completions, Responses and Embeddings pass their bucket id; the budget is
  created and held by the Gateway lifecycle next to the auth rate limiters.
- Capacity is a documented local constant (30 admitted requests / 60 s per
  endpoint+client), deliberately below the draft's "100 RPM", overridable via the
  factory and absent from every config schema, default matrix and lock file — it
  is a safety default, not a frozen product decision. Loopback is exempt by
  default, mirroring the auth limiter's existing `exemptLoopback: true`, and the
  exemption is tested.

**Tests:** `openclaw_runtime/src/gateway/http-endpoint-budget.test.ts` (27) covers
N allowed / N+1 429 with the provider stub never called on all three endpoints,
concurrency (20 concurrent admissions → exactly the budget admitted) and window
recovery, success not clearing the budget while the auth lockout stays
independent, streaming and non-streaming rejection before SSE 200 headers,
endpoint-disabled behaviour (404, zero budget spent), separate buckets and the
declared loopback policy. The existing runtime gateway shard (35 files / 237
tests, projects `gateway-core`, `gateway-server`, `gateway-methods`, `hooks`)
still passes.

**Residual (recorded, not hidden):** the budget is per client identity, so N
distinct clients get N budgets (no fleet-wide ceiling); it is per gateway process;
trusted-proxy requests without forwarded headers share the `unknown` bucket; the
10k bucket cap can evict and restart the oldest window (a memory bound, not a
correctness guarantee); WS/control-plane, `/v1/models`, tools-invoke and
`sessions-*` HTTP surfaces do not use this boundary and are not covered; no config
schema key was added.

## Gates executed on the candidate (agent-driven)

| Gate | Command | Result |
| --- | --- | --- |
| Focused unit + integration | `node node_modules/vitest/vitest.mjs run <12 files>` | 12 files / **238 tests passed**, exit 0 |
| Runtime gateway shard | `node node_modules/vitest/vitest.mjs run --config openclaw_runtime/vitest.config.ts --project gateway-core --project gateway-server --project gateway-methods --project hooks` | 35 files / **237 tests passed**, exit 0 |
| Error-governance check | `node scripts/check-error-governance.mjs` | 16 checks PASS, exit 0 (intentional-failure fixtures exit 1, recorded) |
| Typecheck (node/web/test) | `tsgo --noEmit -p tsconfig.{node,web,test}.json --composite false` | all exit 0 (after `node scripts/generate-ext-bridge.mjs`, see environment note) |
| Lint (changed files) | `node node_modules/eslint/bin/eslint.js <17 changed files>` | exit 0 |
| Harness specs | `validate --spec` for the scenario, the new rule (`--no-diff`) and this batch's task spec | all `Spec is valid`, exit 0 |
| i18n lint | `node scripts/i18n-lint.mjs` | `i18n lint passed.`, exit 0 |
| Comms regression | `node scripts/comms/replay.mjs` + `node scripts/comms/compare.mjs` | exit 0, all metrics PASS |
| Artifact retention | `node scripts/check-repository-artifacts.mjs` | passed (18066 tracked paths); both new `docs/dev` records are registered as reviewed inputs and the reviewed ignore block gained two negation lines |
| Whitespace | `git diff --check` | exit 0 |

**Environment note:** the worktree had no gitignored generated extension bridge
(`electron/extensions/_ext-bridge.generated.ts`, `src/extensions/_ext-bridge.generated.ts`),
so the first `tsgo` run would fail with `TS2307` on those modules. Running the
tracked `node scripts/generate-ext-bridge.mjs` regenerated both stubs (still
gitignored) and every project then typechecked with exit 0. Environment repair,
not a product change.

**Known harness nuance:** diff-aware `validate` for the new rule exits non-zero
only because concurrent batch-4 files (`electron/gateway/**`,
`openclaw_runtime/src/gateway/**`, `tests/unit/gateway-*.test.ts`, this batch's
task spec) are not covered by that rule's diff; `--no-diff` structural validation
passes, and the batch task spec plus the scenario validate cleanly.

**Not run:** full repository unit suite, `harness:ci`, Electron E2E, Agent Dev
deep-test/audit, packaging, cross-platform checks, live provider calls and any
resource-exhaustion experiment.

**Credentials:** the changed files and evidence are scanned for common credential
shapes by the evidence driver; results are in `credential-scan.json`. The token
values used by tests are synthetic.

**Boundaries:** evidence is `driven_by: agent`; no human action, verdict or data
is claimed. `pnpm run <script>` cannot run in the junction-based candidate
worktree (pre-run dependency verification aborts without a TTY), so the wrapped
`node` commands were invoked directly.
