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
  - docs/dev/recovery-contract/GA-READINESS-20261106.md
  - harness/specs/tasks/recovery-authority-gated.md
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/sdk-alias-20261119/**
  - openclaw_runtime/src/plugins/sdk-alias.ts
  - tests/unit/gateway-sdk-alias-dependencies.test.ts
  - openclaw_runtime/src/agents/date-time.ts
  - openclaw_runtime/src/agents/runtime-plugins.ts
  - tests/unit/gateway-agent-startup-scope.test.ts
  - openclaw_runtime/src/plugins/activation-context.ts
  - openclaw_runtime/src/plugins/providers.runtime.ts
  - openclaw_runtime/src/plugins/plugin-metadata-snapshot.types.ts
  - openclaw_runtime/patches/@openclaw__fs-safe@0.3.0.patch
  - openclaw_runtime/pnpm-workspace.yaml
  - openclaw_runtime/pnpm-lock.yaml
  - tests/unit/fs-safe-append-mode.test.ts
  - openclaw_runtime/src/infra/approval-handler-runtime.ts
  - openclaw_runtime/src/infra/pairing-token.ts
  - tests/unit/gateway-device-credential-invalidation.test.ts
  - openclaw_runtime/src/gateway/control-ui.ts
  - openclaw_runtime/src/infra/device-pairing.ts
  - tests/unit/gateway-device-pairing-state.test.ts
  - openclaw_runtime/src/entry.ts
  - openclaw_runtime/src/plugins/plugin-control-plane-context.ts
  - openclaw_runtime/src/plugins/gateway-startup-plugin-ids.ts
  - tests/unit/gateway-device-token-reuse.test.ts
  - tests/unit/gateway-process-launcher-trace.test.ts
  - tests/unit/gateway-process-launcher-env.test.ts
  - electron/gateway/**
  - electron/utils/**
  - openclaw_runtime/src/entry.ts
  - openclaw_runtime/src/gateway/**
  - openclaw_runtime/src/plugins/doctor-contract-registry.ts
  - openclaw_runtime/src/plugins/native-module-require.ts
  - openclaw_runtime/src/plugin-sdk/channel-entry-contract.ts
  - openclaw_runtime/extensions/telegram/src/message-cache*.ts
  - openclaw_runtime/extensions/telegram/src/thread-bindings*.ts
  - openclaw_runtime/extensions/telegram/src/state-migrations.ts
  - openclaw_runtime/extensions/matrix/doctor-contract-api.ts
  - openclaw_runtime/extensions/reach-readers/src/index.ts
  - openclaw_runtime/src/plugins/registry.ts
  - openclaw_runtime/src/plugins/runtime/runtime-plugin-boundary.ts
  - openclaw_runtime/src/plugins/plugin-registry-snapshot.ts
  - openclaw_runtime/src/plugins/plugin-registry-contributions.ts
  - openclaw_runtime/src/plugins/current-plugin-metadata-snapshot.ts
  - openclaw_runtime/src/plugins/current-plugin-metadata-state.ts
  - openclaw_runtime/src/agents/tools/image-tool.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/model.static-catalog.ts
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
requiredTests:
  - tests/unit/gateway-sdk-alias-dependencies.test.ts
  - tests/unit/gateway-host-time-format.test.ts
  - tests/unit/gateway-agent-startup-scope.test.ts
  - tests/unit/gateway-plugin-activation-discovery.test.ts
  - tests/unit/fs-safe-append-mode.test.ts
  - tests/unit/gateway-device-credential-invalidation.test.ts
  - tests/e2e/gateway-startup-performance.spec.ts
  - tests/unit/gateway-device-pairing-state.test.ts
  - tests/unit/gateway-plugin-startup-scope.test.ts
  - tests/unit/gateway-device-token-reuse.test.ts
  - tests/unit/gateway-process-launcher-env.test.ts
  - tests/unit/gateway-process-launcher-trace.test.ts
  - tests/unit/gateway-plugin-env-contract.test.ts
acceptance:
  - Compiled SDK alias resolution checks each shared dependency once per map. Missing dependencies and unreadable barrels retain source fallback or omit unavailable exports; availability remains scoped to the resolved package root.
  - Windows host time detection reads the OS short-time pattern without loading shell profiles. Explicit 12/24-hour settings and the existing Intl fallback remain available.
  - Agent startup borrows the compatible Gateway startup plugin scope through its metadata owner. Missing plans and mismatched workspaces retain standalone resolution; existing runtime-registry ownership controls reuse and subagent bindings.
  - Runtime plugin auto-enable borrows discovery and manifests from the provider's prepared metadata view. Requests without a prepared view retain the current/default snapshot scope checks and existing discovery path; explicit discovery stays authoritative.
  - Regular-file append retains descriptor identity, hardlink, size and permission checks while skipping an already matching mode for the same POSIX owner. Another effective owner retains the original chmod authorization. POSIX special bits and Windows read-only transitions retain their existing behavior; failed required permission updates stop writes.
  - Token revocation, rotation and device removal invalidate pending handshakes before registration. Cached-token connections cannot issue a replacement for a changed credential; authorized rotation and shared-secret bootstrap retain the existing issuance contract.
  - Paired-device authentication, Control UI token lookup, token rotation/revocation and access metadata updates read the approved device table independently of pending pairing requests. Approved scopes and corrupt paired-record failures retain their existing checks; cross-table pairing removal still validates the pending repair queue before mutation.
  - Configuration validation and Gateway startup use the same captured channel signals for the plugin scope cache key and for owner selection. Creating a new scope reads current config and environment signals.
  - Opt-in startup tracing forwards complete runtime phase lines from stdout while continuously draining ordinary output; authentication and readiness still use their original protocol signals.
  - Reconnects reuse a successfully authenticated device token only for the same paired device, endpoint and shared credential. A device-token mismatch falls back once to shared-secret bootstrap in the same attempt; temporary transport and startup failures retain the token. Bootstrap completes device-token authentication before readiness.
  - Managed Gateway processes use Node's temporary bytecode cache while preserving explicit cache and disable controls. The entrypoint flushes loaded bytecode after startup so a process kill retains compilation work; failed cache writes do not prevent recovery.
  - Current snapshot reuse checks roots, configured load paths, source overlays, Nix mode and effective host compatibility version even for a cached config identity or an omitted config. Capture/restore retains the original discovery binding and model normalization registration; the existing persisted-registry disable switch selects the derived path in both lookup entry points.
  - Runtime entry, static catalog and model alias lookups reuse the compatible current plugin snapshot after initial persisted-index repairs without repeating discovery or manifest reads; absent snapshots use the existing installed registry.
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
