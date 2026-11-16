---
lifecycleStatus: active
id: gateway-startup-performance
title: Reduce Gateway startup latency with measured evidence
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Measure the managed Gateway startup path and remove verified startup bottlenecks while preserving authentication, readiness, channels, and restart ownership.
expectedUserBehavior:
  - Gateway starts with the configured plugins and migrations intact and becomes usable after an authenticated RPC succeeds.
touchedAreas:
  - electron/gateway/**
  - electron/utils/**
  - openclaw_runtime/src/entry.ts
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/plugins/doctor-contract-registry.ts
  - openclaw_runtime/src/plugins/native-module-require.ts
  - openclaw_runtime/scripts/profile-extension-memory.mjs
  - tests/unit/gateway-doctor-contract-loading.test.ts
  - scripts/measure-gateway-startup.mjs
  - tests/unit/gateway-*.test.ts
  - tests/e2e/gateway-startup-performance.spec.ts
  - harness/specs/tasks/gateway-startup-performance.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/fixtures/gateway-startup-performance/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - repository-artifact-retention
acceptance:
  - Before and after measurements use the same built runtime, isolated state, and real Electron utility processes; the baseline explicitly reconstructs the prior contract loader, and raw phase timings are retained and agent driven.
  - Startup optimizations reduce measured latency without treating socket listening as authenticated RPC readiness.
  - Compiled plugin file URLs reach the native loader on Windows; encoded names and cache invalidation preserve filesystem identity, and source/dependency fallback policies remain intact.
  - Focused tests cover the optimization and its failure path; Electron coverage exercises a real Gateway with an authenticated RPC and clean shutdown.
  - Source overlays and external plugin roots remain authoritative; the benchmark uses loopback-only binding, per-attempt random credentials, and observed loader invocations despite inherited bypass flags.
  - Communication replay, comparison, relevant type checks, and Harness validation pass, or exact residual failures are recorded.
docs:
  required: true
---

Measure process spawn, protocol challenge, authenticated connection and first successful RPC separately. Preserve configured channels and all product locks. Local isolated timing does not claim packaged, cross-platform, or user-profile startup performance.

The default measurement gives each attempt a fresh transform cache and retains partial reports
after every completed attempt. Keep shared-cache results separate; a cold-cache improvement does
not establish a hot-start improvement. Preserve the normal desktop start timeout and device-token
handshake in Electron coverage.
The desktop check uses the existing workspace-authorized `health` RPC; the isolated utility
process benchmark probes `system-presence` directly. Neither path changes workspace permissions.
