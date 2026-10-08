---
id: uas-05-verseshell-process-lifecycle
title: UAS-05 VerseShell process lifecycle parity
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the verified VerseShell ACI process the owner of governed local process creation and lifecycle while preserving the existing OpenClaw exec/process tool surface, approval authority, Windows behavior, bounded output, and fail-closed rollout controls.
ownedPaths:
  - harness/specs/tasks/uas-05-verseshell-process-lifecycle.md
  - harness/specs/rules/verseshell-process-lifecycle-boundary.md
  - resources/bin/win32-x64/ae.exe
  - resources/verseshell/manifest.json
  - resources/verseshell/SOURCE.md
  - resources/verseshell/BUILD.md
  - resources/verseshell/patches/uas-05-process-lifecycle.patch
  - scripts/verseshell-bundle.mjs
  - scripts/verseshell-bundle.test.mjs
  - scripts/validate-verseshell-manifest.mjs
  - electron/utils/verseshell-runtime-bundle.ts
  - electron/utils/verseshell-runtime-request.ts
  - shared/verseshell/**
  - openclaw_runtime/src/agents/verseshell/**
  - openclaw_runtime/src/agents/verseshell-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec.ts
  - openclaw_runtime/src/agents/bash-tools.process.ts
  - openclaw_runtime/src/agents/bash-process-registry.ts
  - openclaw_runtime/src/agents/bash-process-references.ts
  - openclaw_runtime/src/agents/bash-tools.process-send-keys.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - openclaw_runtime/src/config/runtime-verseshell-foundation.test.ts
  - tests/unit/verseshell-*.test.ts
  - tests/unit/uas-05-verseshell-process-lifecycle.test.ts
  - docs/dev/verseshell-foundation/**
  - docs/dev/unified-agent-system/**
  - docs/dev/handoffs/LATEST.md
touchedAreas:
  - harness/specs/**
  - resources/bin/win32-x64/ae.exe
  - resources/verseshell/**
  - scripts/verseshell-*
  - scripts/validate-verseshell-manifest.mjs
  - electron/utils/verseshell-*
  - shared/verseshell/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/test/vitest/**
  - tests/unit/**
  - docs/dev/verseshell-foundation/**
  - docs/dev/unified-agent-system/**
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - Governed foreground, background, piped-stdin, and PTY commands use the verified VerseShell process lifecycle API without changing the model-facing exec/process tools.
  - process poll/log reads use monotonic cursors and never duplicate or silently lose output inside the retained window.
  - process write/send-keys/submit/paste/kill control the VerseShell-owned process and return explicit errors after exit or ownership mismatch.
  - Agent abort and timeout terminate the governed process tree unless the command was deliberately yielded to background.
  - After a Gateway restart, previously running VerseShell process records reconcile to an explicit running, exited, killed, or lost state; they are never silently recreated.
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
  - verseshell-process-lifecycle-boundary
forbiddenPatterns:
  - OpenClaw or Electron spawning the governed payload after VerseShell lifecycle mode is selected
  - native-shell fallback after a governed VerseShell outage, denial, timeout, protocol mismatch, or process failure
  - replaying or respawning an in-flight process after transport restart
  - reusing a lifecycle id across agent, session, workspace, or runtime instance boundaries
  - returning output without a monotonic cursor and explicit truncation or retention metadata
  - treating workspace jail as an OS filesystem sandbox
  - exposing new model-facing VerseShell tools or the full upstream operation catalog
  - changing liveReady, productApproved, defaultOn, TF-0006, TF-0009, TF-0017, TF-0018, TF-0019, Runtime Memory, or SEKB policy
featureFlags:
  - Reuse the existing verified-runtime, typed-ACI, facade, and governed-exec gates; add no default-on path.
  - Lifecycle operations are available only inside the already opted-in governed VerseShell route.
  - Legacy eval and compatibility native fallback remain independent default-off compatibility paths and are not accepted UAS-05 evidence.
rollback:
  - Restore the prior pinned ae.exe, manifest, corresponding-source metadata, and typed ACI catalog identity.
  - Restore governed exec to synchronous exec.run and remove lifecycle routing from OpenClaw exec/process.
  - No process is replayed during rollback; retained lifecycle records become explicit lost/unsupported evidence.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/uas-05-verseshell-process-lifecycle.md
  - pnpm harness validate --spec harness/specs/tasks/uas-05-verseshell-process-lifecycle.md
  - cargo test --manifest-path ../../verseshell/verseshell/Cargo.toml --test operation_protocol_tests --test process_lifecycle_tests
  - cargo build --release --manifest-path ../../verseshell/verseshell/Cargo.toml --bin ae
  - pnpm verseshell:test
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/uas-05-verseshell-process-lifecycle.test.ts --reporter=verbose --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The pinned VerseShell operation catalog exposes typed process.start, process.poll, process.write, process.kill, and process.list operations behind shell.exec; OpenClaw does not expose them as new model tools.
  - process.start accepts an approved normalized argv plan, canonical cwd, bounded sanitized environment, stdin mode, PTY request, timeout, output budget, agent id, and session id without reparsing the command after approval.
  - Windows PATH/PATHEXT resolution covers exe/com/cmd/bat, package-manager shims, spaces, Unicode paths, cwd, environment overrides, non-zero exit, timeout, no-output success, and oversized output.
  - Non-PTY and PTY processes support foreground wait, deliberate background/yield, monotonic poll/read, stdin write/eof, key submission, and process-tree kill.
  - Agent abort kills a non-backgrounded process tree; abort after deliberate yield only detaches the tool call. Timeout always kills the process tree.
  - Process identities are scoped to runtime instance, workspace, agent, and session. Ownership mismatch fails closed.
  - Exit records and bounded output/artifact lineage remain queryable for the configured retention window.
  - Runtime restart reconciliation never duplicates a process. A durable record is marked exited, killed, or lost when ownership cannot be re-established.
  - Real Windows ae.exe tests prove direct argv/env/PATH behavior, pipe stdin, PTY, streaming cursor, background poll, kill, timeout tree cleanup, and restart reconciliation.
  - Governed execution retains OpenClaw approval, strict VerseShell policy, action-bound token isolation, verified binary/catalog identity, and zero implicit native fallback.
  - All production flags remain default off and UAS-05 does not start TF-0017 canary or change any product graduation lock.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
    - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - Record the process state machine, ownership key, cursor/retention contract, restart reconciliation, Windows matrix, and corresponding-source/binary identity.
    - Review README variants under docs-sync; update only when a public configuration, user workflow, or support statement changes.
---

# UAS-05 VerseShell Process Lifecycle Parity

This task implements Task Forest node `TF-0016/UAS-05` only. The existing OpenClaw `exec` and
`process` tools remain the model-facing surface and approval authority. For the explicitly opted-in
governed route, VerseShell becomes the sole owner of payload process creation, input/output,
timeout, cancellation, process-tree cleanup, bounded artifacts, and lifecycle audit.

The upstream source baseline is the clean VerseShell commit
`c3983694407a9ddb23505e05fad4a9eae653b283`. Any locally built replacement binary must carry a
tracked corresponding-source delta and updated immutable bundle metadata before it can be accepted.

UAS-05 provides capability parity only. It does not switch the product cohort to VerseShell,
remove the native baseline, enable any flag by default, claim OS sandboxing, start TF-0017, or
authorize live/product/GA graduation.
