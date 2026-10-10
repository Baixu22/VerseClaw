---
lifecycleStatus: archived
id: merge-recovery-20261003
title: Safely reconcile knowledge governance and runtime lifecycle integration
diffBase: 70daac29ca3c281ebe8e28cdab1c44e3982398e7
intent: Resolve the existing 36 merge conflicts without losing either feature line or rewriting historical acceptance, and repair isolated-checkout test prerequisites.
scenario: gateway-backend-communication
taskType: runtime-bridge
touchedAreas:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - artifacts/sekb-golden-path/evidence.json
  - docs/dev/goal-loop-durable-process-wake-design.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - electron/services/knowledge-api.ts
  - electron/services/logs-api.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/knowledge/sekb/batch-distillation-assistant.test.ts
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/plugins/manifest-metadata-scan.ts
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - scripts/rc01-authority-inventory.mjs
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/en/knowledge.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ja/knowledge.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/ru/knowledge.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/zh/knowledge.json
  - src/pages/Knowledge/index.tsx
  - tests/e2e/knowledge-hub.spec.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/runtime-memory-consumer-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-semantic-real.test.ts
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
  - scripts/lib/tf0009-agent-surrogate.mjs
  - tests/unit/tf0009-agent-surrogate.test.ts
  - tests/unit/uas-06-single-local-exec-canary.test.ts
  - tests/fixtures/uas-06-live-observations.json
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-lifecycle.test.ts
  - tests/e2e/knowledge-lifecycle.spec.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - harness/specs/tasks/merge-recovery-20261003.md
  - docs/dev/merge-recovery-20261003.md
ownedPaths:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - artifacts/runtime-authority-convergence/rc-01/baseline.json
  - artifacts/sekb-golden-path/evidence.json
  - docs/dev/goal-loop-durable-process-wake-design.md
  - docs/dev/unified-agent-system/runtime-convergence/STATUS.md
  - electron/services/knowledge-api.ts
  - electron/services/logs-api.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts
  - openclaw_runtime/src/agents/shadow-census.ts
  - openclaw_runtime/src/knowledge/sekb/batch-distillation-assistant.test.ts
  - openclaw_runtime/src/knowledge/sekb/distillation-tool.ts
  - openclaw_runtime/src/knowledge/sekb/experience-block-bridge.test.ts
  - openclaw_runtime/src/plugins/manifest-metadata-scan.ts
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - scripts/rc01-authority-inventory.mjs
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/en/knowledge.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ja/knowledge.json
  - shared/i18n/locales/ru/chat.json
  - shared/i18n/locales/ru/knowledge.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/zh/knowledge.json
  - src/pages/Knowledge/index.tsx
  - tests/e2e/knowledge-hub.spec.ts
  - tests/unit/chat-knowledge-scope.test.ts
  - tests/unit/knowledge-steward-semantic-pass.test.ts
  - tests/unit/runtime-memory-consumer-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-llm-judge.test.ts
  - tests/unit/runtime-memory-write-path-semantic-real.test.ts
  - tests/unit/sekb-confirm-provenance-p3-002.test.ts
  - scripts/lib/tf0009-agent-surrogate.mjs
  - tests/unit/tf0009-agent-surrogate.test.ts
  - tests/unit/uas-06-single-local-exec-canary.test.ts
  - tests/fixtures/uas-06-live-observations.json
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/knowledge-lifecycle.test.ts
  - tests/e2e/knowledge-lifecycle.spec.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - harness/specs/tasks/merge-recovery-20261003.md
  - docs/dev/merge-recovery-20261003.md
expectedUserBehavior:
  - Knowledge review queue selection applies only its matching governed ReviewBundle.
  - Typed knowledge references and runtime context budget and loop guards remain effective.
  - Existing frozen defaults and approval boundaries stay unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm repo:artifacts:check
acceptance:
  - Conflict working bytes and all index stages have a verified external recovery copy.
  - All 36 conflict paths have reviewed semantic resolutions and no tracked conflict markers remain.
  - Unrelated staged and unstaged work is preserved.
  - Both knowledge governance and runtime lifecycle behavior have focused executable coverage.
  - Historical evidence remains internally consistent and is not relabelled as this merge acceptance.
  - Known isolated-checkout failures are repaired or precisely retained as unmet build or merge prerequisites.
docs:
  required: true
  files:
    - docs/dev/repository-artifact-retention.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The owner explicitly authorized conflict resolution and failure remediation on
2026-10-03. This does not authorize publishing, deleting branches, rewriting
history, changing frozen defaults, or declaring an unexecuted acceptance passed.
The working tree already contains cross-task staged changes; preserve full-diff
Harness failures and distinguish them from the resolution-specific proof.
