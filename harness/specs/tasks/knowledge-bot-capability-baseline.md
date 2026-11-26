---
lifecycleStatus: active
id: knowledge-bot-capability-baseline
title: Freeze the current Knowledge Bot task baseline
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replay the current assistant against the same scoped questions and review requests before changing its tools.
diffBase: c8c1e2e48c9c1a04937904a0edb18dc0b53aea05
touchedAreas:
  - harness/specs/tasks/knowledge-bot-capability-baseline.md
  - tests/fixtures/knowledge-bot-baseline/**
  - tests/unit/knowledge-bot-baseline.test.tsx
  - scripts/knowledge-bot-baseline.mjs
requiredProfiles:
  - fast
  - comms
requiredRules:
  - knowledge-source-set-read-admission
  - backend-communication-boundary
requiredTests:
  - tests/unit/knowledge-bot-baseline.test.tsx
expectedUserBehavior:
  - The existing bot receives the frozen questions through its normal renderer and host entry points.
acceptance:
  - Freeze bilingual sources, tasks, oracles, effects and metric denominators before collecting answers.
  - Record candidate, working-tree delta, input hashes, actor, run ID, actual messages, selections and effects.
  - Exercise selection, page, source set and project lookup plus field extraction and release-manual review, including missing, revoked, partial, conflicting and duplicate requests.
  - Rerun without external model spend and reproduce per-case grades on the same frozen inputs.
docs:
  required: false
---

本规格只测量变更前的资料管理员。产品差距以逐题失败保留。基线采集异常、缺少记录或输入变动会使本次测量无效。
