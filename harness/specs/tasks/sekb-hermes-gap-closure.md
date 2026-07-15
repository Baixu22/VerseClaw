---
id: sekb-hermes-gap-closure
title: "SEKB Hermes Memory 档 A: default-off production merge readiness"
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: |
  Land SEKB Hermes Phase A/A.5/B library, Host/CLI ops, and offline evaluation
  surfaces as optional default-off capability. Preserve flag-off parity, keep
  confirm_and_save as the only durable L2 write path, freeze Shadow V1 at 50,
  and defer promotion / Phase C/D enablement.
touchedAreas:
  - openclaw_runtime/src/knowledge/sekb/**
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.test.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/runtime-context-block-sekb.test.ts
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - electron/services/knowledge-api.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/host-api-facade.test.ts
  - scripts/sekb-hermes-ops.mjs
  - scripts/sekb-a5-auto-test.mjs
  - scripts/sekb-enable-shadow-local.mjs
  - scripts/sekb-shadow-capture-smoke.mjs
  - scripts/configure-deepseek-runtime.mjs
  - scripts/build-openclaw-runtime.mjs
  - package.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/enhancements/sekb-hermes-inspired-optimization-design.md
  - harness/specs/tasks/sekb-hermes-gap-closure.md
  - harness/specs/rules/sekb-hermes-default-off-boundary.md
  - harness/specs/rules/sekb-hermes-write-path-boundary.md
  - harness/specs/rules/sekb-hermes-promotion-boundary.md
  - artifacts/sekb-hermes-phase-a5/**
expectedUserBehavior:
  - Default user path is unchanged when SEKB/shadow/batch flags remain off.
  - Operators can use CLI and Host API SEKB ops without any SEKB ops GUI.
  - Manual distillation still requires explicit confirm_and_save before durable L2 writes.
  - Offline dual-review artifacts are evaluation evidence only and do not drive runtime decisions.
  - Automated dual-smoke never claims evaluable_for_promotion.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - openclaw_runtime/src/knowledge/sekb/shadow-evaluator.test.ts
  - openclaw_runtime/src/knowledge/sekb/shadow-evaluation-offline.test.ts
  - openclaw_runtime/src/knowledge/sekb/batch-distillation-assistant.test.ts
  - openclaw_runtime/src/knowledge/sekb/batch-distillation-deepseek-provider.test.ts
  - openclaw_runtime/src/knowledge/sekb/task-classifier.test.ts
  - openclaw_runtime/src/knowledge/sekb/sekb.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.test.ts
  - tests/unit/knowledge-api.test.ts
  - tests/unit/host-api-facade.test.ts
acceptance:
  - All SEKB/shadow/batch flags default off; nested flags cannot enable SEKB alone.
  - Host KnowledgeStore uses Electron/OPENCLAW_STATE_DIR-aligned state dir.
  - Artifact workspace root prefers VERSE_CLAW_REPO_ROOT and does not default to process.cwd().
  - Missing trajectory IDs soft-skip instead of hard-failing suggest paths.
  - Batch assistant is explicit-invoke only with optional DEEPSEEK_API_KEY and deterministic fallback.
  - configure-deepseek does not enable SEKB unless --enable-sekb-shadow is passed.
  - Shadow V1 retain threshold remains 50; Phase C/D are not activated.
  - README en/zh/ja and design status honestly describe default-off / no GUI / no auto-write / promotion deferred.
  - contract:check passes when host contract types change.
docs:
  required: true
---

SEKB Hermes 档 A closes the gap between local Phase A/A.5/B implementation and a production-branch-safe merge: optional capability only, never production enablement, never promotion.