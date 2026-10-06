---
id: desktop-acceptance-followups
title: Repair the remaining Windows desktop acceptance failures
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 8143c48a316ff191805e027119e145f461c60314
intent: Complete TF-0255 through TF-0258 using current agent-driven evidence, preserving product locks and existing budgets.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - renderer-loading-experience
  - i18n-locale-coverage
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - .gitignore
  - .gitattributes
  - artifacts/desktop-acceptance-followups/report.json
  - artifacts/desktop-acceptance-followups/credential-scan.json
  - artifacts/desktop-acceptance-followups/SHA256SUMS
  - docs/dev/desktop-acceptance-followups.md
  - scripts/copy-runtime-package.mjs
  - scripts/copy-runtime-package.d.mts
  - scripts/bundle-openclaw-runtime.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - electron/gateway/supervisor.ts
  - tests/unit/gateway-supervisor.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - resources/verseshell-mcp/src/index.js
  - resources/verseshell-mcp/test/start-smoke.test.mjs
  - tests/unit/copy-runtime-package.test.ts
  - openclaw_runtime/src/infra/node-sqlite.ts
  - openclaw_runtime/src/infra/node-sqlite.test.ts
  - scripts/rc10/driver.mjs
  - scripts/rc10/operator-driver.mjs
  - tests/e2e/rc10-operator-live.spec.ts
  - vite.config.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/stores/chat.ts
  - shared/chat/types.ts
  - src/pages/Models/index.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/e2e/chat-checkpoints.spec.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/compaction-artifact-viewer.spec.ts
  - tests/e2e/chat-model-picker-tiers.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/token-usage.spec.ts
  - tests/e2e/fakecoding-scheduled-browser-runs.spec.ts
  - tests/e2e/knowledge-hub.spec.ts
  - tests/e2e/chat-agent-effort.spec.ts
  - harness/specs/tasks/desktop-acceptance-followups.md
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
requiredTests:
  - pnpm exec vitest run tests/unit/copy-runtime-package.test.ts tests/unit/after-pack-cleanup.test.ts tests/unit/composer-git-strip.test.tsx tests/unit/chat-input.test.tsx --maxWorkers=1
  - node --test resources/verseshell-mcp/test/start-smoke.test.mjs
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.infra.config.ts src/infra/node-sqlite.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run build:startup-check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/rc10-operator-live.spec.ts tests/e2e/chat-checkpoints.spec.ts tests/e2e/chat-composer-git-strip.spec.ts tests/e2e/compaction-artifact-viewer.spec.ts tests/e2e/chat-model-picker-tiers.spec.ts tests/e2e/token-usage.spec.ts tests/e2e/startup-loading-experience.spec.ts tests/e2e/chat-latex-rendering.spec.ts
acceptance:
  - Windows runtime and MCP deliveries contain their installed dependency versions without external development links. Module resolution from a relocated delivery stays inside that delivery, and NSIS finishes with exit 0.
  - RC-10 H-02 through H-06 preserve permission and timeout boundaries and produce current events, decisions, continuations and receipts from an agent-driven clean candidate.
  - Startup chunk checks pass their existing budgets and math, chat and first-screen Electron flows remain functional.
  - Scheduled/Browser and Knowledge Hub pass the full suite without forced clicks. Required checkpoint, compaction, Git and model-scope entries have real wiring and Electron coverage; existing skips are accounted for individually.
  - Curated evidence includes clean candidate identity, reproducible command receipts, hashes, zero-hit credential scanning, and honest exclusions. No historical verdict is re-signed.
---

The owner requested all four remaining nodes on 2026-10-06. Work advances in
node order. Human interaction is automated and labelled `driven_by: agent`.
This task does not authorize publication, paid model calls or product graduation.
