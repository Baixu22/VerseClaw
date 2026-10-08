---
id: verseshell-p0-reproducible-bundle
title: VerseShell P0 Reproducible Source Bundle and Supply-Chain Identity
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the legacy dirty-tree and ignored-binary trust narrative with a tracked, ordered, hash-verified reconstruction of the pinned VerseShell 1.0 source, then prove complete Rust tests and two deterministic Windows release builds before Electron or OpenClaw accepts the runtime identity.
touchedAreas:
  - harness/specs/tasks/verseshell-p0-reproducible-bundle.md
  - harness/specs/tasks/verseshell-p0-runtime-startup.md
  - harness/specs/rules/verseshell-foundation-p0-boundary.md
  - package.json
  - electron-builder.yml
  - resources/verseshell/**
  - scripts/verseshell-bundle.mjs
  - scripts/verseshell-bundle.test.mjs
  - scripts/validate-verseshell-manifest.mjs
  - scripts/lib/agent-engineering-acceptance.mjs
  - .github/workflows/release.yml
  - electron/utils/verseshell-runtime-bundle.ts
  - tests/unit/verseshell-runtime-bundle.test.ts
  - tests/unit/verseshell-manifest.test.ts
  - tests/unit/uas-05-verseshell-process-lifecycle.test.ts
  - docs/dev/verseshell-foundation/**
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - A package or development bundle is accepted only when its source repository, pinned commit, ordered patch stack, required source inputs, Cargo lockfile, toolchain, binary digest, handshake, and operation catalog form one verified identity.
  - Missing, reordered, modified, ignored, generated, or unlisted source inputs fail closed before build or package acceptance.
  - The shipped Windows ae.exe is a verified output of two independent clean reconstructions; a legacy ignored binary is never copied or cited as source-of-truth evidence.
  - VerseShell remains default-off and no governed execution, facade, MCP, model tool, canary, or product lock is widened by this task.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - contract-first-boundary
  - capability-owner-resolution
  - runtime-local-ecosystem-boundary
  - supply-chain-integrity-pinning
  - comms-regression
  - docs-sync
  - verseshell-foundation-p0-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-p0-reproducible-bundle.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-p0-reproducible-bundle.md
  - node --test scripts/verseshell-bundle.test.mjs
  - pnpm exec vitest run tests/unit/verseshell-runtime-bundle.test.ts tests/unit/verseshell-manifest.test.ts --maxWorkers=1
  - reconstruct exact commit c3983694407a9ddb23505e05fad4a9eae653b283 and apply the manifest-declared patch stack in order with git apply --check
  - verify every declared recovered source input and final source assertion by size and SHA-256
  - cargo test --locked --manifest-path <clean-reconstruction>/Cargo.toml -j 1
  - cargo test --locked --manifest-path <clean-reconstruction>/Cargo.toml --no-run -j 1
  - run optional Python fixture verification through the current interpreter contract
  - perform two independent clean cargo build --locked --release --bin ae builds with reproducibility controls and compare SHA-256
  - validate source bundle and an unpacked package-shaped bundle
  - pnpm verseshell:test
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - A tracked source-input manifest identifies the exact HTTPS repository, 40-character commit, commit timestamp, ordered patch paths with byte sizes and SHA-256 digests, eight recovered ACI-Bench Python inputs, final contract/lockfile assertions, exact Rust/Cargo identity, and deterministic build controls.
  - Source capture includes only explicitly allowlisted ignored source inputs after checking their expected size and SHA-256; __pycache__, .pyc, target, .ae results, executables, PDBs, logs, and other generated ignored files are excluded.
  - Clean reconstruction applies only the ordered tracked patches, verifies no undeclared input is required, and runs cargo test --locked without skips, including aci_bench_mock_meets_acceptance_gate.
  - The two Python task optional verifiers use an explicit current-interpreter module invocation and pass on the supported Windows environment, or report unsupported without a false green.
  - Package-mode build uses Cargo and rustc 1.94.0, CARGO_INCREMENTAL=0, a fixed SOURCE_DATE_EPOCH, source-path remapping, and the MSVC /Brepro linker control; two independent build roots produce byte-identical ae.exe SHA-256 digests.
  - Manifest schema and all repository/package/runtime validators verify the source-input manifest digest, patch order and hashes, recovered-input inventory, reproducibility proof, binary digest, crate/protocol/catalog identity, and corresponding-source payload; any mismatch fails closed.
  - Electron packaging includes the tracked source-input manifest and every declared patch alongside LICENSE, NOTICE, SOURCE, BUILD, and manifest files.
  - No existing ignored resources/bin/win32-x64/ae.exe is used as build input or proof; it may be replaced only by the newly verified reproducible output after all pre-copy gates pass.
  - default-off, liveReady=false, productApproved=false, and defaultOn=false remain unchanged.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/handoffs/LATEST.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# VerseShell P0 Reproducible Bundle

This specification owns Task Forest `TF-0059` / VS-P0-02 only. It converts the exact upstream
commit plus reviewed patches into the sole build identity for the Windows x64 typed ACI runtime.
It does not requalify governed approval behavior; that remains VS-P0-03.

## Frozen rollout and authority boundaries

- Preserve `default-off`, `liveReady=false`, `productApproved=false`, and `defaultOn=false`.
- Do not add facade operations, model-visible tools, MCP capability, native fallback, approval
  bypass, write behavior, or canary traffic.
- OpenClaw remains policy/approval owner, ClawX Main remains bundle/workspace owner, and
  VerseShell remains typed execution/artifact owner.
- The locally ignored legacy `resources/bin/win32-x64/ae.exe` and any dirty external source tree
  are discovery inputs only. Neither may be copied into the new evidence chain.

## Corresponding-source model

The authoritative source identity is an exact upstream commit followed by an ordered list of
tracked patches. A tracked source-input manifest records each patch and every source assertion by
path, byte size, and SHA-256. Reconstruction creates a fresh detached worktree, checks and applies
the patches in order, and verifies the final assertions before invoking Cargo.

The eight Python runner/scorer/fixture files remain explicitly allowlisted because the upstream
`*.py` ignore rule would otherwise hide them from ordinary untracked-file discovery. This is a
narrow exception, not permission to capture arbitrary ignored files. Generated caches, build
targets, result stores, binaries, PDBs, logs, and editor files must remain outside the patch and
inventory.

## Reproducible build contract

Package qualification performs two independent reconstructions and builds with the exact recorded
toolchain. Both builds use the lockfile, disable incremental compilation, fix the source epoch,
remap temporary source roots to one stable virtual path, and pass the deterministic MSVC linker
control. The destination binary and manifest are not mutated unless all source, test, handshake,
catalog, and byte-for-byte comparison gates pass.

## Honest residuals

Passing this task proves source/build/protocol identity for the supported Windows x64 bundle. It
does not prove approval denial/retry semantics, lifecycle stability, facade integration, real
provider usage, canary readiness, default-on eligibility, or product approval.
