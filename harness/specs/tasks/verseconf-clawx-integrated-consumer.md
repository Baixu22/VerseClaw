---
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
  - scripts/after-pack.cjs
  - scripts/installer.nsh
  - .gitignore
  - openclaw_runtime/extensions/verseconf-artifacts/**
  - scripts/verify-verseconf-clawx-integration.mjs
  - tests/e2e/chat-artifact-panel.spec.ts
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
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - coding-mutation-consistency-boundary
  - comms-regression
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
  - pnpm run typecheck
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
  - Artifact revisions, outputs, and operation states are durable and restore creates a new revision rather than mutating history.
  - Markdown, CSV/XLSX, and fixed-source PPTX projections are deterministic and carry source revision and renderer fingerprints.
  - A scripted agent-driven verification writes a machine-readable report with pass/fail counts, negative-path evidence, source/build fingerprints, and explicit limits.
notes:
  - README.md, README.zh-CN.md, and README.ja-JP.md were reviewed; no public installation contract changed, so docs.required=false is intentional.
  - This spec authorizes implementation in the current thread because the user explicitly requested completion of TF-0246 through TF-0252; it does not change product locks or publish artifacts.
  - The external VerseConf source repository remains an input; the ClawX runtime consumes the checked-in Node/WASM delivery bundle and does not import a developer absolute path.
---
