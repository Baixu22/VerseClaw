# VerseShell Foundation Status and Deprecation Policy

Status: default-off controlled canary foundation. The strict typed ACI route is wired, but no VerseShell capability is enabled by default and this is not GA or release approval.

## P0-02 reproducible bundle update (2026-08-14)

`TF-0059` / VS-P0-02 now has a tracked source-input manifest and an ordered four-patch
corresponding-source stack. The clean reconstruction records the pinned commit, eight recovered
ACI-Bench Python inputs, final source assertions, Cargo lockfile/toolchain, current-interpreter
Python contract, handshake/catalog identity, and deterministic build controls. Two independent
Windows x64 release builds are byte-identical (`ac6a7a15dac0a9dc7d15ec975fc65276f25c871bbc0174197731947df6460786`,
14,879,232 bytes), and the full Rust/Python qualification proof is recorded in
[`P0-REPRODUCIBLE-BUNDLE-EVIDENCE-2026-08-14.md`](./P0-REPRODUCIBLE-BUNDLE-EVIDENCE-2026-08-14.md).

The bundle, focused regression, typecheck, communication replay/compare, manifest, and package
validation gates are green. Harness diff-aware validation remains blocked by the shared worktree's
unrelated changed paths (and its dry-run child lacks local harness dependencies); this is recorded
as an environment/ownership residual rather than bypassed. This closes the source/build identity
portion of P0-02 only. It does not authorize P0-03 governed approval probes, lifecycle/product
rollout, canary traffic, or default-on. Keep `default-off`, `liveReady=false`,
`productApproved=false`, and `defaultOn=false`.

The capability-gap audit, target architecture, rejected surfaces, and dependency-ordered implementation schedule are documented in [CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md](./CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md). That report is planning input; this file remains authoritative for current rollout status.

## P0-03 governed real probe update (2026-08-14)

`TF-0060` / VS-P0-03 has now exercised the current verified Windows x64 binary through the real
OpenClaw governed route. The probe preserves `E_NEEDS_APPROVAL` before host approval, rejects the
parent `AETHER_APPROVE_ALL` escape, retries exactly once in an action-bound token transport,
closes that transport after the action, reduces large output to bounded observation plus a
`result://` artifact, and recovers the artifact through `result.query`. Runtime/default-off tests
also prove that contract failure and compatibility fallback settings remain fail-closed with no
native-shell handoff.

The focused OpenClaw suite is 11 files / 57 tests; `pnpm verseshell:test` is 13 bundle tests + 11
runtime-bundle tests + 57 OpenClaw tests. Node/web typecheck, manifest package validation, comms
replay/compare, and `git diff --check` pass. The test tsconfig retains 1028 pre-existing
observation-only errors; they are reported but do not fail the node/web gate. Full details are in
[`P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md`](./P0-GOVERNED-PROBE-EVIDENCE-2026-08-14.md).

This is engineering evidence only. It does not provide provider receipts, human recovery,
paired A/B, soak, canary eligibility, default-on, GA, or product approval. The P0-03 closeout
proposal has been confirmed and applied; P1-01 and P1-02 closeouts are also applied, with the
VS-P1-03 compatibility boundary now under review.
Keep `default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## P1-01 supervised ACI update (2026-08-14)

`TF-0061` / VS-P1-01 adds the supervised execution-kernel contract on top of the verified P0
route. `VerseShellProcessManager` now exposes the explicit `starting -> handshaking -> ready ->
backoff/stopped/failed` state machine, host-owned request/trace/deadline metadata, bounded lifecycle
error metadata, explicit read-only/idempotent retry opt-in, restart exhaustion, and an operator kill
switch that fails closed without native/MCP/legacy fallback. The governed process adapter carries one
parent trace through start, poll, stdin, EOF, and kill while preserving owner and cursor checks.

Focused process-manager coverage is 24/24 and governed lifecycle coverage is 6/6. The full
`pnpm verseshell:test` route is green (13 bundle tests, 11 runtime-bundle tests, 57 focused OpenClaw
tests); the complete VerseShell OpenClaw directory is 11 files / 61 tests. The evidence is recorded
in [`P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md`](./P1-SUPERVISED-ACI-EVIDENCE-2026-08-14.md).

The current repository-wide node typecheck still reports two unrelated provider model typing errors
(`electron/services/providers/provider-runtime-sync.ts` and `electron/utils/provider-registry.ts`);
web typecheck passes and the test-project observation errors remain non-fatal. This residual is not
waived or broadened into the P1 touched areas. Harness `--no-diff` validation and focused comms/diff
gates are recorded in the evidence; shared-worktree diff ownership remains a known residual.
P1 engineering evidence does not authorize canary traffic, provider claims, default-on, GA, or
product approval. Keep all rollout/product locks closed.

## P1-02 bounded observation and artifact update (2026-08-14)

`TF-0062` / VS-P1-02 extends the P1-01 process owner with a shared, fail-closed result contract.
The shared VerseShell types and validators now cover independent JSON-frame and observation bounds,
bounded stdout/stderr projections, explicit `raw_bytes`/`retained_bytes`/`omitted_bytes` evidence,
content-addressed artifact digest and handle identity, owner/process lineage, retention expiry, and
bounded `meta`/`head`/`tail`/`slice`/`grep`/`raw` query modes. Runtime output fields that are not
authoritatively verifiable are rejected or kept outside the model-visible projection; raw command,
approval token, and unbounded stderr are not promoted into metadata.

`normalizer.ts` rejects malformed result handles and projects only validated stream/artifact metadata.
`governed-exec.ts` validates query bounds before transport, checks the `result.query` response
operation and response size, classifies missing/expired/owner-drift artifacts fail-closed, and does
not retry or switch execution owners. The existing real Windows artifact recovery path remains green,
including the runtime's `encoding`, `raw_complete`, and `returned_bytes` fields.

Focused evidence is recorded in
[`P1-OBSERVATION-ARTIFACT-EVIDENCE-2026-08-14.md`](./P1-OBSERVATION-ARTIFACT-EVIDENCE-2026-08-14.md).
The P1-02 closeout proposal has been applied. The implementation remains engineering evidence only:
it does not authorize read/write adapters, provider traffic, canary, default-on, GA, or product approval. Keep
`default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## P1-03 MCP compatibility boundary update (2026-08-14)

`TF-0063` / VS-P1-03 hardens `resources/verseshell-mcp` as an external compatibility adapter.
The package is now a tracked workspace member with a frozen lockfile and a real
`@modelcontextprotocol/sdk` dependency. Product profile capability grants are deny-by-default;
`all`, `*`, and unknown capabilities fail before startup, and `tools/list` is filtered by the exact
profile/grant. The adapter reads package/runtime/protocol/catalog identity from tracked metadata and
the health payload omits workspace, executable path, approval token, and raw command data.

`verseshell_eval` and shell-string compatibility are development-profile-only. The development shell
adapter accepts explicit argv, rejects shell metacharacters and malformed quoting, then forwards only
the typed `shell.exec([...])` expression through the runtime capability boundary. Product startup with
no grants lists only health and does not spawn the runtime. Focused policy and JSON-RPC startup smoke
coverage is 11/11; the full VerseShell route is bundle 13/13, runtime-bundle 11/11, OpenClaw 64/64,
and MCP 11/11. Capability names are aligned with the pinned runtime grant vocabulary, effectful
compatibility tools remain deferred, and a real Windows x64 read smoke covers the startup path.
Details are in
[`P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md`](./P1-MCP-COMPATIBILITY-EVIDENCE-2026-08-14.md).

This remains engineering evidence only. MCP is not an internal dependency and this package does not
authorize read/write adapters, provider traffic, canary, default-on, GA, or product approval. Keep
all rollout/product locks closed.

## P2-01 read-only facade update (2026-08-14)

`TF-0064` / VS-P2-01 now connects the stable `read_file`, `search_content`, and `result_query`
model surface to the existing host-owned `VerseShellAciClient`. The adapter is materialized only
when `verifiedRuntime`, `typedAci`, `facade`, `governedExec`, and `artifactResults` are explicitly
enabled; default-off and the operator kill switch keep all three tools absent. It validates
workspace-relative paths, bounded search/read/query inputs, result handles, artifact digest/expiry,
and workspace owner lineage. Read/search cache keys include workspace, revision, policy digest,
operation, and canonical arguments, with bounded TTL and capacity.

P2-01 uses only `file.view`, `repo.search`, and `result.query` through the supervised ACI owner. It
does not spawn a process, call MCP or Gateway HTTP, expose internal VerseShell operations, add a
native fallback, or perform writes. Focused coverage is VerseShell 13 files / 71 tests plus the root
facade contract 3/3; node typecheck, comms replay/compare, and diff check pass. Ordinary diff-aware
Harness validation remains blocked by unrelated shared-worktree ownership paths; `--no-diff`
validation passes and the residual is recorded in
[`P2-READONLY-FACADE-EVIDENCE-2026-08-14.md`](./P2-READONLY-FACADE-EVIDENCE-2026-08-14.md).

This is engineering evidence only. P2-02 command profiles, diagnostics, writes, provider-backed
canary, default-on, GA, and product approval remain out of scope. Keep `default-off`,
`liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## P2-02 argv-only command profiles update (2026-08-14)

`TF-0065` / VS-P2-02 converts OpenClaw's pre-approval command analysis into an immutable
host-owned execution plan. Single-segment ordinary coding commands run as direct argv; pipelines,
chains, redirects, heredocs, inline evaluation, and explicit interpreters stay explicit
terminal-shell payloads. The host derives `test`/`build`/`lint`/`git`/`generic` profiles
from the analysis (including `pnpm`/`npm`/`corepack` `exec`/`dlx` runner passthrough);
the model never selects a profile, interpreter, PATH/PATHEXT resolution, policy, or approval token.

The plan binds before the approval wait and flows through the gateway allowlist into the governed
process start; approval never re-parses the display command. Windows `.exe`/`.com` stay direct
argv; `.cmd`/`.bat` retain resolved script identity plus an audited
`ComSpec`/`SystemRoot` `cmd.exe` interpreter (`interpreterProfile: "windows-cmd"`), and the
runtime derives the interpreter from the resolved script path plus env. A drifted windows-cmd plan
fails closed at the process boundary. cwd/env/argv/timeout/output bounds are carried on the plan
with fail-closed errors; effectful requests are never replayed and no native/MCP/legacy fallback is
reachable.

Focused coverage: `pnpm verseshell:test` PASS (bundle 13/13, runtime-bundle 11/11, OpenClaw
VerseShell 15 files / 141 tests, MCP 11/11); root contract 6/6; node typecheck and the aggregate
node+web typecheck, comms replay/compare, scoped ESLint, and diff check PASS. Harness
`--no-diff` validation passes;
ordinary diff-aware validation remains blocked by the recorded shared-worktree residual. Details
are in
[`P2-COMMAND-PROFILES-EVIDENCE-2026-08-14.md`](./P2-COMMAND-PROFILES-EVIDENCE-2026-08-14.md).
The `TF-0065` closeout proposal `TFP-verseshell-p2-02-closeout-20260814` has been saved and
applied through the Task Forest CLI (`validate`/`export` PASS); `TF-0065` is `done` at 100%
and the only next node `TF-0066` / VS-P2-03 diagnostics is now `ready`.

This is engineering evidence only. P2-03 diagnostics, P3 writes, provider-backed canary,
default-on, GA, and product approval remain unauthorized. Keep `default-off`,
`liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## P3-02 external-write policy update (2026-09-02)

`TF-0068` / VS-P3-02 now classifies compiler, script, Git-hook, terminal-shell, and other
mutating process commands as external writes on the immutable host-owned command plan. The
existing OpenClaw exec approval pipeline remains the only authorization surface; the new warning
is static and does not copy command text or credentials. These process writes are outside the
ClawX write journal, carry `rollbackClaim=false`, and are never automatically rolled back.

Focused policy tests cover the representative triggers, read-only counterexamples, warning
deduplication, approval-warning sanitization, and the real `createExecTool` to
`exec.approval.request` warning payload. Runtime typecheck, targeted oxlint, unit-fast,
the Electron execution-surface E2E, comms replay/compare, and the full VerseShell suite pass. The two prior
`SessionAdmissionIdentityError` failures in `governed-exec-runtime.test.ts` were repaired by
supplying the required lifecycle `agentId` in the test helper.

This is engineering evidence only. It does not enable writes, canary traffic, default-on, GA,
or product approval. Keep `default-off`, `liveReady=false`, `productApproved=false`, and
`defaultOn=false`.

The re-review also repaired the existing Workspace Git audit E2E setup: environment disk-space
toasts are isolated, the audit row is expanded before detail checks, and the missing
`approvals.externalWriteNoRollback` key is covered in `en` / `zh` / `ja` / `ru`. The focused audit
flow passes 1/1 and confirms no command, path, or secret leakage. Chat/Inbox E2E passes 3/3; the
full Workspace Git file is 2/3 because its remaining failure is the pre-existing 214-pixel (~1%)
`ai-commit-card` screenshot drift, with functional flows passing. `TF-0068` remains
`in_progress`; no rollout lock or authorization boundary changed.

## P3-02 classifier soundness repair (2026-09-03)

An independent adversarial review found the P3-02 gates green but the classifier itself unsound, so
the success metric "undeclared external write = 0" did not hold. Two command classes reached
`effectLevel: "none"` while executing arbitrary code: `git config --show-scope --add <key> <value>`
(a read flag beside a write action, which real git accepts) and any executable whose basename is
`git` (`C:\evil\git.cmd`, classified read-only while the same plan carried the audited
`windows-cmd` interpreter). Four narrower defects were also confirmed: read-only claims keyed on a
basename rather than the operator's own command token, `rg --hostname-bin=<cmd>` executing a command
while classified `none`, twelve genuinely read-only Git forms mislabeled as writes, and
`stripSensitiveApprovalDetails` leaving `requestHash` — a field built from the command, path, or
parameters — in the redacted projection.

All six are fixed and each fix is pinned by a probe that reverts it and observes the intended cases
fail. Read-only claims now enumerate permitted flags and reject anything unrecognized; script
identity is decided before any profile branch; Git global-flag scanning is scoped to the
pre-subcommand region so `git rev-parse --git-dir` is no longer confused with
`git --git-dir=<path> status`. Every expectation was measured against real git 2.51.0.windows.1 and
ripgrep 15.1.0. `command-profiles.ts` was also split so the touched files stay under the
repository's 500-line bound.

Verification: full VerseShell 22 files / 313 tests, unit-fast 67 files / 502, renderer approval and
inbox 8/8, `tsgo:core`, `typecheck:node`, `typecheck:web`, `contract:check`, `i18n:lint`, targeted
type-aware oxlint, changed-file ESLint, `build:vite`, `build:runtime`, Chat/Inbox E2E 3/3,
comms replay/compare, Harness context and `validate --since HEAD`, and `git diff --check` all pass.
Workspace Git E2E remains 2/3 on the pre-existing screenshot drift.

One residual is now recorded explicitly rather than implied away: no host or renderer code reads
`externalWritePolicy`, and the only ClawX producer of `risk: 'external-write'` is out-of-workspace
`files.writeText`, so the renderer redaction and the runtime classifier cover disjoint command
populations. That is this slice's declared boundary; wiring the runtime classification through to the
ClawX approval surface belongs to the remaining external-write coverage work. `TF-0068` stays
`in_progress`. No rollout lock, authorization boundary, approval channel, journal, or feature flag
changed. Keep `default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.

## P3-02 renderer-side repair (2026-09-03)

A second independent review examined the renderer half and proved the disjunction above by
enumeration: `approval.updated` has exactly two emitters, both on the runtime exec approval path;
the ClawX permission store the approval card renders has exactly seven writers, all Electron
service APIs, none of which emits a runtime event; and the `approval.updated` payload carries no
`risk` field. Four defects followed from that gap and are now fixed.

The exec `warningText` — where VerseShell's static no-rollback notice lands — reaches the renderer
as `approval.updated.message` and appears on that event's execution-graph row. The promotion table
had been dropping every approval row on the premise that an approval card stood behind it; given
the disjunction none does, so the only in-app rendering of the warning was being deleted. Rows
carrying a message are now kept and bare labels still dropped. Three panels
(`WorkspaceGitPanel`, `WorkspaceTerminalPanel`, `RolesOrchestrationPanel`) read `approval.reason`
raw, and that reason is the one embedding `workspace.rootPath` verbatim; all three now read through
the redaction helper, as does `PendingRunApprovals`, whose positional ternary guard would have
broken on any branch reorder. Severity was inverted — `external-write` rendered neutral while
journal-covered `dangerous` rendered destructive — and now groups with the destructive risks in both
surfaces. `projectApprovalSurface` and `RunApprovalSurface` had zero callers repo-wide and are
deleted rather than left looking like hardened surface.

A new `approval-redaction-contract` test guards the contract at the call sites by reading the six
renderer sources, because a unit test of the helpers cannot catch a surface that bypasses them.
Each fix is pinned by a probe that reverts it and observes the intended case fail. Verification:
focused renderer 5 files / 43 tests, full VerseShell 22 files / 313, `tsgo:core`, `typecheck:node`,
`typecheck:web`, `contract:check`, `i18n:lint`, changed-file ESLint, `build:vite`, `build:runtime`,
Chat/Inbox E2E 3/3, the FP-P1-02 preflight E2E that owns the reason assertion 1/1, comms
replay/compare, Harness context and `validate --since HEAD`, and `git diff --check` all pass.
Workspace Git E2E remains 2/3 on the pre-existing screenshot drift.

`TF-0068` stays `in_progress`. No rollout lock, authorization boundary, approval channel, journal,
or feature flag changed. Keep `default-off`, `liveReady=false`, `productApproved=false`, and
`defaultOn=false`.

## P3-02 unit-suite isolation repair (2026-09-03)

Running `tests/unit` in full for this package exposed nine failures that were environment-dependent
rather than pre-existing, which meant the package could not state a reproducible baseline. All nine
are repaired. `chat-knowledge-scope` (7) and `chat-api-workspace-fingerprint` (4) read real
`~/.openclaw` transcripts through the pre-Gateway budget gate; this machine's 8,990,004 accumulated
tokens exceed the 1,000,000-token default, so every send was rejected as `TOKEN_BUDGET_EXCEEDED`
before the assertions could run — the files passed only below the budget. Both now mock the usage
reader, leaving budget behaviour to the test that owns it. `file-preview-body` and
`use-session-status-failure-states` failed collection because their `vi.mock` factories closed over
module-level consts that hoisting places after the factory; both now use `vi.hoisted`.
`chat-save-to-knowledge` mocked the artifact-panel store as a selector only while Chat also calls
`getState()` on it.

`tests/unit` is now 800 files / 7121 tests passing with 17 files still failing. Every one was
verified untouched by this branch, and the three that could plausibly have been caused by the
promotion-table change fail identically with that change reverted. Two figures in the earlier record
are corrected: the `ai-commit-card` drift is 214 pixels (ratio 0.01), not 617, and the full
VerseShell suite's green count is not fully reproducible because `process-manager.test.ts` carries a
pre-existing handshake-timing race.

The Harness spec's `touchedAreas` now covers the five test-isolation files and the three files added
by the classifier split, so `validate --since HEAD` passes without a waived path.

## P3-02 closeout (2026-09-03)

`TF-0068` / VS-P3-02 is `done` at 100%. The closeout proposal
`TFP-TF-0068-closeout-20260903` is saved and applied; Task Forest `validate` and `export` pass.

What the node delivers, on the command population it declared: external-write classification hangs
off both construction paths of the host-owned immutable command plan, the model cannot select or
suppress it, `rollbackClaim` is fixed to `false` at the type level so a false-positive rollback claim
is unrepresentable, the static warning is bounded and deduplicated into the existing exec approval,
and every renderer surface reads approvals through the redaction helper — guarded at the call sites,
not just in the helper's own unit test. Both adversarial-review blockers and all six majors are
fixed, each pinned by a probe that reverts it and observes the intended cases fail.

Two residuals are recorded with the closeout rather than absorbed into it
(`TFD-tf0068-closeout-residuals-20260903`): the `workspace-git-panel` E2E is 2/3 on the 214-pixel
`ai-commit-card` screenshot drift, shown causally independent by diff inspection, and `tests/unit`
carries 17 pre-existing failing files, none touched by this branch and measured identical with the
promotion-table change reverted. Also recorded: the ClawX permission store retains raw request
fields as the record of source; redaction happens in the render projection, which is what the spec's
forbidden-pattern list governs. Neither residual licenses a claim that E2E or `tests/unit` is green.

The declared slice boundary is unchanged and now carried by the pre-existing deviations on
`TF-0056`: other host and plugin write entry points are not covered, and the runtime
`externalWritePolicy` is not yet wired to the ClawX approval surface, so "undeclared external write =
0" does not yet hold repository-wide. No rollout lock, authorization boundary, approval channel,
journal, undo stack, feature flag, or config leaf changed. Keep `default-off`, `liveReady=false`,
`productApproved=false`, and `defaultOn=false`. `TF-0069` / VS-P5-01 remains `proposed` and is not
unlocked by this closeout.

## Non-negotiable decisions

- Bundle the AGPL VerseShell runtime and preserve its required license/source obligations.
- Fail closed when the verified runtime, policy, approval, protocol, or artifact contract cannot be established.
- The workspace and policy process jointly own governed execution. A compatibility path must not bypass either authority.
- The first saved-result evaluation targets Anthropic and OpenAI-compatible providers. The evaluator never requires credentials or performs live network calls.
- MCP is optional compatibility surface only. The foundation has no internal dependency on MCP, an MCP server, or the old Node MCP map.
- Read-only shadowing is strictly allowlisted and produces normalized, bounded, redacted evidence. It never executes writes, commands, tests, network operations, deletes, or transaction mutations.

## P0-P5 rollout and deprecation phases

### P0 — frozen baseline and evidence contracts

- Freeze the old Node MCP operation map: no new foundation capabilities are added to it and this phase does not edit it.
- Land independent default-off rollout resolution, read-only shadow planning/comparison, bounded telemetry contracts, and the offline learning-cost evaluator.
- Record provenance for every resolved flag. A project/global kill switch may disable the entire foundation fail-closed.
- Native fallback is unavailable to governed execution. Shadow access is read-only or disabled.

Exit evidence: safe-default tests, strict allowlist tests, redaction/bounds tests, stable telemetry tests, and saved-result evaluator tests.

### P1 — verified runtime canary

- Wire only process/version/protocol startup and handshake under an explicit canary.
- Require exact protocol compatibility and fail closed on outage or mismatch.
- Keep facade, governed execution, artifacts, deferred operations, legacy evaluation, MCP compatibility, native fallback, and shadow disabled unless independently enabled for the canary.

Exit evidence: restart/crash/handshake telemetry and operator rollback proof.

### P2 — typed ACI and read-only shadow

- Enable typed ACI and the facade for selected read-only operations.
- Shadow eligibility remains limited to `file.view`, `file.read_range`, `file.hash`, `repo.search`, `repo.summary`, `tx.status`, `runtime.handshake`, `ops.list`, and result metadata.
- Do not compare prose. Compare structured outcome/error code, normalized path/data fingerprints, diagnostics, effects/capabilities, artifact metadata, and approval state.

Exit evidence: bounded mismatch rates with no shadow side effects or sensitive payload retention.

### P3 — governed execution and artifact results

- Admit governed execution only through the workspace+policy process and approval controls.
- Enable artifact-backed results and recovery independently from governed execution.
- Native execution fallback remains disabled for the governed path. Runtime outage or policy uncertainty fails closed.

Exit evidence: approval-denial, outage, artifact expiry, truncation, and recovery scenarios pass.

### P4 — optional compatibility migration

- Offer MCP compatibility only to external clients that still require MCP. Internal foundation callers must use typed ACI/facade contracts directly.
- Gate and meter legacy eval, MCP compatibility, and any explicitly approved non-governed native fallback separately.
- Stop expanding the frozen old Node MCP map. Publish migration guidance and a removal window based on measured use, not assumptions.

Exit evidence: compatibility telemetry shows remaining consumers and rollback remains available.

### P5 — deprecation completion

- Remove legacy eval and the frozen old Node MCP map only after supported clients have migrated and measured use is zero for the agreed window.
- MCP may remain as an optional boundary adapter, but it cannot become an internal dependency.
- Retain emergency kill-switch and fail-closed recovery procedures for the supported foundation path.

Exit evidence: provider-backed completion, latency, usage, artifact/recovery, and compatibility records support the decision. Heuristic token estimates cannot justify a savings or removal claim.

## Learning-cost claim policy

Tool-definition bytes/count/cache stability, call/result bytes, task completion, tool turns, latency, provider usage, and artifact/recovery behavior are reported separately. Cold and warm records remain distinct. Provider response usage or billing exports are actual token evidence; VerseShell heuristic estimates, token-count endpoints, and four-characters-per-token approximations are estimates only. No 50-70% savings statement is permitted unless paired, comparable actual provider usage directly supports it.

## UAS-05 engineering update (2026-07-30)

The foundation remains **default-off, canary-only, and not eligible for default-on or GA claims**.
UAS-05 process-lifecycle parity is implemented and locally verified, and its Task Forest closeout
is confirmed and applied. UAS-06 engineering qualification has started, but no real cohort
observation has been collected.

### Runtime contract

- The typed catalog now contains 31 operations, including internal `process.start`, `process.poll`,
  `process.write`, `process.kill`, and `process.list`. These lifecycle operations remain hidden from
  MCP and are not new model-facing tools.
- The lifecycle state is `starting -> running -> exited | killed | lost`; a failed start does not
  publish a process id. The ownership key binds `process_id` to `runtime_id`, canonical
  `workspace_id`, `agent_id`, and `session_id`. Mismatches fail closed.
- Output uses a monotonically increasing byte cursor. Poll responses expose requested/next cursor,
  retained start cursor, lost bytes, explicit truncation, state, and terminal artifact lineage.
  Output is bounded by the approved start budget; records and persisted output are retained for 24
  hours, then removed.
- Durable metadata and bounded output live under the workspace `.ae/process-lifecycle` directory.
  A new runtime never replays `process.start`; retained `starting/running` records that cannot be
  re-owned become terminal `lost` with `runtime_restart_unrecoverable`.
- Windows resolution covers `PATH`/`PATHEXT`, `.exe/.com/.cmd/.bat`, explicit audited `cmd.exe` for
  batch shims, cwd, environment overrides, spaces, and Unicode paths. Pipe stdin supports write,
  submit, and EOF; EOF is reported successful only after the lifecycle owner acknowledges it.
  ConPTY supports interactive input. Job Objects terminate the full process tree for explicit kill,
  timeout, shutdown, and runtime crash.
- The existing OpenClaw `exec` branch starts the lifecycle owner and the existing `process` tool
  writes, polls, and cancels that session. VerseShell-owned PIDs are forbidden from the native PID
  fallback. Governed failures remain fail-closed; legacy eval/native compatibility remains a
  separate default-off path.

### Bundle identity and local evidence

- Base commit: `c3983694407a9ddb23505e05fad4a9eae653b283`.
- Corresponding-source patch: `resources/verseshell/patches/uas-05-process-lifecycle.patch`,
  SHA-256 `cabfb192f6f9688156f5a3ab5a19307fcd1af3fb2ee2c59b2d494a557d417098`.
- Windows x64 `ae.exe`: `14880256` bytes, SHA-256
  `19ca598916077f677722b4f82d8dfc1c24c4e88ace9809abe681255370702699`.
- Catalog: 31 operations, digest
  `sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7`.
- Rust lifecycle integration passes 3 tests; operation protocol passes 9 tests; release build
  succeeds. Coverage includes direct argv/env/PATHEXT, pipe and ConPTY input, cursor loss/truncation,
  owner mismatch, idempotent kill, timeout, parent/child cleanup, runtime-crash cleanup, and restart
  reconciliation without respawn.
- The focused OpenClaw suite passes 8 files / 47 tests. Root manifest and UAS-05 evidence pass 2
  files / 12 tests. Bundle script tests pass 8/8 and package-mode manifest validation passes.

### Remaining production blockers

1. TF-0016 closeout proposal `TFP-tf0016-verseshell-process-lifecycle-closeout-20260730` is
   confirmed and applied. Canonical state is `TF-0016=done, 100%` and `TF-0017=ready, 0%`;
   UAS-06 engineering work has started. Proposal
   `TFP-tf0017-single-local-exec-engineering-20260730` requests an in-progress update and still
   requires explicit confirmation.
2. UAS-06 engineering qualification does not switch the default local execution plane or remove
   the native baseline. The selected canary remains explicit and default-off.
3. Collect provider-backed, installed-product, latency/resource, artifact recovery, operator
   kill-switch/rollback, real paired A/B, and soak evidence before closeout or phase graduation.

**Current conclusion:** lifecycle parity is an engineering acceptance result, not product
graduation. Keep `liveReady=false`, `productApproved=false`, `defaultOn=false`, C1 `keep-off`,
Runtime Memory `diagnostics-only`, and SEKB auto-writeback disabled.

## UAS-06 engineering update (2026-07-30)

UAS-06 adds a deterministic, operator-owned canary route without widening the model tool surface.
Strict configuration accepts `tools.exec.host=verseshell` globally and per agent, and the existing
session override can select the same route. The model-facing `exec` host enum remains limited to
`auto`, `sandbox`, `gateway`, and `node`.

- Eligible non-sandboxed, non-node, non-elevated local execution in the selected scope is owned by
  the governed VerseShell lifecycle. Sandbox, node, remote, provider-native, and elevated execution
  retain their existing owners and are excluded from the canary denominator.
- The route requires `verifiedRuntime`, `typedAci`, `facade`, and `governedExec`. A denial, outage,
  timeout, protocol mismatch, or lifecycle failure cannot retry through the native shell. The kill
  switch fails closed; rollback requires an explicit operator change back to the previous host.
- Exec diagnostics now retain selected host, actual execution host, lifecycle owner, cohort route,
  native fallback, duration/outcome, and recovery state. Command contents are not retained in the
  stability record.
- `artifacts/uas-06-single-local-exec-canary/report.json` is explicitly `engineering-only`. Its nine
  engineering scenarios cover short, long, background, stdin, PTY, cancel, timeout, restart, and
  rollback with 100% governed coverage, zero native fallback, and no engineering hard veto.

The report status is `needs-real-canary`, not closeout. Real internal observations, paired native
baseline/VerseShell tasks, actual provider usage for every observation, human recovery minutes,
and reviewed operator kill/rollback evidence all remain at zero. `TF-0017` therefore remains
incomplete; `TF-0018/UAS-07` and `TF-0019/UAS-08` remain locked. Product graduation is not
authorized.

## UAS-06 reviewed live evidence channel (2026-07-30)

`artifacts/uas-06-single-local-exec-canary/live-observations.json` is an initially empty, strictly
validated input for reviewed live cohort records. It is intentionally separate from the engineering
matrix and accepts only low-sensitivity diagnostic route windows, external provider receipt digests,
and human recovery/rollback attestations. The generated
`real-cohort-report.json` remains a closeout-review candidate only: it cannot authorize Task Forest
closeout, product graduation, default-on, or any product lock change. See
[`UAS-06-REAL-CANARY-RUNBOOK.md`](./UAS-06-REAL-CANARY-RUNBOOK.md) for the controlled operator
procedure.
