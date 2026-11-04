---
lifecycleStatus: active
id: verse-tools-boundary-repair
title: Repair Verse tool authorization and current-evidence boundaries
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close the reproduced browser authorization gaps and make Verse evidence verification match the tested candidate without changing product defaults.
expectedUserBehavior:
  - Legitimate agents can use their own browser sessions, while missing owners, conflicting owners and caller-authored approval claims are rejected.
  - Browser redirects and page subresources cannot reach private origins without a current host-owned session grant.
  - Capability discovery does not advertise executable actions from an empty host snapshot.
  - Verse acceptance reports distinguish current verified candidates from historical evidence and stale source.
touchedAreas:
  - electron/gateway/agent-browser-bridge.ts
  - electron/services/agent-browser-api.ts
  - electron/services/agent-browser-network-proxy.ts
  - shared/agent-browser/private-network-policy.ts
  - packages/versebrowser/src/engine/service.ts
  - packages/versebrowser/src/engine/browser-control/tab-manager.ts
  - packages/versebrowser/tests/agent-browser-service.test.ts
  - packages/versebrowser/tests/agent-browser-tab-manager.test.ts
  - packages/versebrowser/tests/r0-4-agent-browser-nav-timeout.test.ts
  - packages/versebrowser/integration-patches.json
  - packages/versebrowser/patches/vb-engine-policy__src__engine__service.ts.patch
  - packages/versebrowser/patches/host-owned-tab-lifecycle.patch
  - openclaw_runtime/src/agents/tools/agent-browser-tool.ts
  - openclaw_runtime/src/agents/tools/agent-browser-tool.provenance.test.ts
  - scripts/versebrowser-host-integration-verify.mjs
  - scripts/versebrowser-host-integration-verify.d.mts
  - scripts/versebrowser-evidence-verify.mjs
  - scripts/versebrowser-evidence-verify.d.mts
  - scripts/versebrowser-m10-packaged-flow-verify.mjs
  - scripts/versebrowser-n9-stability-probe.mjs
  - scripts/versebrowser-n9-stability-probe.test.mjs
  - scripts/lib/versebrowser-build-identity.mjs
  - scripts/lib/versebrowser-probe-cleanup.mjs
  - scripts/verify-versegit-product-integration.mjs
  - scripts/verify-versegit-product-integration.d.mts
  - scripts/rsi-sekb-arms.d.mts
  - tests/unit/agent-browser-gateway-bridge.test.ts
  - tests/unit/versebrowser-*.test.ts
  - tests/unit/browser-private-network-tf0503.test.ts
  - tests/unit/versegit-product-acceptance.test.ts
  - tests/e2e/versebrowser-host-invocation.spec.ts
  - harness/specs/tasks/verse-tools-boundary-repair.md
  - harness/specs/tasks/versebrowser-invocation-maturity.md
  - harness/specs/tasks/versegit-product-f5-global-acceptance.md
  - harness/specs/fixtures/verse-tools-boundary-repair/**
  - harness/specs/fixtures/versebrowser-invocation-maturity/current-20261104/**
  - harness/specs/fixtures/versegit-product-integration/f5-current-20261104/**
  - docs/modules/verse-tools.md
  - docs/dev/versegit-validation-layer/README.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - versebrowser-upstream-preservation
  - versegit-validation-layer-extension-boundary
  - verseshell-foundation-p0-boundary
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node --test scripts/versebrowser-n9-stability-probe.test.mjs
  - pnpm exec vitest run tests/unit/agent-browser-gateway-bridge.test.ts tests/unit/versebrowser-capability-gating.test.ts tests/unit/versebrowser-n6-authorization-conservation.test.ts tests/unit/versebrowser-host-adapter.test.ts tests/unit/versebrowser-boundary-repair.test.ts tests/unit/versebrowser-evidence-verification.test.ts tests/unit/browser-private-network-tf0503.test.ts tests/unit/versegit-product-acceptance.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/agent-browser-tool.provenance.test.ts --maxWorkers=1
  - pnpm --filter @verse-claw/versebrowser exec vitest run tests/agent-browser-service.test.ts tests/agent-browser-tab-manager.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/versebrowser-host-invocation.spec.ts --workers=1
  - node scripts/versebrowser-m10-packaged-flow-verify.mjs
  - node scripts/versebrowser-n9-stability-probe.mjs
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/versebrowser-host-integration-verify.mjs
  - node scripts/versebrowser-evidence-verify.mjs
  - node scripts/verify-versegit-product-integration.mjs
  - pnpm harness validate --spec harness/specs/tasks/verse-tools-boundary-repair.md
acceptance:
  - Main rejects undeclared browser actions and caller-supplied approval or mode upgrades before effects.
  - Session effects require an owner; conflicting payload owners cannot replace runtime correlation, and unbound discovery exposes no sessions.
  - Every desktop managed session applies the existing host private-network policy to requests and redirects, including DNS resolution; grants stay session/origin/time bound.
  - Host-owned session/tab termination cannot be vetoed by page beforeunload, and denied initial tab navigation leaves no live unregistered window.
  - Empty or unknown authoritative capabilities never widen the executable vocabulary; status remains available for discovery.
  - The pinned upstream input is used for patch verification; current evidence detects tracked, dirty and untracked source drift and is generated by the actual required runs.
  - Documentation checks use the current module/README contract and do not mistake a denial of GA for a GA claim. Historical evidence is retained as historical.
  - VS default-off and VG M4 disabled remain unchanged; all interaction and verdict evidence is agent-driven.
docs:
  required: true
  files:
    - docs/modules/verse-tools.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This repair is scoped to the five reproduced findings in the 2026-11-04 Verse
tools audit. It adds regression coverage at the existing owners, without a new
executor, authorization service, browser driver or task authority.

The original acceptance reports remain attributed to their original candidates.
New results bind the current source and actual command outputs. A manifest update
alone must never be used to manufacture a current runtime or packaged pass.

On Windows, N8/N9 accept `--temp-root` for an existing writable test location
on D:. Each N9 invocation owns a unique batch directory and only reclaims its
own round directories and processes. A failed process census is not evidence of
zero residual processes. Renderer readiness includes the complete load event before
the probe can close the application; teardown remains bounded.
User data, home/app-data and OpenClaw config paths are isolated per round, so a
packaged probe does not acquire locks in the owner's real runtime directory.
N9 writes incomplete per-round results during execution so an interrupted or
failed batch remains diagnosable and cannot be mistaken for a final pass.
Process sampling queries candidate processes by the random run suffix, then
matches the complete owned path; it does not serialize the entire host inventory.
Unicode command lines are preserved. A query error or timeout still fails the run and
cannot bypass cleanup or discard the affected round. Playwright controls its
own ephemeral debugging port; its artifacts remain under the owned run root.

The required full typecheck also repairs a pre-existing declaration omission:
`buildArmsReport` already returns `promotion` at runtime, but its declaration did
not expose it to the existing tests. Only the declaration is synchronized; RSI
behavior, evidence and product defaults are unchanged.
