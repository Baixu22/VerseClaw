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

## Acceptance update (2026-07-27)

The foundation remains **default-off, canary-only, and not eligible for default-on or GA claims**. The pinned runtime and typed governed route are integrated for explicit internal opt-in; provider-backed live canary and packaged-product acceptance remain outstanding.

### Verified locally

- Upstream source is a clean, tracked Git worktree at immutable commit `c3983694407a9ddb23505e05fad4a9eae653b283` (`feat: publish reproducible runtime operations baseline`). `src/ops/runtime_ops.rs` is tracked in that commit.
- `cargo test --test operation_protocol_tests --test mcp_stdio_tests` passes (**14 tests**) and `cargo build --release --bin ae` succeeds. The release build retains 11 pre-existing Rust warnings, which are not promotion evidence.
- A real Windows release-binary JSONL probe against `ae.exe --serve --agent --format json --policy strict` succeeds. With no capabilities, `runtime.handshake` reports allow-list mode with no grants and `exec.run` returns `E_CAPABILITY_DENY`; with `--cap shell.exec`, `exec.run` returns `E_NEEDS_APPROVAL` without executing. Startup/shutdown logs are emitted on stderr, not JSONL stdout.
- The handshake reports `agent_strict`, protocol `verseshell.jsonl/v1`, catalog schema `verseshell.operation-catalog/v1`, catalog digest `sha256:857eb12ca6b83da190764263a4e4a0181d3cd047926f0d404fc3a4c93c9f4848`, and catalog count `26`. Host-bound `policy_profile { id, digest }` echo was also verified.
- The checked-in local bundle was rebuilt from that clean commit. It records the exact clean provenance, immutable corresponding-source locator, byte size `14446592`, and SHA-256 `63716c3f0589c0291443f770a0ede97d728fb842aa39f50ac230ee7b5175e884` for `resources/bin/win32-x64/ae.exe`.
- Electron passes a verified binary path and SHA-256, runtime version, server protocol, and catalog digest/count into the Gateway. A config-only canary in `openclaw.json` also triggers this verification before Gateway spawn.
- `exec host=verseshell` now uses typed `exec.run` when the strict canary flags are enabled. It first passes OpenClaw command policy and approval, then retries an upstream `E_NEEDS_APPROVAL` once in a process scoped to the action-bound token. That process is closed after the action.
- The `clawx-governed-exec-v1` policy definition and digest are repository-owned. The process receives only `shell.exec`; permissive policy, `cap all`, inherited broad approvals, handshake drift, and unverified binary identity fail closed.
- The `verseshell_result` tool recovers bounded `result://sha256/...` artifacts through typed `result.query`. Raw/query output is capped at 64 KiB and 4000 estimated tokens, with additional line/match bounds.
- `pnpm verseshell:test`, the focused OpenClaw suite (including the real pinned `ae.exe` flow), the standard repository typecheck, and config-schema parity tests pass. The package verifier was exercised against a staged Electron resources layout and validated the copied AGPL payload plus `bin/ae.exe` checksum.
- Bundle validation was tightened without lowering controls: canonical indented FSF AGPL title lines are accepted, non-whitespace preambles remain rejected, and the `verify-package --resources` CLI now forwards its resource path correctly. The local manifest validator now verifies the synchronized clean provenance rather than the obsolete source-only scaffold.
- Legacy eval remains a separate default-off compatibility path. The governed typed route never performs native-shell fallback, including on outage, timeout, denial, protocol drift, or command failure.

### Remaining P1 / production blockers

1. Run provider-backed, operator-observed canaries with real Agent exec tasks and artifact recovery. Saved fixtures and focused tests are not live product evidence.
2. Validate the actual Electron packaging output and installed-app launch, including config-only opt-in, bundle absence/tamper, outage/restart, approval denial, kill switch, and rollback.
3. Record completion, latency, provider usage, output reduction, artifact expiry/recovery, and operational rollback evidence before discussing any phase graduation.

**Current conclusion:** the safety adaptation is implemented and suitable for an explicit internal canary only. Keep every production-affecting VerseShell flag disabled by default; do not infer P1 completion, default-on readiness, or joint-system GA.
