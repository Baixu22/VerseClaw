---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round9
title: Inline/Spill 可见书签恢复错误原归档参数
scenario: context-family
taskType: runtime-bridge
diffBase: 7ef31b1a5
intent: 修复模型扩写URI摘要后错误目标被锁定的问题，把最初可见引用作为有界书签放入既有agent问题，独立冻结后在clean候选完成原四臂B1–B7并收口TF-0749。
touchedAreas:
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-strategy.mts
  - scripts/context-inline-spill-benefit-round6-verify.mjs
  - scripts/context-inline-spill-benefit-round7-verify.mjs
  - scripts/context-inline-spill-benefit-round8-verify.mts
  - scripts/context-inline-spill-benefit-round9-verify.mts
  - tests/unit/context-inline-spill-benefit-bookmark.test.ts
  - harness/specs/tasks/inline-spill-real-benefit-eval-round9.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/fixtures/context-inline-spill-benefit-round9/**
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
  - .gitattributes
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - disk-temp-policy
  - agent-engineering-acceptance-boundary
  - inline-spill-benefit-quantification
  - inline-spill-eval-projected-input
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-bookmark.test.ts tests/unit/context-inline-spill-benefit-navigation.test.ts tests/unit/context-inline-spill-benefit-strategy.test.ts tests/unit/context-inline-spill-benefit-clean-candidate.test.ts tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/g7-round9-deterministic --repeats 1 --max-turns 8 --max-output-tokens 900 --strategy bookmarked --pressure-source tool --provider-timeout-ms 240000 --freeze harness/specs/fixtures/context-inline-spill-benefit-round9/design.freeze.json --actor codex-g7-inline-spill-tf0749-01a1d34c
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round9.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval-round9.md --dry-run
acceptance:
  - 最初书签只复制实际可见exec结果中的URI/checksum，长度最多512字符，放入既有agent问题；无证据基线不增加引用。
  - 书签优先于失败模型调用的错误参数，页偏移和字段位置仍来自当前input；不静默改写、代发或重试模型工具调用。
  - 首次把16位URI摘要扩写成64位checksum的确定性故障对照独立保留；脚本对照通过只证明可见恢复路径。
  - 原模型、四臂、语料、oracle、重复数、900输出token、低推理、5500页、工具预算、240000ms期限及B1–B7阈值保持原值。
  - 第五至第八轮全部原始证据和失败保留；本轮设计先单独提交，再提交clean候选，实际96次live和verifier接受同候选。
  - B1–B7全过、子节点证据回读完整和base_graph_hash匹配后自动应用TF-0749收口提案并validate/export。
docs:
  required: true
  files:
    - docs/modules/context-and-memory.md
    - docs/context-family/goal-progress.md
---

URI是opaque定位符。模型曾用完整checksum拼接文件名，返回missing后又沿用错误URI。
本轮把最初已可见引用纳入既有问题的导航元数据，当前生产投影持续提供这份小书签，
允许模型从错误首次调用恢复。书签不包含payload或字段值，retention对照仍只改变
回读内容是否在压力下保留。工具执行器继续只执行模型返回的原始参数。
