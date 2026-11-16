---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round8
title: Inline/Spill 可见归档导航与字段定位收益复核
scenario: context-family
taskType: runtime-bridge
diffBase: 1a12ad0cd23ab5873e6865f73c8e51f62ec71595
intent: 针对第七轮原归档分页漂移和可见精确字段漏读，生成仅来自当前请求的导航提示，独立冻结后在clean候选上完成原四臂收益门禁并收口TF-0749。
touchedAreas:
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-round6-verify.mjs
  - scripts/context-inline-spill-benefit-round7-verify.mjs
  - scripts/context-inline-spill-benefit-round8-verify.mts
  - scripts/context-inline-spill-benefit-strategy.mts
  - tests/unit/context-inline-spill-benefit-navigation.test.ts
  - harness/specs/tasks/inline-spill-real-benefit-eval-round8.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/fixtures/context-inline-spill-benefit-round8/**
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
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-navigation.test.ts tests/unit/context-inline-spill-benefit-strategy.test.ts tests/unit/context-inline-spill-benefit-clean-candidate.test.ts tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/g7-round8-deterministic --repeats 1 --max-turns 8 --max-output-tokens 900 --strategy navigated --pressure-source tool --provider-timeout-ms 240000 --freeze harness/specs/fixtures/context-inline-spill-benefit-round8/design.freeze.json --actor codex-g7-inline-spill-tf0749-01a1d34c
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round8.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval-round8.md --dry-run
acceptance:
  - 第五、六、七轮全部原始证据、失败和判定原字节保留；本轮只使用新候选和独立冻结设计。
  - 原模型、四臂、语料、oracle、三次重复、900输出token、低推理、5500页、工具预算、240000ms期限及B1–B7阈值保持原值，无自动重试。
  - 导航目标及页偏移仅来自本请求初始可见引用或可见function-call元数据；已淘汰输出只允许使用可见调用参数，不恢复原始工具历史、hidden details或payload。
  - 完整private_evidence字段定位只读当前投影的对应function_call_output，提示给出call_id/input索引并停止推荐下一页；不比较oracle、不复制字段值，模型仍自行发起工具调用和输出最终value。
  - 四臂同用导航策略，压力角色及全部日志字节保持第七轮冻结值；24对stable/off首轮完整请求相同，所有导航提示可从实际发送input复算。
  - deterministic机制对照及字段定位负例单独记录；收益由clean已提交候选的96次live、原始usage和同候选verifier判定。
  - B1–B7全部通过、verifier接受clean候选、子节点验收证据可回读及base_graph_hash匹配后自动应用TF-0749收口提案并validate/export。
docs:
  required: true
  files:
    - docs/modules/context-and-memory.md
    - docs/context-family/goal-progress.md
---

第七轮stable只在18个证据任务中成功1次，B2/B4失败；39次原目标、49次其他归档，
另有可见字段被继续翻页或文件名误认的记录。本轮把原归档分页参数和完整字段位置
放在请求末尾。导航函数只接受当前input，不接受oracle、原始历史或归档文件参数。
工具执行器继续只执行模型返回的function_call，最终精确value继续由原评分器判定。
