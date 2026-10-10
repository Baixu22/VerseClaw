---
lifecycleStatus: archived
id: rc01r-green-baseline
title: RC-01R Green Baseline Remediation
taskType: engineering-acceptance
diffBase: ec36d1b6dca9e403e4a58319e08617584d6c6637
intent: Establish a clean, self-contained RC-01R prerequisite commit by removing the known ChatInput lint/typecheck errors, making the RC-01 authority baseline tracked and deterministic from an explicit accepted base, and making the nested OpenClaw production-core typecheck pass without changing runtime or product behavior.
ownedPaths:
  - .gitattributes
  - .gitignore
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - scripts/rc01-authority-inventory.mjs
  - scripts/rc01-baseline-validate.mjs
  - src/pages/Chat/ChatInput.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-question-directory.test.tsx
  - tests/unit/rc01-authority-inventory-baseline.test.ts
  - tests/unit/startup-loading-experience.test.tsx
  - tests/unit/title-bar.test.tsx
  - tests/unit/provider-model-sync.test.ts
  - harness/specs/tasks/rc01r-green-baseline.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
  - openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/context-engine/cvk/codebase-index.ts
  - openclaw_runtime/src/context-engine/cvk/compiler.ts
  - openclaw_runtime/src/context-engine/cvk/recovery.ts
  - openclaw_runtime/src/context-engine/cvk/resolver.ts
  - openclaw_runtime/src/context-engine/cvk/shadow-provider.ts
  - openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts
  - openclaw_runtime/src/context-engine/cvk/views.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.ts
  - openclaw_runtime/src/context-engine/dcs-graduation-decision.ts
  - openclaw_runtime/src/context-engine/registry/context-item-registry.ts
  - openclaw_runtime/src/context-engine/registry/context-item-store.ts
  - openclaw_runtime/src/context-engine/symbol-context-provider.ts
  - openclaw_runtime/src/context-engine/trace-context-provider.ts
  - openclaw_runtime/src/plugins/cli-registry-loader.ts
  - openclaw_runtime/src/runtime-core/memory-bridge-discovery.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/tsconfig.core.json
  - openclaw_runtime/ui/src/ui/tool-display.ts
  - openclaw_runtime/ui/src/ui/views/usage-render-details.ts
  - shared/package.json
  - shared/product-semantics.ts
  - shared/remote-forge/error-envelope.ts
  - shared/remote-forge/unified-diff-adapter.ts
  - shared/types/context-family.ts
  - shared/types/context-item.ts
  - shared/types/work-mode.ts
  - shared/types/work-provider.ts
  - shared/types/workspace.ts
  - shared/verseshell/errors.ts
  - shared/verseshell/validation.ts
touchedAreas:
  - .gitattributes
  - .gitignore
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - scripts/rc01-authority-inventory.mjs
  - scripts/rc01-baseline-validate.mjs
  - src/pages/Chat/ChatInput.tsx
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-question-directory.test.tsx
  - tests/unit/rc01-authority-inventory-baseline.test.ts
  - tests/unit/startup-loading-experience.test.tsx
  - tests/unit/title-bar.test.tsx
  - tests/unit/provider-model-sync.test.ts
  - harness/specs/tasks/rc01r-green-baseline.md
  - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
  - openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts
  - openclaw_runtime/src/context-engine/agent-map-context-provider.ts
  - openclaw_runtime/src/context-engine/cvk/codebase-index.ts
  - openclaw_runtime/src/context-engine/cvk/compiler.ts
  - openclaw_runtime/src/context-engine/cvk/recovery.ts
  - openclaw_runtime/src/context-engine/cvk/resolver.ts
  - openclaw_runtime/src/context-engine/cvk/shadow-provider.ts
  - openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts
  - openclaw_runtime/src/context-engine/cvk/views.ts
  - openclaw_runtime/src/context-engine/dcs-canary-c1.ts
  - openclaw_runtime/src/context-engine/dcs-graduation-decision.ts
  - openclaw_runtime/src/context-engine/registry/context-item-registry.ts
  - openclaw_runtime/src/context-engine/registry/context-item-store.ts
  - openclaw_runtime/src/context-engine/symbol-context-provider.ts
  - openclaw_runtime/src/context-engine/trace-context-provider.ts
  - openclaw_runtime/src/plugins/cli-registry-loader.ts
  - openclaw_runtime/src/runtime-core/memory-bridge-discovery.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/tsconfig.core.json
  - openclaw_runtime/ui/src/ui/tool-display.ts
  - openclaw_runtime/ui/src/ui/views/usage-render-details.ts
  - shared/package.json
  - shared/product-semantics.ts
  - shared/remote-forge/error-envelope.ts
  - shared/remote-forge/unified-diff-adapter.ts
  - shared/types/context-family.ts
  - shared/types/context-item.ts
  - shared/types/work-mode.ts
  - shared/types/work-provider.ts
  - shared/types/workspace.ts
  - shared/verseshell/errors.ts
  - shared/verseshell/validation.ts
expectedUserBehavior:
  - Chat behavior and all product locks remain unchanged; the four unused icon imports no longer make the root lint/typecheck gates fail.
  - Test doubles and static component contracts track current committed interfaces, route shells, and design tokens without changing product behavior.
  - The RC-01 authority baseline is a tracked candidate input, records an explicit accepted base that is an ancestor of the candidate, and can be regenerated byte-for-byte from that base.
  - Root lint:check exits 0 with 0 errors and the fixed 120-warning baseline; root typecheck and nested openclaw_runtime tsgo:core both exit 0 after frozen/offline installs.
  - The nested core typecheck covers production sources. Explicit test-only SDK and E2E harness entry points remain excluded rather than being silently waived through broad production-path exclusions.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - observable runtime, renderer, Main-process, Gateway, provider, channel, approval, effect, memory, context, telemetry, feature-flag, authority, or product-lock behavior changes; only behavior-preserving typing, import-resolution, and test-surface-boundary corrections required by this package are permitted
  - copying uncommitted ChatInput.tsx changes from another worktree
  - an untracked, timestamp-varying, or implicit-HEAD RC-01 baseline artifact
  - treating the nested openclaw_runtime tsgo:core check as historical, optional, or waived
  - broad exclusion of production runtime paths to make tsgo:core pass
featureFlags:
  - No feature flag is added or changed.
rollback:
  - Revert this isolated prerequisite commit; no runtime data, schema, configuration, or product behavior requires rollback.
requiredTests:
  - pnpm install --offline --frozen-lockfile --ignore-scripts
  - pnpm --dir openclaw_runtime install --offline --frozen-lockfile --ignore-scripts
  - pnpm --dir openclaw_runtime tsgo:core
  - node scripts/rc01-authority-inventory.mjs --accepted-base 73bdddbb1dcf250783afb5da1174a43cf8d90535
  - node scripts/rc01-baseline-validate.mjs
  - pnpm exec vitest run tests/unit/rc01-authority-inventory-baseline.test.ts
  - pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/chat-question-directory.test.tsx tests/unit/startup-loading-experience.test.tsx tests/unit/title-bar.test.tsx
  - pnpm test
  - pnpm run lint:check
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm harness validate --spec harness/specs/tasks/rc01r-green-baseline.md
acceptance:
  - The checked-in baseline.json has schema runtime-authority-convergence-baseline/v1, a valid acceptedBaseSha that is an ancestor of the candidate, source/npm runtime versions, complete writer inventory, and receipt-owner proof.
  - The baseline is returned by git ls-files, every declared owner path exists in the candidate, and a clean clone can parse and validate it.
  - Regenerating with the same explicit accepted base leaves baseline.json byte-identical and produces no unstaged diff.
  - Removed production modules have no orphaned unit tests, and the updated test doubles assert the current committed UI contracts.
  - pnpm test and pnpm run build:vite exit 0 after the acceptance preflight provisions only manifest-verified ignored resources into the clean worktree.
  - pnpm run lint:check exits 0 with 0 errors and no more than the fixed 120-warning baseline; pnpm run typecheck and pnpm --dir openclaw_runtime tsgo:core exit 0 after frozen/offline root and nested Runtime installs.
  - Scoped Harness validation runs with its configured diffBase and without --no-diff.
  - Product locks remain liveReady=false, productApproved=false, and defaultOn=false.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/runtime-convergence/AGENT-START.md
---

# RC-01R Green Baseline Remediation

This prerequisite package owns only the clean engineering baseline needed before RC-00R is
rerun. It removes the known root-gate import debt and makes the existing RC-01 inventory artifact
reproducible and tracked. It does not accept RC-01, run RC-00R, change Task Forest state, or alter
runtime behavior.

Both `pnpm run typecheck` and `pnpm --dir openclaw_runtime tsgo:core` are required gates for
this package. The latter validates the nested Runtime production core; test-only SDK and E2E
harness entry points may be explicitly excluded, but no production runtime area is waived.
