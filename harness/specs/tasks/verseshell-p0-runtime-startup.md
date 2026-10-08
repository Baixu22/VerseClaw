---
id: verseshell-p0-runtime-startup
title: VerseShell P0 Runtime Startup and Rust Test Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a minimal tracked patch for the manifest-pinned VerseShell 1.0 source that removes the short-uptime cache initialization panic and proves all Rust test targets compile plus the real startup matrix, without changing bundle identity, protocol rollout, or product locks.
touchedAreas:
  - harness/specs/tasks/verseshell-p0-runtime-startup.md
  - harness/specs/rules/verseshell-foundation-p0-boundary.md
  - resources/verseshell/patches/p0-runtime-startup.patch
  - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - The VerseShell server can initialize and answer a minimal handshake on short-uptime and restarted hosts without an Instant underflow panic.
  - Rust unit, integration, test-target compilation, and the JSON/compact x agent/non-agent startup matrix are real gates; TypeScript or packaged-binary success cannot mask Rust failures.
  - Runtime remains default-off, fail-closed, and unchanged at the product/configuration boundary while P0 startup is repaired.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - comms-regression
  - docs-sync
  - supply-chain-integrity-pinning
  - verseshell-foundation-p0-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p0-runtime-startup.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p0-runtime-startup.md --no-diff
  - git apply --check resources/verseshell/patches/uas-05-process-lifecycle.patch against pinned commit c3983694407a9ddb23505e05fad4a9eae653b283
  - git apply --check resources/verseshell/patches/p0-runtime-startup.patch after the UAS-05 patch
  - cargo test --locked --manifest-path <materialized-pinned-source>/Cargo.toml --no-run
  - source-built JSON/compact x agent/non-agent startup matrix
  - pnpm verseshell:test
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The P0 patch applies cleanly after the tracked UAS-05 patch to exact commit c3983694407a9ddb23505e05fad4a9eae653b283 and changes only src/cache.rs.
  - SystemSnapshot default construction has an explicit empty/expired state and never subtracts a fixed duration from Instant::now().
  - A deterministic constructor-level regression proves initialization is safe without depending on the current machine uptime.
  - cargo test --locked --no-run compiles every actual pinned 1.0 Rust test target and passes; the unskipped execution gate remains a P0 exit requirement owned by VS-P0-02 because it requires the complete tracked source-input reconstruction.
  - Independent JSON and compact starts in agent and non-agent modes all exit cleanly without the cache panic.
  - Existing packaged handshake and VerseShell TS/real-binary tests remain green after the Rust change.
  - No manifest, ae.exe, typed protocol, model tool, feature flag, runtime configuration, STATUS.md, or product lock changes are introduced.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P0 Runtime Startup and Rust Test Gate

This specification owns Task Forest `TF-0058` / VS-P0-01 only. It repairs the Rust runtime
startup/test gate identified by the G0 baseline against the exact manifest-pinned 1.0 source at
commit `c3983694407a9ddb23505e05fad4a9eae653b283`. Bundle/source/protocol reconciliation and
vendoring belong to VS-P0-02; governed approval requalification belongs to VS-P0-03.

## Frozen boundaries

- Preserve `default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.
- Do not modify `resources/bin/win32-x64/ae.exe`, `resources/verseshell/manifest.json`, typed
  ACI protocol/catalog declarations, OpenClaw approval behavior, MCP, facade operations, or
  native fallback.
- Do not claim that a passing Rust gate closes source/build/protocol drift or governed approval.
- Keep all process/policy ownership rules from `verseshell-foundation-p0-boundary` intact.
- Do not modify or reuse the locally excluded `verseshell-runtime/` 0.3 snapshot as P0 evidence.

## Required regression evidence

Materialize the exact pinned source in a clean worktree, apply
`resources/verseshell/patches/uas-05-process-lifecycle.patch`, then apply
`resources/verseshell/patches/p0-runtime-startup.patch`. The startup patch must change only
`src/cache.rs`. Its deterministic constructor/helper regression must prove an empty snapshot is
expired without backdating `Instant`; a host uptime greater than one hour is not evidence that the
underflow condition is fixed. Preserve patch digests, exact commands, exit codes, and residuals in
the P0 baseline.

## Corrected source boundary

The locally excluded `verseshell-runtime/` tree is a legacy 0.3 snapshot with an old `AgentRequest.cmd`
surface. Its cache/capability/auth/scheduler/repl/compact changes are not the source of record and
must not be migrated merely because that local suite passed. The clean pinned 1.0 source already
contains the relevant capability and runtime implementations; its remaining VS-P0-01 defect is the
`Instant::now() - Duration::from_secs(3600)` cache bootstrap expression.

VS-P0-01 records a stackable, tracked startup patch and validates it on a clean materialization.
VS-P0-02 owns the complete tracked source-input reconstruction, unskipped Rust suite,
reproducible bundle tool, composite provenance, binary digest comparison, and release/acceptance
integration. A passing P0-01 source tree is not a bundle identity or release qualification claim.

If the pnpm command wrapper fails before the local communication script starts because its
dependency-verification layer cannot fetch, record that exact wrapper failure and run the same
repository-owned replay and compare `.mjs` entrypoints directly with Node. Script-level PASS is
acceptable evidence for VS-P0-01 only; it neither hides the wrapper residual nor authorizes
rollout.
