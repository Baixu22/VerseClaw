---
id: task-forest-active-node-engineering-closeout
title: Integrated engineering closeout for the active Task Forest batch
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: 5dabc7ca5e86d2c08e5236e175323ebe4b4db804
intent: Complete TF-0029 engineering verification for the explicitly requested active-node batch using its real initial checkout as the comparison base, preserving the historical RC-01R prerequisite identity and the separate approved runtime acceptedBase while enforcing the original 120-warning ceiling and independent full verification.
# TF-0029 bounded scope (per docs/dev/engineering-product-node-plan-20260921.md §4):
# this node owns writer inventory, receipt owner, type/lint/unit, build, core
# runtime smoke, and comms. The full UI e2e regression suite and release
# packaging/provenance validation are separately owned by TF-0041's final
# engineering acceptance and are deferred here (recorded, not deleted).
deferredProfiles:
  e2e: "TF-0041 :: Full Electron UI regression suite is owned by TF-0041 final engineering acceptance / release freeze; TF-0029 verifies only the bounded baseline + core smoke."
  release: "TF-0041 :: Release baseline packaging/provenance validation is owned by TF-0041 release freeze, not the TF-0029 self-contained baseline."
touchedAreas:
  - .github/workflows/check.yml
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - docs/clawx-design-overview.md
  - docs/dev/agent-engineering-acceptance.md
  - docs/dev/context-moat/reviews/TF-0134-M4-closeout-20260913.md
  - docs/dev/context-moat/reviews/TF-0135-2026Q3-competitive-review.md
  - docs/dev/handoffs/LATEST.md
  - docs/dev/runtime-lifecycle-governance/README.zh-CN.md
  - docs/dev/task-forest-engineering-20260913.md
  - docs/generated/catalogs/prod-flags.md
  - docs/generated/catalogs/tools.md
  - harness/specs/layers/harness.md
  - harness/specs/rules/agent-engineering-acceptance-boundary.md
  - harness/specs/rules/renderer-main-boundary.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/tasks/agent-dev-ecosystem-regularization.md
  - harness/specs/tasks/agent-engineering-acceptance-orchestrator.md
  - harness/specs/tasks/fakecoding-secondary-surface-convergence.md
  - harness/specs/tasks/fakecoding-ui-convergence.md
  - harness/specs/tasks/fakecoding-workspace-convergence.md
  - harness/specs/tasks/harness-scenario-baseline-validation.md
  - harness/specs/tasks/knowledge-hub-information-density.md
  - harness/specs/tasks/runtime-lifecycle-governance.md
  - harness/specs/tasks/task-forest-active-node-engineering-closeout.md
  - harness/specs/tasks/token-dense-recovery-compression-v1.md
  - harness/specs/tasks/windows-ui-v2-apple-motion.md
  - harness/src/cli.mjs
  - harness/src/git.mjs
  - package.json
  - pnpm-lock.yaml
  - reports/context-compression/TF0074-ACCEPTANCE-2026-09-13.md
  - resources/openclaw-plugins/clawx-openai-image/index.d.mts
  - scripts/agent-dev-deep-test.mjs
  - scripts/agent-engineering-acceptance.d.mts
  - scripts/agent-engineering-acceptance.mjs
  - scripts/context-compression-eval-runner.d.mts
  - scripts/context-compression-eval-runner.mjs
  - scripts/context-compression-recovery-ledger.mjs
  - scripts/lib/agent-engineering-acceptance.d.mts
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/rc01r-prerequisite-provenance.mjs
  - scripts/rc01r-prerequisite-provenance.d.mts
  - scripts/rc00-acceptance-bootstrap.mjs
  - shared/i18n/locales/en/knowledge.json
  - shared/i18n/locales/ja/knowledge.json
  - shared/i18n/locales/ru/knowledge.json
  - shared/i18n/locales/zh/knowledge.json
  - src/App.tsx
  - src/components/layout/MainLayout.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/ui-overlay-context.tsx
  - src/components/settings/ProvidersSettings.tsx
  - src/lib/knowledge-review-items.ts
  - src/lib/ui-version.ts
  - src/lib/workspace-session.ts
  - src/pages/Agents/index.tsx
  - src/pages/Channels/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/KnowledgeChat.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Knowledge/KnowledgeAssistant.tsx
  - src/pages/Knowledge/KnowledgeReviewQueue.tsx
  - src/pages/Knowledge/index.tsx
  - src/pages/Knowledge/knowledge-view-utils.ts
  - src/pages/Models/index.tsx
  - src/pages/Observability/index.tsx
  - src/pages/Setup/ProviderModelSteps.tsx
  - src/pages/Setup/index.tsx
  - src/pages/Skills/index.tsx
  - tests/e2e/agent-browser-workbench.spec.ts
  - tests/e2e/beam-composer-verify.spec.ts
  - tests/e2e/channels-binding-regression.spec.ts
  - tests/e2e/chat-session-fork.spec.ts
  - tests/e2e/clawgraph.spec.ts
  - tests/e2e/code-review-center.spec.ts
  - tests/e2e/dcs-prod-p0-settings.spec.ts
  - tests/e2e/fakecoding-scheduled-browser-runs.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/knowledge-review-queue.spec.ts
  - tests/e2e/knowledge-ux-cdp.spec.ts
  - tests/e2e/main-navigation.spec.ts
  - tests/e2e/observability-quick-locate.spec.ts
  - tests/e2e/orb-visual-verify.spec.ts
  - tests/e2e/remote-forge-controlled-preview.spec.ts
  - tests/e2e/secondary-surfaces-convergence.spec.ts
  - tests/e2e/settings-memory-embedding.spec.ts
  - tests/e2e/settings-proxy.spec.ts
  - tests/e2e/setup-first-run-fp-p1-01.spec.ts
  - tests/e2e/task-ledger.spec.ts
  - tests/e2e/token-usage.spec.ts
  - tests/e2e/windows-ui-v2.spec.ts
  - tests/e2e/workspace-convergence-layout.spec.ts
  - tests/integration/loop-stability-check.test.ts
  - tests/integration/p1-orchestration-boundary.integration.test.ts
  - tests/unit/agent-browser-full-access-tool-executor.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/agent-engineering-acceptance.test.ts
  - tests/unit/artifact-completion-class-lint.test.ts
  - tests/unit/automation-playbook-selector-tool.test.ts
  - tests/unit/chat-api-workspace-fingerprint.test.ts
  - tests/unit/chat-capability-actions.test.ts
  - tests/unit/chat-history-actions.test.ts
  - tests/unit/chat-startup-hydration.test.ts
  - tests/unit/chat-store-history-retry.test.ts
  - tests/unit/clawx-openai-image-plugin.test.ts
  - tests/unit/comms-scripts.test.ts
  - tests/unit/context-compression-eval.test.ts
  - tests/unit/context-compression-provider.test.ts
  - tests/unit/context-provider-registry.test.ts
  - tests/unit/context-runtime-kit-shadow-provider.test.ts
  - tests/unit/dcs-ops-canary-hard-veto.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/gateway-manager-reload-policy-refresh.test.ts
  - tests/unit/gateway-rpc-backpressure.test.ts
  - tests/unit/harness-git.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/helpers/query-classifier.ts
  - tests/unit/helpers/runtime-effectiveness-eval.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-invoke.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/knowledge-chat.test.tsx
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-review-items.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/observability-trajectory-supply.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/providers-api.test.ts
  - tests/unit/r0-2-cron-repair-degraded.test.ts
  - tests/unit/r0-3-chat-abort-checkstuck.test.ts
  - tests/unit/r0-3-terminal-session-reclaim.test.ts
  - tests/unit/rc01-authority-inventory-baseline.test.ts
  - tests/unit/rc01r-prerequisite-provenance.test.ts
  - tests/unit/rc08b-otel-observability-convergence.test.ts
  - tests/unit/remote-forge-api.test.ts
  - tests/unit/resource-tracker.test.ts
  - tests/unit/role-input-mode-chat.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/runtime-agent-map-context-provider.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-runtime-shadow-replay.test.ts
  - tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts
  - tests/unit/runtime-lifecycle-governance.test.ts
  - tests/unit/runtime-memory-architecture-diagnostic.test.ts
  - tests/unit/runtime-memory-cross-component-consistency.test.ts
  - tests/unit/runtime-memory-embedding-integration.test.ts
  - tests/unit/runtime-memory-end-to-end.test.ts
  - tests/unit/runtime-memory-interleaved-read-write.test.ts
  - tests/unit/runtime-memory-mvp-deep-test.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts
  - tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
  - tests/unit/runtime-memory-relations.test.ts
  - tests/unit/runtime-memory-retention-llm-judge.test.ts
  - tests/unit/runtime-provider-tool-registry-real-producer-diagnostic-consumer-validation.test.ts
  - tests/unit/runtime-provider-tool-registry-security-performance-boundary.test.ts
  - tests/unit/runtime-provider-tool-registry.test.ts
  - tests/unit/runtime-symbol-context-provider.test.ts
  - tests/unit/sandbox-high-risk-gate-p2-004.test.ts
  - tests/unit/setup-provider-lifecycle.test.tsx
  - tests/unit/skill-packs-api.test.ts
  - tests/unit/system-maturity-quarterly-audit-p7-004.test.ts
  - tests/unit/system-maturity-residual-p8-001.test.ts
  - tests/unit/system-maturity-traceability-p7-001.test.ts
  - tests/unit/ui-version.test.ts
  - tests/unit/uas-05-verseshell-process-lifecycle.test.ts
  - tests/unit/use-session-status-failure-states.test.tsx
  - tests/unit/windows-signing-policy-p6-001.test.ts
  - tests/unit/workspace-session.test.ts
  - tests/unit/workspaces-api.test.ts
  - tsconfig.node.json
  - tsconfig.test.json
  - tsconfig.web.json
  - vitest.config.ts
  - .agent-workbench/task-forest/**
  - tests/e2e/channels-account-id-validation.spec.ts
  - tests/e2e/channels-health-diagnostics.spec.ts
  - openclaw_runtime/src/gateway/server-startup-post-attach.defer.test.ts
  - openclaw_runtime/src/agents/bash-tools.characterization.test.ts
  - openclaw_runtime/src/knowledge/sekb/terminal-trajectory-gating.test.ts
  - openclaw_runtime/scripts/check-duplicates.mjs
  - openclaw_runtime/scripts/check.mjs
  - openclaw_runtime/src/infra/source-doctor.test.ts
  - openclaw_runtime/src/infra/source-doctor.ts
expectedUserBehavior:
  - The integrated candidate includes only the declared batch changes and keeps the original unrelated working-tree edits separate.
  - Historical prerequisite c860c12f4ab88bca9bd46742facbc97e98bb9d60 remains identified against 3b08a46667e9b961ff9eafda12da0a18848832c5; the integrated comparison base does not re-sign that prerequisite or change the approved acceptedBase 73bdddbb1dcf250783afb5da1174a43cf8d90535.
  - Test type cleanup removes unsafe any annotations using existing contracts and typed mocks without disabling lint rules or reducing test assertions.
  - Every real test gate declares and verifies parsed counts and a fixed skip budget, summing every Tests summary segment instead of taking the largest single count.
  - A manifest cannot change its candidate-derived task requirements, command line, gate set, execution directory, or ignored resource bytes by merely recomputing its digest.
  - Ordinary gates execute inside the disposable detached worktree, with preserved evidence and no unexpected source mutation.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - agent-engineering-acceptance-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - i18n-locale-coverage
  - docs-sync
humanEvidence: not-required
requiredTests:
  - node scripts/rc01r-prerequisite-provenance.mjs
  - node scripts/rc01-baseline-validate.mjs
  - pnpm run typecheck:test
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts tests/unit/rc01r-prerequisite-provenance.test.ts
  - pnpm run harness:ci
acceptance:
  - Root lint:check enforces zero errors and at most 120 warnings; no lint disable, exclusions, assertions removal, or widened runtime type exclusions are used to obtain the green result.
  - Root node/web/test and nested production-core typechecks pass with frozen dependency inputs.
  - Complete root unit counts include every subprocess. The root skip budget is the sum of the identity inventory in scripts/lib/agent-engineering-acceptance.mjs (50: 49 DEEPSEEK_API_KEY-gated tests across 15 files plus 1 AGENCY_AGENTS_REPO-gated test), enumerated by the vitest JSON reporter on both the candidate and its diffBase. The historical frozen 53 was read on a process without file-symlink privilege, where skills-symlink-cleanup.test.ts skips 3 more tests; on the acceptance host those 3 tests execute and pass. A reading above the inventory means a capability-gated test was skipped and must be fixed in the environment; silently raising the budget is forbidden.
  - Required test commands cannot omit parsed-count and skip expectations; non-test required checks remain distinguishable from test runners.
  - Manifest requirements and gate contracts are re-derived from the candidate-bound spec/rule/profile/lock inputs; forbidden arguments are rejected in executable command lines as well as argv.
  - Removing or reordering a mandatory gate, changing its command/timeout/skip budget, hiding comparison paths, or omitting profile/lock inputs remains NO-GO after rehashing. Abbreviated bootstrap fixtures cannot qualify as acceptance.
  - The comparison base must match the candidate spec diffBase; changing it to an empty diff cannot reduce the required coverage.
  - Vitest failure-only and skip-only segments, Playwright summaries, and Node spec/TAP summaries retain every outcome; inconsistent declared totals fail closed.
  - Test-runner stdout and stderr are reparsed during report validation; hiding skips, failures, or missing summaries remains NO-GO after rehashing all evidence. The TF-0009 adapter instead requires a validated controlled JSON artifact whose runs match its reported counts.
  - Lint/diff commands that name test files are not classified as test execution; package-manager test commands retain count enforcement with directory, filter, and workspace options.
  - CI root tests fetch complete Git history for the live provenance check; prerequisite identities and ancestry are not mocked or weakened.
  - Test typing resolves internal Runtime packages through their checked-in sources and preserves the image plugin default export without relying on local declaration build artifacts.
  - Each copied ignored resource is locked by target path, byte size and SHA-256, and verified before and after copying for Executor and Verifier.
  - Receipt-owner durability, atomicity, retention, privacy and restart proofs are reproduced, including the embedded runner acceptance cases.
  - Independent verification recreates the full declared manifest in a second detached worktree and records every mandatory command, source identity, count, log digest and residual.
  - TF-0140, runtime-family freeze, all product/default-on/live locks and every human acceptance requirement remain unchanged.
docs:
  required: true
  files:
    - docs/dev/agent-engineering-acceptance.md
    - docs/dev/repository-artifact-retention.md
    - docs/dev/Sustained-Development-Playbook.md
---

This is the engineering closeout for the user's active-node batch, owned by TF-0029. It is not a replacement task registry, a new product acceptance baseline, or a re-signature of the earlier RC-01R SHA. TF-0007, TF-0010, TF-0028, TF-0056 and TF-0102 keep their separate human/external completion conditions. TF-0140 is explicitly skipped.

The warning-file list is concrete and based on the current ESLint inventory. Prune any untouched planned paths before the final candidate is accepted. A changing candidate requires a new manifest and independent verification; old green logs cannot be relabelled to it.
