---
lifecycleStatus: active
id: gateway-startup-performance
title: Reduce Gateway startup latency with measured evidence
scenario: gateway-backend-communication
taskType: runtime-bridge
residualPaths:
  # Concurrent repository reviewer-model policy synchronization.
  - AGENTS.md
intent: Measure the managed Gateway startup path and remove verified startup bottlenecks while preserving authentication, readiness, channels, and restart ownership.
expectedUserBehavior:
  - Gateway starts with the configured plugins and migrations intact and becomes usable after an authenticated RPC succeeds.
touchedAreas:
  - tests/unit/gateway-compaction-readiness.test.ts
  - tests/e2e/recovery-longsession-eval.spec.ts
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/compaction-readiness-20261123/**
  - openclaw_runtime/src/plugins/bundled-channel-runtime.ts
  - openclaw_runtime/src/channels/plugins/bundled.ts
  - tests/unit/gateway-bundled-channel-metadata.test.ts
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/bundled-metadata-20261123/**
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/native-alias-clear-20261122/**
  - openclaw_runtime/src/plugins/plugin-module-loader-cache.ts
  - scripts/gateway-plugin-loader-cache.test.mjs
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/loader-config-20261122/**
  - openclaw_runtime/src/plugins/sdk-alias.ts
  - openclaw_runtime/src/plugins/plugin-sdk-native-resolver.ts
  - scripts/gateway-workspace-alias.test.mjs
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/native-package-root-20261122/**
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/native-parent-scope-20261122/**
  - openclaw_runtime/src/gateway/trajectory-gateway.runtime.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.test.ts
  - package.json
  - harness/specs/guides/scoped-development-validation.md
  - openclaw_runtime/src/agents/harness/selection.ts
  - openclaw_runtime/src/agents/harness/selection.runtime.ts
  - openclaw_runtime/src/agents/harness/selection.compass.test.ts
  - tests/unit/gateway-lazy-harness-selection.test.ts
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/selection-loading-20261121/**
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/trajectory-loading-20261121/**
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/deferred-runtime-20261121/**
  - tests/unit/gateway-native-language-parser-loading.test.ts
  - openclaw_runtime/src/agents/harness/builtin-openclaw.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.runtime.ts
  - tests/unit/gateway-lazy-builtin-harness.test.ts
  - openclaw_runtime/src/context-engine/producers/analyzers/tree-sitter-base.ts
  - openclaw_runtime/src/context-engine/producers/analyzers/python-treesitter-analyzer.ts
  - openclaw_runtime/src/context-engine/producers/analyzers/go-treesitter-analyzer.ts
  - openclaw_runtime/src/context-engine/producers/analyzers/rust-treesitter-analyzer.ts
  - openclaw_runtime/src/context-engine/producers/analyzers/java-treesitter-analyzer.ts
  - tests/unit/gateway-lazy-language-parsers.test.ts
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/activation-provenance-20261120/**
  - harness/specs/rules/recovery-authority-owner-admission.md
  - openclaw_runtime/src/infra/runtime-compile-cache.ts
  - openclaw_runtime/src/agents/command/attempt-execution.runtime.ts
  - tests/unit/gateway-late-bytecode-cache.test.ts
  - openclaw_runtime/src/tasks/workflow-lifecycle-owner.ts
  - tests/unit/gateway-workflow-recovery-loading.test.ts
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/startup-discovery-20261119/**
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/readonly-discovery-20261119/**
  - openclaw_runtime/src/plugins/channel-presence-policy.ts
  - openclaw_runtime/src/channels/plugins/read-only.ts
  - tests/unit/gateway-readonly-prepared-discovery.test.ts
  - openclaw_runtime/src/channels/config-presence.ts
  - openclaw_runtime/src/plugins/plugin-lookup-table.ts
  - tests/unit/gateway-channel-presence-discovery.test.ts
  - tests/unit/gateway-startup-prepared-discovery.test.ts
  - docs/dev/recovery-contract/GA-READINESS-20261106.md
  - harness/specs/tasks/recovery-authority-gated.md
  - harness/specs/fixtures/recovery-contract-eval/ga-20261106/sdk-alias-20261119/**
  - openclaw_runtime/src/plugins/sdk-alias.ts
  - tests/unit/gateway-sdk-alias-dependencies.test.ts
  - openclaw_runtime/src/agents/date-time.ts
  - openclaw_runtime/src/agents/runtime-plugins.ts
  - tests/unit/gateway-agent-startup-scope.test.ts
  - tests/unit/gateway-agent-activation-provenance.test.ts
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
  - tests/unit/gateway-compaction-readiness.test.ts
  - openclaw_runtime/src/gateway/server-methods/sessions.compaction-range.handler.test.ts
  - tests/unit/gateway-bundled-channel-metadata.test.ts
  - scripts/gateway-plugin-loader-cache.test.mjs
  - scripts/gateway-workspace-alias.test.mjs
  - openclaw_runtime/src/gateway/trajectory-gateway.test.ts
  - openclaw_runtime/src/agents/harness/selection.compass.test.ts
  - tests/unit/gateway-lazy-harness-selection.test.ts
  - tests/unit/gateway-native-language-parser-loading.test.ts
  - tests/unit/gateway-lazy-builtin-harness.test.ts
  - tests/unit/gateway-lazy-language-parsers.test.ts
  - openclaw_runtime/src/context-engine/producers/analyzers/analyzers.test.ts
  - tests/unit/gateway-agent-activation-provenance.test.ts
  - tests/unit/gateway-late-bytecode-cache.test.ts
  - openclaw_runtime/src/agents/clawgraph/clawgraph-lifecycle-cutover.test.ts
  - openclaw_runtime/src/agents/mission-control/mission-lifecycle-cutover.test.ts
  - openclaw_runtime/src/agents/task-loop-lifecycle-cutover.test.ts
  - tests/unit/gateway-workflow-recovery-loading.test.ts
  - tests/unit/gateway-readonly-prepared-discovery.test.ts
  - tests/unit/gateway-startup-prepared-discovery.test.ts
  - tests/unit/gateway-channel-presence-discovery.test.ts
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
  - Global-session fork and parent hook ownership use the same captured configured agent as session-store lookup and admission; key-only fallback does not replace a configured default agent.
  - Compaction status and mutation guards share the existing session-operation busy predicate, including visible tracked runs, embedded runs and admission activity/fences for the same agent, canonical key and physical session generation. Idle status follows permit/fence release; other agents and generations retain independent readiness. Frozen live readbacks wait for readiness within the original 240-second turn budget and pin ranged compaction to the seeded generation.
  - Bundled channel enumeration and ID lookup share one metadata view in the existing root-owned load context. Plugin identities retain sorted enumeration and alias ownership, setup hints retain their fallback, and channel/plugin disablement is evaluated for each request. Failed reads remain retryable, empty results remain cached, and root switching or eviction uses the corresponding context. Registry refresh and Gateway teardown clear metadata, loaded entries and their loader caches through the existing lifecycle owner.
  - Clearing native plugin aliases copies and rewrites only entries containing a selected parent root. Unrelated owners retain their arrays and resolution order; selected owners are removed, empty aliases are deleted, and repeated cleanup leaves survivors untouched. CJS and ESM parent boundaries retain their existing resolution behavior.
  - Plugin loader cache entries use caller-supplied aliases directly. An omitted native mode uses the existing Node/Bun and built-dist policy; an omitted alias map retains cached default SDK configuration. Content keys, filename and explicit scope precedence, source-mode loader reuse, and native alias installation on cache hits retain their existing behavior. A tiny ESM projection links the production SDK import declaration to its real exported policy functions and detects missing imports and exports.
  - Native parent-scope selection reuses the loader root and nearest package root from one ancestor scan. Bundled plugins retain their normalized plugin boundary; external plugins retain their nearest package boundary even under a trusted OpenClaw ancestor. Module normalization stays before scanning, and subsequent calls read current metadata and symlink destinations.
  - Native loader package-root resolution probes each ancestor manifest once within its twelve-directory search. A trusted OpenClaw name or executable retains priority over the nearest ordinary package; missing, malformed and unreadable metadata retain the nearest observed package or module directory. Later calls read current metadata, and bundled and external parent scopes retain their existing boundaries.
  - Native CJS and ESM alias resolution normalizes each parent path once before testing registered roots. First-match ordering, missing-path lexical fallback, outside-root rejection and fresh symlink targets on subsequent calls retain their existing behavior; unknown aliases and absent parents skip filesystem normalization.
  - Workspace export alias enumeration reads the selected package manifest before resolving a fallback package root. Missing or invalid selected manifests retain fallback resolution; selected packaged-entry discovery, alias ordering and non-null JSON handling retain their existing behavior.
  - Importing trajectory subscription cleanup hooks leaves that module's session resolver deferred. readTrajectoryPage validates session and range inputs before loading its resolver; session and path guards, pagination, error identity and subscription delivery retain their current behavior.
  - Harness selection and support queries keep context-budget and lifecycle execution wrappers unloaded. An attempt captures the selected harness and diagnostic trace before loading those wrappers; native/plugin policy, parameter and error identity remain with the existing execution functions. The runtime boundary flushes available compilation before execution.
  - Built-in harness metadata does not load the embedded attempt runtime. First execution loads the existing runner through its runtime boundary, preserving parameters, results, errors and host capabilities. That boundary flushes loaded bytecode before execution; disabled, unavailable or unsupported cache APIs retain execution.
  - Analyzer metadata and fallback analysis leave native parsers and language grammars unloaded. Each native grammar loads when its analyzer first parses a file; a reusable parser is retained only after successful language initialization. Existing symbols, imports, calls and parse-fallback warnings retain their behavior.
  - Agent startup passes source activation reasons, manifests and install records from its compatible Gateway metadata scope to the existing runtime registry owner. Missing or incompatible scope retains standalone loading; runtime configuration and registry compatibility checks stay authoritative.
  - Workflow restart recovery checks the lifecycle owner's current writer and durable rows before loading each controller. Legacy and empty or terminal-only domains stay unloaded; Mission recovery remains taskflow-only for running rows. Live-controller, pending-effect and CAS decisions stay with the original recovery entry, and a domain failure does not suppress the other domains.
  - Read-only channel views share the selected metadata discovery with configuration and stored-auth probes. Config/workspace discovery retains the environment catalog fallback so load-path overlaps preserve bundled environment and authentication signals. Channel and plugin disablement, denial reasons and source roots retain their checks.
  - Gateway startup plans and lookup tables reuse discovery from a compatible prepared metadata snapshot for channel scope and final activation. Missing discovery and changed roots retain discovery fallback; explicit channel disables and stored-auth exclusion remain intact.
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
  - Managed Gateway processes use Node's temporary bytecode cache while preserving explicit cache and disable controls. Startup and the first lazy agent-attempt runtime load flush loaded bytecode before interruption; disabled or unavailable cache storage preserves execution. A real process kill and disk readback verify late runtime bytecode retention.
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
