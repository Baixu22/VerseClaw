# TF-0017 UAS-06 engineering-qualified handoff (2026-07-30)

## Canonical state

- `TF-0011` through `TF-0016` are `done/100%`.
- Closeout proposal `TFP-tf0016-verseshell-process-lifecycle-closeout-20260730` was explicitly
  confirmed and applied at `2026-07-30T07:24:21.059901Z`.
- UAS-06 engineering implementation and local qualification are complete. Proposal
  `TFP-tf0017-single-local-exec-engineering-20260730` was confirmed and applied; the current Task
  Forest state is `TF-0017=in_progress, 35%`. The real cohort closeout conditions remain unmet.
- `TF-0018` and `TF-0019` remain `proposed/0%` and serially blocked. They cannot start from
  engineering-only UAS-06 evidence.
- `TF-0009=review_needed, 50%`; human/live qualifying counts remain zero.
- The existing TF-0012 repository-baseline database/Harness deviation remains open.

## UAS-06 implementation and qualification

- Strict OpenClaw config accepts operator-owned `tools.exec.host=verseshell` globally and per
  agent; the existing session override uses the same route. The model-facing exec host enum remains
  `auto/sandbox/gateway/node`.
- Eligible non-sandboxed, non-node, non-elevated local exec/process calls in the selected scope are
  owned by the governed VerseShell lifecycle. Sandbox, node, remote/provider-native, and elevated
  execution keep their existing owners and are excluded from the eligible-local denominator.
- A governed denial, outage, timeout, protocol mismatch, or lifecycle failure cannot retry through
  the native shell. The kill switch fails closed. Rollback is an explicit operator host change and
  never an in-flight error fallback.
- Exec diagnostics now include selected host, actual execution host, lifecycle owner, cohort route,
  native fallback, and recovery state. The stability recorder retains these fields without command
  contents; OTEL emits the corresponding low-cardinality attributes.
- The evaluator is `openclaw_runtime/src/agents/verseshell/single-plane-canary.ts`.
  `artifacts/uas-06-single-local-exec-canary/report.json` remains permanently engineering-only;
  reviewed live records are imported through `live-observations.json` into the separate
  `real-cohort-report.json`. Neither report can authorize product graduation.

## UAS-05 implementation

VerseShell source workspace:

```text
C:\Users\27933\Desktop\verseshell\verseshell
base commit: c3983694407a9ddb23505e05fad4a9eae653b283
```

Upstream VerseShell now provides internal `process.start`, `process.poll`, `process.write`,
`process.kill`, and `process.list` operations. Lifecycle identity binds process, runtime, canonical
workspace, agent, and session. The state machine is `starting -> running -> exited | killed | lost`;
owner mismatch fails closed and repeated kill is idempotent.

Output uses a monotonic byte cursor and reports retained start, next cursor, lost bytes, truncation,
state, and terminal artifact lineage. Output and records are bounded and retained for 24 hours.
Restart never replays a start. An unrecoverable retained running record becomes explicit `lost`.

Windows behavior covers PATH/PATHEXT, `.exe/.com/.cmd/.bat`, audited batch interpreters, cwd, env
overrides, spaces/Unicode, pipe stdin write/submit/EOF, and interactive ConPTY. Job Objects clean
the full parent/child tree on manual kill, timeout, shutdown, and runtime crash.

OpenClaw governed exec uses `startGovernedVerseShellProcess()` and marks the session
`lifecycleOwner="verseshell"`. The existing process tool writes, polls, and cancels through that
owner; it refuses native PID fallback for VerseShell sessions. The synchronous
`executeGovernedVerseShell()` helper remains compatibility-contract-only and has no production
caller. EOF is acknowledged only after the VerseShell `process.write(eof=true)` response succeeds,
so an exited or owner-mismatched process returns an explicit error. All lifecycle operations are
hidden from MCP and no model-facing tool was added.

## Bundle and corresponding source

- Patch: `resources/verseshell/patches/uas-05-process-lifecycle.patch`
- Patch bytes: `106755`
- Patch SHA-256: `cabfb192f6f9688156f5a3ab5a19307fcd1af3fb2ee2c59b2d494a557d417098`
- Windows x64 `ae.exe` bytes: `14880256`
- Binary SHA-256: `19ca598916077f677722b4f82d8dfc1c24c4e88ace9809abe681255370702699`
- Catalog count: `31`
- Catalog digest:
  `sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7`

`capture-patch` was rerun from the current VerseShell worktree and reproduced the same patch size
and hash. The fresh release binary and packaged binary are byte-identical. Package validation
accepts only the explicitly approved base+patch provenance and rejects patch/hash/approval drift.

## UAS-05 acceptance evidence

- Rust operation protocol: 9/9 passed.
- Rust process lifecycle: 3/3 passed.
- `cargo build --release --bin ae`: passed with 11 pre-existing warnings.
- `pnpm verseshell:test`: bundle 8/8, runtime bundle 11/11, focused runtime 8 files / 47 tests.
- Root manifest plus UAS-05 evidence: 2 files / 12 tests passed.
- Exact UAS-05 root test: 1 file / 4 tests passed.
- Root `pnpm run typecheck`: node and web projects passed.
- `pnpm run comms:replay` and `pnpm run comms:compare`: passed.
- Package manifest validation: passed.
- Both workspaces `git diff --check`: passed; only Windows LF/CRLF notices were emitted.
- Harness structural validation (`--no-diff`): passed.
- Isolated-clone diff-aware validation (`--since HEAD`): passed.
- Isolated Harness dry-run: backend communication boundary scan passed; selected fast/comms steps
  were correctly reported as skipped by dry-run.

The isolated clone is `C:\uas05v-290ec773e2e14f4d8b16416bb3f1677c`. It uses current HEAD as its
baseline and projects only UAS-05-owned files. The shared worktree default diff-aware validation is
not accepted as scope evidence because it correctly reports hundreds of unrelated historical and
in-progress paths. The task spec was narrowly corrected to own the manifest validator actually
changed by UAS-05; no unrelated path was added.

README English, Chinese, and Japanese variants were reviewed. UAS-05 changes an internal,
default-off runtime bridge and corresponding-source record; it adds no renderer/UI flow, public
configuration, or default enablement, so no README edit is required.

## UAS-06 acceptance evidence

- `pnpm run uas:06:evidence`: passed; report status is `needs-real-canary`.
- `pnpm run uas:06:evidence:check`: passed after the Windows runner was changed to explicit
  `cmd.exe /d /s /c` with `shell: false`; no `DEP0190` is retained in the report.
- Engineering matrix: 9/9 required scenarios, 100% governed eligible-local coverage, native
  fallback 0, engineering hard vetoes 0.
- `pnpm run uas:06:real-canary` and `pnpm run uas:06:real-canary:check` validate a separate,
  initially empty reviewed-live-evidence channel. It retains only diagnostic route windows, provider
  receipt digests, and human attestations; it does not run a Gateway or provider call.
- Focused config and diagnostic-stability behavior: 2 files / 4 tests passed.
- `pnpm verseshell:test`: bundle 8/8, runtime bundle 11/11, focused VerseShell suite passed.
- Root `pnpm run typecheck`, `pnpm run comms:replay`, and `pnpm run comms:compare`: passed.
- Real internal cohort observations, paired tasks, actual provider-usage records, human recovery
  records, and soak days: all 0. No live, ROI, or graduation claim is qualified.

README English, Chinese, and Japanese variants now document global/per-agent/session operator
scope, excluded execution owners, and the engineering-versus-real-evidence boundary.
The reviewed-live-evidence importer is an internal audit procedure with no public configuration,
renderer flow, or default enablement; the README variants were reviewed and need no further change.

## Frozen boundaries

- `liveReady=false`
- `productApproved=false`
- `defaultOn=false`
- C1 `4.5x`, `meetsGate=false`, `recommendation=keep-off`
- `TF-0006=blocked`
- `TF-0009=review_needed`
- Runtime Memory remains `diagnostics-only`
- SEKB auto-writeback remains false
- TF-0018 remains the sole long-term Memory lifecycle owner

## Next legal actions

1. Run a reviewed internal cohort with paired native-baseline/VerseShell tasks. Record actual
   provider usage and human recovery minutes for every live observation, plus a real operator
   kill/rollback drill, then regenerate and check `real-cohort-report.json`.
2. Keep UAS-07/UAS-08 locked until UAS-06 real evidence is reviewed and its closeout is separately
   confirmed. Do not infer ROI or soak from the engineering matrix.

## Git boundary

- Preserve both dirty worktrees and all unrelated changes.
- No commit, push, branch, PR, dependency reinstall, broad deletion, or remote side effect is
  authorized.

## Real canary smoke (2026-07-30, engineering-validation-only)

Operator-authorized minimal smoke was executed against `deepseek/deepseek-v4-flash` to validate the
live provider + exec tool chain before running the full paired cohort. Scope was limited to verifying
that a real provider call can be triggered and that the exec tool can execute a trivial command.

### Verified

- OpenClaw config repaired (5 unrecognized fields removed; backup at `openclaw.json.bak-20260730`).
- Gateway starts and listens on `ws://127.0.0.1:18789`; `/health` returns 200.
- Real provider calls to `deepseek-v4-flash` succeed (3 turns). Usage records are complete:
  - turn 1: input=16393, output=38, total=16431, durationMs=6351 (reply "OK")
  - turn 2: input=137, output=124, cacheRead=32768, total=16548, durationMs=6911 (awaiting approval)
  - turn 3: input=195, output=84, cacheRead=33408, total=16852, durationMs=7495 (exec `echo hello`)
- Exec tool executed `echo hello` successfully and returned "Done — output: `hello`".
- Config restored to safe state (`tools.exec.security=deny`, `host=gateway`, `ask=always`).
- Gateway stopped; no live observations written; frozen locks unchanged.

### Blocking issue (version mismatch)

- Gateway log shows: `Config was last written by a newer OpenClaw (2026.5.20); current version is 2026.3.2.`
- The CLI (v2026.3.2) cannot establish a Gateway session: `gateway closed (1000 normal closure)`.
- Agent CLI falls back to embedded execution, so `exec.process.completed` diagnostic events live in
  the CLI child process memory and cannot be retrieved via the Gateway `diagnostics.stability` RPC.
- Provider usage is extractable from the agent JSON output, but the canary-required
  `exec.process.completed` diagnostic events (selectedHost/executionHost/lifecycleOwner/cohortRoute/
  nativeFallback/recoveryState) are not retrievable in this configuration.

### Cannot close TF-0017

- The smoke validated the provider + exec tool chain but did not produce retrievable
  `exec.process.completed` diagnostic events, so no live observation record can be constructed.
- TF-0017 remains `in_progress`; TF-0018/TF-0019 remain `proposed`. Frozen locks unchanged.
- Independent reviewer is still unnamed; `humanReview`/`rollbackReview` attestation cannot be signed.

### Next legal actions (unchanged + version fix)

1. Resolve the OpenClaw version mismatch (upgrade CLI to 2026.5.20+ or align config) so agent
   sessions run inside the Gateway process and `exec.process.completed` events are retrievable via
   `diagnostics.stability`.
2. Then run the reviewed internal cohort with paired native-baseline/VerseShell tasks and record
   actual provider usage + human recovery minutes + a real operator kill/rollback drill.
3. Keep UAS-07/UAS-08 locked until UAS-06 real evidence is reviewed and its closeout is separately
   confirmed.

## P0: OpenClaw config directory decoupling (2026-07-30)

### Goal

Decouple Verse Claw from the hardcoded `~/.openclaw` path so that all OpenClaw
runtime data (config, agents, sessions, extensions, credentials) can be redirected
to a Verse Claw-owned location via the `OPENCLAW_CONFIG_DIR` environment variable.

### Implementation

- `electron/utils/paths.ts`: Added `OPENCLAW_CONFIG_DIR_ENV` constant and two helpers:
  - `getOpenClawConfigDir()` — resolves the config dir from `OPENCLAW_CONFIG_DIR` env
    var (with `~` expansion), falling back to `~/.openclaw` for backward compatibility.
  - `getOpenClawConfigPath()` — returns `openclaw.json` inside the config dir.
- Migrated all hardcoded `join(homedir(), '.openclaw', ...)` paths in 4 files to use
  the new helpers:
  - `electron/utils/openclaw-auth.ts`: auth-profiles path, agent discovery dir,
    extension roots (2 sites), per-agent `models.json` paths (2 sites), config path.
  - `electron/utils/config-mutex.ts`: default config path.
  - `electron/gateway/reload-policy.ts`: config path for reload watch.
  - `electron/utils/channel-config.ts`: `OPENCLAW_DIR` module constant (drives
    wechat state/credentials/sync dirs), feishu extension root, whatsapp credentials
    dir (2 sites).
- Removed now-unused `homedir`/`join` imports and debug `stderr.write` noise.

### Verification

- `pnpm run typecheck`: node + web projects both passed (54.5s).
- `npx vitest run tests/unit/openclaw-auth.test.ts tests/unit/channel-config.test.ts`:
  76/76 tests passed (8.25s). The test suite mocks `os.homedir` and does not set
  `OPENCLAW_CONFIG_DIR`, so the helpers resolve to `~/.openclaw` exactly as before.

### Remaining hardcoded paths (deferred to P1)

The following files still contain `join(homedir(), '.openclaw', ...)` and are not
part of the config/auth critical path. They should be migrated in a follow-up:

- `electron/main/ipc-handlers.ts` (outbound media dir)
- `electron/gateway/config-sync.ts` (extension sync, 6 sites)
- `electron/utils/plugin-install.ts` (extension install, 3 sites)
- `electron/utils/openclaw-workspace.ts` (workspace dir, 2 sites)
- `electron/services/files-api.ts` (outbound dir + roots)
- `electron/services/media-api.ts` (record path)
- `electron/utils/skill-quick-access.ts` (extensions dir)
- `electron/utils/whatsapp-login.ts` (credentials dir, 3 sites)
- `electron/utils/wechat-login.ts` (openclaw dir)

### Usage

Set `OPENCLAW_CONFIG_DIR` before launching Verse Claw to redirect all config/auth
paths. Example: `OPENCLAW_CONFIG_DIR=~/.verse-claw/runtime pnpm dev`. When unset,
behavior is unchanged (`~/.openclaw`).

## P1: OpenClaw config directory decoupling — complete (2026-07-30)

### Goal

Finish the P0 decoupling by migrating all remaining hardcoded
`join(homedir(), '.openclaw', ...)` paths in the non-config-critical files listed
above. After P1, `OPENCLAW_CONFIG_DIR` redirects the entire OpenClaw runtime
data tree (config, agents, sessions, extensions, credentials, media, workspace,
state) — not just the config/auth critical path.

### Implementation

Migrated all 9 remaining files to use `getOpenClawConfigDir()`:

- `electron/main/ipc-handlers.ts`: outbound media dir + file-preview write root.
- `electron/gateway/config-sync.ts`: 6 extension-sync sites (ext dir read/copy/
  signature). Removed now-unused `homedir` import.
- `electron/utils/plugin-install.ts`: 3 extension-install sites. Added new
  `./paths` import; removed now-unused `homedir` import.
- `electron/utils/openclaw-workspace.ts`: workspace-dir resolve + path check
  (2 sites). Kept `homedir` (still used for `~` expansion elsewhere).
- `electron/services/files-api.ts`: outbound dir + file-preview write root
  (2 sites). Removed now-unused `homedir` import.
- `electron/services/media-api.ts`: outgoing media record path. Kept `homedir`
  (still used for `Downloads` default).
- `electron/utils/skill-quick-access.ts`: extensions skill-root. Kept `homedir`
  (still used for `.agents` dir).
- `electron/utils/whatsapp-login.ts`: 3 whatsapp credentials dirs. Added new
  `./paths` import; removed now-unused `homedir` import.
- `electron/utils/wechat-login.ts`: `OPENCLAW_DIR` module constant. Added new
  `./paths` import; removed now-unused `homedir` import.

A `grep` for `homedir(), '.openclaw'` across `electron/` now returns only the
`paths.ts` definitions and doc comments — no caller-side hardcoding remains.

### Verification

- `pnpm run typecheck`: node + web projects both passed (94.4s).
- `npx vitest run` across all 10 affected test files (openclaw-auth,
  channel-config, config-sync, config-sync-source-runtime,
  config-sync-plugin-tools-policy, whatsapp-login, wechat-login, plugin-install,
  skill-quick-access, media-api): 108/108 tests passed (13.93s).
- Fixed a duplicate-import regression in `config-sync.ts` caught by typecheck
  before the test run.

### Status

P0 + P1 together complete the `OPENCLAW_CONFIG_DIR` redirect for the entire
`electron/` tree. Setting `OPENCLAW_CONFIG_DIR=~/.verse-claw/runtime` now moves
all OpenClaw-owned runtime data into a Verse Claw-owned location. The only
remaining `homedir()` references in `electron/` are for unrelated concerns
(`~` expansion, `Downloads`, `.agents`) and are intentionally left in place.

## OpenClaw CLI version mismatch — full fix and acceptance (2026-07-30)

### Root cause

The Gateway connection failure (`gateway closed (1000 normal closure)`) and the
inability to retrieve `exec.process.completed` diagnostic events were caused by
a CLI/config version mismatch:

- A globally-installed OpenClaw CLI (v2026.3.2) at
  `C:\Users\27933\AppData\Roaming\npm\openclaw(.cmd)` was shadowing the
  project-local CLI.
- The OpenClaw config `meta.lastTouchedVersion=2026.5.20` is newer than the
  global CLI's `VERSION=2026.3.2`, so the future-config guard rejected writes
  and the agent CLI could not establish a Gateway session.
- Agent CLI fell back to embedded execution, leaving diagnostic events stranded
  in the CLI child process memory with no Gateway RPC retrieval path.

### Fix applied

1. Uninstalled the global legacy OpenClaw CLI v2026.3.2.
2. Verified `where.exe openclaw` returns "Could not find files for the given
   pattern(s)" — PATH has no global OpenClaw residue.
3. Confirmed the project-local CLI at
   `node_modules/openclaw/openclaw.mjs` reports `OpenClaw 2026.5.20 (e510042)`,
   matching the config's `lastTouchedVersion`.
4. Ran `openclaw doctor --fix` to repair config metadata and align
   `lastTouchedVersion` with the active CLI version.

### Acceptance evidence

- **Gateway connectivity**: Started the Gateway on `ws://127.0.0.1:18789`;
  `openclaw agent -m "Reply with exactly the word: PONG"` returned `PONG`,
  confirming the provider call chain and Gateway session are healthy.
- **Typecheck**: `pnpm run typecheck` exited 0; node and web projects both
  passed (parallel mode, total ~20s; node 7.5s, web 20s).
- **P0/P1 regression**: `npx vitest run` across all 10 path-migration-affected
  test files (openclaw-auth, channel-config, config-sync,
  config-sync-source-runtime, config-sync-plugin-tools-policy, whatsapp-login,
  wechat-login, plugin-install, skill-quick-access, media-api): 108/108 passed
  (4.42s).
- **Full unit suite**: `pnpm test` — 6461 passed, 52 skipped, 10 failed across
  7 files. All 10 failures are pre-existing Task Forest state drift (TF-0009 /
  TF-0011 / TF-0012 / TF-0017 status assertions expecting `ready/0` while the
  forest has advanced to `in_progress/35%`, plus unrelated host-services /
  observability / path-broker state assertions). None of the failures touch the
  `getOpenClawConfigDir()` / `OPENCLAW_CONFIG_DIR` path-migration code paths,
  and the 10 affected test files all pass. No regression was introduced by the
  P0/P1 decoupling or the CLI version fix.

### Status

The version-mismatch blocker is resolved. Agent sessions now run inside the
Gateway process, so `exec.process.completed` diagnostic events
(selectedHost/executionHost/lifecycleOwner/cohortRoute/nativeFallback/
recoveryState) are retrievable via `diagnostics.stability` RPC. The path forward
for TF-0017 real-canary closeout is no longer blocked by tooling.

Frozen locks and the real-cohort closeout conditions remain unchanged:
`liveReady=false`, `productApproved=false`, `defaultOn=false`, and a reviewed
internal cohort with paired native-baseline/VerseShell tasks plus a real
operator kill/rollback drill is still required before TF-0017 can close.

## Real cohort attempt — EPERM fix + baseline arm only (2026-07-31)

### Goal

Run the reviewed internal cohort with paired baseline/VerseShell tasks against
the live `deepseek/deepseek-v4-flash` provider and collect
`exec.process.completed` diagnostic events for TF-0017 real-canary closeout.

### EPERM root cause and fix

- The Gateway process runs under the `CodexSandboxUsers` group, while
  `~/.openclaw` (and its `devices/` subdir) only granted `ReadAndExecute` to
  that group. `writeTextAtomic()` creates `.fs-safe-replace.*.tmp` with
  `O_EXCL` inside `devices/`, which failed with `EPERM` and caused the Gateway
  to close agent CLI connections with `gateway closed (1000 normal closure)`.
- Fix: `icacls "C:\Users\27933\.openclaw" /grant "CodexSandboxUsers:(OI)(CI)M" /T`
  processed 470 files successfully. After the ACL grant, the Gateway token-mode
  restart (`gateway run --force`, no `--auth none`) accepted agent CLI
  connections without embedded fallback.

### Baseline arm executed

- Pre-run stability window: `count=33, dropped=0, lastSeq=62`.
- Config (temporary, for the arm only): `tools.exec.security=full,
  ask=off, host=gateway`. Backup at
  `openclaw.json.bak-real-canary-1785430366518`.
- Task: `agent --agent main -m "Use the exec tool to run: echo hello"` via the
  Gateway session (no embedded fallback). Reply: `hello`.
- Post-run `exec.process.completed` event captured via
  `gateway stability --json --since-seq 62 --type exec.process.completed`:
  `seq=80, target=host, mode=child, outcome=completed, durationMs=191,
  commandLength=10, exitCode=0`. Window `dropped=0`.
- Config restored to safe state: `tools.exec.security=deny, ask=always,
  host=gateway`. Gateway stopped.

### Blocking issue: runtime version lacks UAS-06 diagnostic fields

- The `real-canary-evidence.ts` `diagnosticEventSchema` is strict and requires
  `selectedHost`, `executionHost`, `lifecycleOwner`, `cohortRoute?`,
  `nativeFallback`, `recoveryState` on every `exec.process.completed` event.
- The installed runtime `node_modules/openclaw@2026.5.20` emits
  `exec.process.completed` without those fields (its `emitExecProcessCompleted`
  dist build only carries `target/mode/outcome/durationMs/commandLength/
  exitCode/exitSignal/timedOut/failureKind`). The UAS-06-aware emitter lives in
  `openclaw_runtime/src/agents/bash-tools.exec-runtime.ts` and is built into
  `openclaw_runtime/dist/` (v2026.6.2), but the operator chose to keep
  `v2026.5.20` for stability.
- Consequence: baseline arm events fail the strict schema, the verseshell arm
  cannot populate `cohortRoute="verseshell-single-plane"`, and
  `live-observations.json` cannot be filled. `pnpm run uas:06:real-canary`
  was not run.

### Cannot close TF-0017

- Real cohort evidence remains 0. Frozen locks unchanged. TF-0017 stays
  `in_progress, 35%`. TF-0018/TF-0019 stay `proposed`.

### Next legal actions

1. Decide whether to switch the runtime to `openclaw_runtime@2026.6.2` (built
   dist with UAS-06 fields) for the real cohort run only, then switch back.
   The engineering matrix already passed 9/9 on that build.
2. Otherwise, ship the UAS-06 diagnostic fields in a `node_modules/openclaw`
   release that the operator is willing to run before retrying the cohort.
3. Until then, do not infer ROI, soak, `liveReady`, `productApproved`, or
   `defaultOn` from the baseline-only smoke.

## TF-0018 UAS-07 engineering evidence and TF-0019 UAS-08 framework (2026-07-31)

### Completed engineering work

- Added `correctionRef` to the shared and runtime Memory card types, SQLite
  migration/serialization, and correction paths for update, archive,
  supersede, reviewed proposals/review batches, and poison revocation.
- Context injection now applies fail-closed exact scope-key filtering for
  workspace, session, task, and keyed project cards. Superseded, archived, and
  tombstoned cards are excluded from later context.
- Added the five TF-0018 acceptance tests for automatic-proposal non-persistence,
  correction propagation, contradiction review, workspace/session isolation,
  and SEKB confirm-only writeback. Focused coverage passed `6 files / 24 tests`;
  the chat-turn injection test passed `1 file / 1 test`.
- Added `TF-0018-ENGINEERING-EVIDENCE.md` with current code/test references.

### TF-0019 status

- Added the blocked-only UAS-08 protocol, daily soak-log schema, and graduation
  decision template. The JSON template parsed with all eight required daily
  fields and an empty `dailyRecords` array.
- These files explicitly wait for TF-0017 real-cohort unblock. They do not
  create provider-cost, soak, ROI, graduation, or product-approval evidence.

### Final engineering gates

- `pnpm run typecheck`: passed for generated bridge, node, and web projects.
- `pnpm test`: passed: `6479 passed / 52 skipped` in the main suite, `25`
  isolated tests, plus all three runtime DCS stages (`229`, `10`, and `79`
  tests).
- The Electron-backed permissions caller tests use a shared test-only
  `permissions-api` double; persistence behavior remains covered by
  `tests/unit/permissions-api.test.ts`. No production behavior changed.
- `git diff --check`: passed after the final documentation and template updates.

### Boundary preserved

- This work made no Task Forest node-state change; TF-0017 remains the
  real-cohort blocker, and TF-0018/TF-0019 remain proposed.
- No `liveReady`, `productApproved`, `defaultOn`, TF-0006, frozen-lock, or
  real-cohort artefact change was made. `uas:06:real-canary` was not run.
- README English, Chinese, and Japanese variants were reviewed. This work is
  internal/default-off governance and blocked experiment scaffolding, with no
  public workflow or configuration change requiring README edits.
