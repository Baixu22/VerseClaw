---
lifecycleStatus: active
id: inline-spill-g7-integration-closeout
title: G7 Inline/Spill 合并与证据卫生收尾
scenario: context-family
taskType: documentation
diffBase: fda6346dd998b11b7f256d24c18d541c9b2a0ebf
intent: 保留原冻结候选及失败证据，登记有来源的重复归档，按G7写集合入main并保留可恢复Git历史，更新稳定证据路径后清理空闲隔离检出。
touchedAreas:
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-strategy.mts
  - scripts/context-inline-spill-benefit-input.mts
  - scripts/context-inline-spill-benefit-scoring.mts
  - scripts/context-inline-spill-benefit-round5-verify.mjs
  - scripts/context-inline-spill-benefit-round5-recompute.mjs
  - scripts/context-inline-spill-benefit-round6-verify.mjs
  - scripts/context-inline-spill-benefit-round7-verify.mjs
  - scripts/context-inline-spill-benefit-round8-verify.mts
  - scripts/context-inline-spill-benefit-round9-verify.mts
  - scripts/duplicate-assets-allowlist.json
  - tests/unit/context-inline-spill-benefit-*.test.ts
  - harness/specs/tasks/inline-spill-real-benefit-eval-round5.md
  - harness/specs/tasks/inline-spill-real-benefit-eval-round6.md
  - harness/specs/tasks/inline-spill-real-benefit-eval-round7.md
  - harness/specs/tasks/inline-spill-real-benefit-eval-round8.md
  - harness/specs/tasks/inline-spill-real-benefit-eval-round9.md
  - harness/specs/tasks/inline-spill-g7-integration-closeout.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/fixtures/context-inline-spill-benefit-round5/**
  - harness/specs/fixtures/context-inline-spill-benefit-round6/**
  - harness/specs/fixtures/context-inline-spill-benefit-round7/**
  - harness/specs/fixtures/context-inline-spill-benefit-round8/**
  - harness/specs/fixtures/context-inline-spill-benefit-round9/**
  - harness/specs/fixtures/context-inline-spill-g7-closeout/**
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
  - .gitattributes
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm repo:duplicates:check
  - pnpm repo:artifacts:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-g7-integration-closeout.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-g7-integration-closeout.md --dry-run
acceptance:
  - TF-0700、TF-0749和全部子节点从磁盘回读done/100；第九轮GO、第五至第八轮NO_GO、固定B1–B7与测量候选原字节保持。
  - 重复证据登记仅包括逐文件哈希与原清单已匹配的G7组；不删原始运行、不刷新旧清单、不改变预算或生产默认。
  - main集成写集仅包含本线评测脚本、spec、证据与文档；独立仓库全部G7候选commit可从主仓库或bundle恢复。
  - 集成后定向测试、类型、契约、Harness与证据回读有退出码和来源，固定候选verifier仍接受归集第九轮证据。
  - 更新Task Forest稳定证据路径前base_graph_hash匹配，保持节点done/100；本地Task Forest历史不提交。
  - 只清理本会话已确认空闲且可恢复的工作树；保留其它会话、主树未提交字节、原始失败与唯一未归集证据。
docs:
  required: true
  files:
    - harness/specs/fixtures/context-inline-spill-g7-closeout/REPORT.md
---

合并执行先在隔离检出准备。候选27c1a91dd的原始GO仍只对应固定语料、模型和评测策略，
集成后的源码与门禁单独记录。重复登记保留原目录和SHA256SUMS，来源与同字节复制关系
在收尾证据中逐组列出。
