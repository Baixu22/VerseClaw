---
id: verseshell-typed-aci-adaptation
title: VerseShell Typed ACI Adaptation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the unsafe legacy VerseShell eval bridge with a pinned, verified, typed ACI execution path that OpenClaw agents can call through the existing exec tool without bypassing workspace, capability, approval, or output-budget controls.
touchedAreas:
  - harness/specs/tasks/verseshell-typed-aci-adaptation.md
  - package.json
  - electron-builder.yml
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/dev/handoffs/LATEST.md
  - resources/bin/win32-x64/ae.exe
  - resources/verseshell/**
  - scripts/after-pack.cjs
  - scripts/verseshell-bundle.mjs
  - scripts/verseshell-bundle.test.mjs
  - scripts/validate-verseshell-manifest.mjs
  - electron/utils/verseshell-runtime-bundle.ts
  - electron/utils/verseshell-runtime-request.ts
  - electron/gateway/config-sync.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/verseshell/**
  - openclaw_runtime/src/agents/verseshell-foundation-flags.ts
  - openclaw_runtime/src/agents/verseshell-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec*.ts
  - openclaw_runtime/src/config/runtime-feature-leaves.ts
  - openclaw_runtime/src/config/runtime-verseshell-foundation.test.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - shared/verseshell/**
  - tests/unit/verseshell-*.test.ts
  - docs/dev/verseshell-foundation/**
expectedUserBehavior:
  - VerseShell remains unavailable unless the verified-runtime, typed-ACI, facade, and governed-exec canary flags are all explicitly enabled.
  - An opted-in Agent exec call uses the pinned ae binary, strict agent policy, a workspace jail, and only the shell.exec capability.
  - OpenClaw command policy and approval run before VerseShell execution; VerseShell then uses only its action-bound one-time approval token for the approved retry.
  - Runtime, protocol, operation catalog, workspace, capability, and policy-profile drift fail closed without a native-shell retry.
  - Successful and failed commands return bounded semantic output, diagnostics, and result artifact recovery handles without dumping full logs.
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
acceptance:
  - The Electron bundle verifier passes the immutable VerseShell version, protocol, operation-catalog digest and count, and verified binary digest to the Gateway process.
  - A config-only canary request resolves and verifies the effective Gateway bundle before spawn; unsupported unrequested package targets remain unaffected.
  - The OpenClaw process manager accepts only a repository-defined immutable policy profile and computes its SHA-256 digest from a canonical definition.
  - The process manager rejects permissive policy, cap all, missing or unverified binary identity, arbitrary approval environment overrides, and handshake drift.
  - The model-facing client does not advertise nonexistent runtime.approval_grant or runtime.approval_revoke operations.
  - The exec host uses typed exec.run instead of legacy cmd/eval when governed execution is enabled.
  - OpenClaw approval analysis also applies to host=verseshell and no model-provided environment value can grant VerseShell approval.
  - An approved exec.run E_NEEDS_APPROVAL response is retried once in a token-isolated process, and that process is shut down after the action.
  - Governed execution never falls back to the native shell on outage, timeout, protocol mismatch, denial, or command failure.
  - Default-off and kill-switch behavior remains covered by tests.
  - A real pinned ae.exe probe covers strict handshake, denial without approval, approved retry, semantic reduction, and artifact recovery.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseshell-typed-aci-adaptation.md
  - pnpm harness validate --spec harness/specs/tasks/verseshell-typed-aci-adaptation.md
  - pnpm verseshell:test
  - pnpm exec vitest run verseshell- --reporter=verbose --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/STATUS.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

## Scope

This task adapts the already pinned VerseShell `c398369` runtime to the ClawX Agent execution path. It does not add a second MCP dependency, expose the full upstream operation catalog to the model, enable legacy eval, or make VerseShell the default exec host.

The governed route is an internal typed ACI adapter behind the existing OpenClaw `exec` tool. The existing workspace and command-policy owners remain authoritative; VerseShell adds an independent strict capability, workspace-jail, action-token, protocol, and output-budget boundary.

## Non-goals

- Default-on or joint-system GA claims.
- `AETHER_APPROVE_ALL` in production runtime processes.
- A model-facing approval grant/revoke API that upstream does not provide.
- Native-shell fallback from governed execution.
- Packaging unsupported non-Windows VerseShell binaries.
- Expanding the frozen legacy Node MCP operation map.
