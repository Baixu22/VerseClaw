# VerseShell Foundation Status and Deprecation Policy

Status: default-off controlled canary foundation. The strict typed ACI route is wired, but no VerseShell capability is enabled by default and this is not GA or release approval.

The capability-gap audit, target architecture, rejected surfaces, and dependency-ordered implementation schedule are documented in [CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md](./CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md). That report is planning input; this file remains authoritative for current rollout status.

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
