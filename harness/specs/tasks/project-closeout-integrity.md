---
id: project-closeout-integrity
title: Project closeout compilation and evidence integrity
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Verify the current checkout and repair reproduced typecheck false positives and runtime compilation failures without changing product locks or treating historical evidence as current acceptance.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - agent-dev-conformance-evidence
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Typecheck failures cannot be reported as a passing full gate.
  - Artifact operations reject workspace link traversal and oversized PPTX outlines explicitly.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
touchedAreas:
  - .gitignore
  - scripts/typecheck-agent-dev.mjs
  - tests/unit/typecheck-gate.test.ts
  - openclaw_runtime/src/agents/long-task-control/task-ledger.ts
  - openclaw_runtime/src/agents/stage1-golden-run.ts
  - openclaw_runtime/src/agents/stage5-golden-run.ts
  - openclaw_runtime/src/context-engine/source-set.ts
  - openclaw_runtime/src/plugin-sdk/structured-artifacts.ts
  - openclaw_runtime/extensions/verseconf-artifacts/src/render.ts
  - openclaw_runtime/extensions/verseconf-artifacts/src/render.test.ts
  - openclaw_runtime/extensions/verseconf-artifacts/src/structured-artifacts.seam.test.ts
  - harness/specs/tasks/project-closeout-integrity.md
  - harness/specs/tasks/agent-dev-ecosystem-regularization.md
  - harness/specs/rules/agent-dev-conformance-evidence.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/dev/project-closeout-audit-20261004.md
  - docs/dev/verseconf-clawx-implementation-20261001.md
  - harness/specs/tasks/verseconf-clawx-integrated-consumer.md
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/project-closeout-20261004/report.json
requiredTests:
  - pnpm exec vitest run tests/unit/typecheck-gate.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime exec tsgo --noEmit -p tsconfig.core.json --incremental false
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
acceptance:
  - A real TypeScript error in tests fails the root gate, and cached checks cannot reuse results after test or runtime dependency edits.
  - Runtime production typechecking passes without suppressions, removed source coverage, or weakened compiler settings.
  - The runtime ledger shares its event contract with its producers; golden-run tools narrow function calls before reading function fields, and readonly evidence is constructed without mutation.
  - Structured artifact reads and writes reject symlink or junction traversal below the trusted workspace root, including creation through a linked parent; the workspace root itself may be a junction.
  - The fixed three-slide PPTX renderer rejects larger outlines explicitly instead of silently dropping records. Markdown remains the full-outline export; arbitrary-length visual pagination is not claimed.
  - Closeout reports distinguish reproduced failures, repaired failures, skips, scope exclusions, and gates not run. A passing build never substitutes for type or functional verification.
notes:
  - This task follows the owner's explicit 2026-10-04 project closeout request. Existing uncommitted VerseConf and Agent Dev work is preserved; a diff-aware scope failure must be reported rather than hidden with no-diff or blanket residuals.
  - Validation and reproductions are agent-driven. No release, paid calls, default changes, or product graduation is authorized by this task.
---
