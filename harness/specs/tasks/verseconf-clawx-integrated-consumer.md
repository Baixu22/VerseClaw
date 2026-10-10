---
lifecycleStatus: archived
id: verseconf-clawx-integrated-consumer
title: VerseConf structured artifact consumer through the ClawX runtime
scenario: gateway-backend-communication
taskType: runtime-bridge
docs:
  required: false
intent: Deliver a bounded, agent-driven research-table and slide-outline consumer using the existing runtime write owner, journal, permissions, cancellation, and artifact history contracts.
ownedPaths:
  - harness/specs/tasks/verseconf-clawx-integrated-consumer.md
  - openclaw_runtime/src/plugin-sdk/structured-artifacts.ts
  - openclaw_runtime/src/plugin-sdk/core.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/gateway/tool-resolution.ts
  - openclaw_runtime/extensions/verseconf-artifacts/src/tools.ts
  - openclaw_runtime/extensions/verseconf-artifacts/src/engine.ts
  - scripts/build-openclaw-runtime.mjs
  - scripts/bundle-openclaw-runtime.mjs
  - scripts/openclaw-bundle-config.mjs
  - scripts/openclaw-bundle-config.d.mts
  - scripts/after-pack.cjs
  - scripts/sync-verseconf.mjs
  - openclaw_runtime/scripts/tsdown-build.mjs
  - openclaw_runtime/scripts/lib/static-extension-assets.mjs
  - tests/unit/sync-verseconf.test.ts
  - tests/unit/after-pack-cleanup.test.ts
  - tests/unit/context-engine-registry-default-on.test.ts
  - tests/unit/fakecoding-design-system.test.ts
  - tests/unit/first-product-claims.test.ts
  - scripts/scan-first-product-claims.mjs
  - openclaw_runtime/extensions/memory-wiki/src/apply.ts
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - scripts/installer.nsh
  - .gitignore
  - .gitattributes
  - eslint.config.mjs
  - openclaw_runtime/extensions/verseconf-artifacts/**
  - scripts/verify-verseconf-clawx-integration.mjs
  - tests/e2e/chat-artifact-panel.spec.ts
  - tests/e2e/knowledge-review-queue.spec.ts
  - tests/e2e/coding-loop-fp-p1-04.spec.ts
  - playwright.config.ts
  - artifacts/verseconf-clawx-integration/**
  - openclaw_runtime/packages/plugin-sdk/package.json
  - openclaw_runtime/packages/plugin-sdk/src/structured-artifacts.ts
  - openclaw_runtime/pnpm-lock.yaml
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/ArtifactView.tsx
  - src/pages/Chat/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - docs/dev/verseconf-clawx-implementation-20261001.md
  - docs/dev/verseconf-live-chain-plan-20261004.md
  - scripts/verseconf-live-chain.mjs
  - package.json
residualPaths:
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - openclaw_runtime/src/agents/tools/context-agent-tools.test.ts
  - openclaw_runtime/src/context-engine/tools/context-search-tool.test.ts
touchedAreas:
  - harness/specs/**
  - openclaw_runtime/src/plugin-sdk/**
  - openclaw_runtime/extensions/verseconf-artifacts/**
  - scripts/**
  - tests/e2e/**
  - docs/dev/**
expectedUserBehavior:
  - A real runtime tool can create, inspect, revise, export, list history, restore, and disable a bounded structured artifact.
  - Revision candidates are computed in memory by the vendored VerseConf Node/WASM consumer and are committed only through the runtime write owner.
  - Stale revisions, read-only policy, cancellation, invalid candidates, and external drift fail closed without overwriting the source.
  - History and outputs survive a new store instance and never authorize automatic replay of unknown effects.
  - Slide-outline export is a fixed-source, versioned PPTX projection; no second permissions or mutation authority is created.
  - The fixed PPTX template accepts at most three records and rejects larger outlines explicitly; Markdown retains every record. No arbitrary-length PPTX pagination is claimed.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - coding-mutation-consistency-boundary
  - comms-regression
  - packaged-runtime-pruning-guards
  - docs-sync
forbiddenPatterns:
  - direct renderer IPC or Gateway HTTP calls
  - arbitrary model-supplied absolute paths, run ids, workspace ids, or force flags
  - a second write journal or automatic replay of unknown file effects
  - claiming real-human, paid-model, cross-platform, or visual-rendering evidence without an agent-driven artifact
  - changing liveReady, productApproved, defaultOn, frozen product locks, or unrelated Task Forest nodes
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/verseconf-clawx-integrated-consumer.md
  - pnpm harness validate --spec harness/specs/tasks/verseconf-clawx-integrated-consumer.md
  - pnpm --dir openclaw_runtime exec vitest run extensions/verseconf-artifacts/src/*.test.ts
  - pnpm exec playwright test tests/e2e/chat-artifact-panel.spec.ts --workers=1
  - pnpm exec playwright test tests/e2e/coding-loop-fp-p1-04.spec.ts tests/e2e/dcs-preview-optin-fp-p1-03.spec.ts tests/e2e/knowledge-review-queue.spec.ts --workers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.extensions.json --composite false
  - pnpm exec vitest run tests/unit/sync-verseconf.test.ts tests/unit/after-pack-cleanup.test.ts tests/unit/openclaw-bundle-config.test.ts tests/unit/context-engine-registry-default-on.test.ts tests/unit/fakecoding-design-system.test.ts tests/unit/first-product-claims.test.ts tests/unit/runtime-authority-convergence-control-pack.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extension-memory.config.ts extensions/memory-wiki/src/apply-lifecycle.test.ts --maxWorkers=1
  - pnpm test
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm run build:runtime
  - pnpm run build
acceptance:
  - The plugin exposes only bounded artifact operations and binds every mutation to the trusted tool context.
  - A candidate is validated before write, rechecks the source digest and revision while holding the runtime write lease, journals the pre-image, and records committed or recovery_required state.
  - The strict JSON/WASM consumer rejects unsupported formats and invalid schema/candidate combinations; UTF-8 byte ranges and Unicode/CRLF/BOM cases have regression coverage.
  - The runtime commit owner rejects junction and symlink descendants for reads, writes, and rollback; a trusted workspace root may itself be a junction.
  - Artifact revisions, outputs, and operation states are durable and restore creates a new revision rather than mutating history.
  - Reusing an idempotency key with a different nested request returns rejected/idempotency_conflict without changing source bytes, revisions, or the original operation. Equivalent object field ordering remains replayable after reopening the store.
  - Markdown, CSV/XLSX, and fixed-source PPTX projections are deterministic and carry source revision and renderer fingerprints.
  - A scripted agent-driven verification writes a machine-readable report with pass/fail counts, negative-path evidence, source/build fingerprints, and explicit limits.
  - When the user-authorized Responses endpoint variables are present, `pnpm verseconf:live` runs two model rounds through the real runtime Gateway, preserves a self-contained local evidence directory, and records failures as agent-driven local issues without persisting credentials.
notes:
  - README.md, README.zh-CN.md, and README.ja-JP.md were reviewed; no public installation contract changed, so docs.required=false is intentional.
  - This spec authorizes implementation in the current thread because the user explicitly requested completion of TF-0246 through TF-0252; it does not change product locks or publish artifacts.
  - The 2026-10-03 continuation applies the complete local module and runs comprehensive validation. Explicitly listed non-VerseConf paths are prerequisite repairs for reproduced baseline type/contract failures, not new feature or Task Forest completion claims.
  - The shared heading contract follows commit 80bc63687; fallback transcript isolation follows commit 0083060c4. Preserve shipped behavior and add regression coverage rather than reverting these fixes.
  - Preserve the complete module as regular files in packaged runtime overlays; retaining hashes while retaining external declaration links is not a portable delivery.
  - Keep the hash-locked vendor delivery out of auto-fixing lint and Git line-ending conversion; cleanup must preserve its exact declared bytes.
  - Exclude local state, agent-development records, environment files, logs and caches at the runtime bundle root before copying, and remove any such leftovers from the packaged copy. Keep the source workspace intact and preserve nested runtime assets plus the complete vendor delivery.
  - The full Electron pass exposed a stale knowledge-review fixture. Supply the existing ReviewBundle contract and assert its selected bundle identity; do not relax the production approval guard.
  - The coding-loop provider measurement must include the existing Compass SSP system-prompt contribution in the knowledge channel, while preserving exact equality with the runtime ledger and counting repeated system prompt transmission only once.
  - Keep historical verification and verdict records intact. New evidence must bind the current delivery lock, runtime profiles, source inputs, and packaged files; installer existence alone does not establish freshness.
  - The external VerseConf source repository remains an input; the ClawX runtime consumes the checked-in Node/WASM delivery bundle and does not import a developer absolute path.
  - The five exact Agent Dev residual files belong to agent-dev-ecosystem-regularization. Refresh them through the full agent-dev:deep-test generator and verify their consistency and audit freshness; a smoke or cached report is not full-gate evidence.
  - The two exact context-tool test residual files are KS-02 BlockStoreApi fixture compatibility repairs owned by knowledge-system-ks02-experience-session-truth. Preserve the required lifecycle methods and verify both test suites plus their type coverage. They do not change runtime mutation or recall behavior.
  - These seven coexisting paths remain review-visible residuals, not VerseConf ownership. Their reviewed hashes, owning specs and validation artifacts are recorded in artifacts/verseconf-clawx-integration/seven-file-closeout-20261004.json. Any additional uncovered path must still fail diff-aware validation.
---
