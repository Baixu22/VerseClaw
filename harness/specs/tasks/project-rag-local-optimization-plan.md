---
lifecycleStatus: active
implementationStatus: planning
id: project-rag-local-optimization-plan
title: 固定本地 RAG 优化目标、依赖和验收
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: 将已复核的RAG成熟度问题登记为可持续推进的工作包和Task Forest节点。
diffBase: 917a71cba7b2dfc8aedbdb3b75b7b693e3900f1e
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - docs/dev/project-rag/OPTIMIZATION-20261126.md
  - harness/specs/tasks/project-rag-local-optimization-plan.md
  - harness/specs/fixtures/project-rag/optimization-plan-20261126/**
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - project-rag-long-term-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/project-rag-local-optimization-plan.md
  - pnpm harness validate --spec harness/specs/tasks/project-rag-local-optimization-plan.md
  - pnpm harness run --spec harness/specs/tasks/project-rag-local-optimization-plan.md --dry-run
expectedUserBehavior:
  - 优化目标、依赖、证据和回滚可以从任务图与仓库合同恢复。
  - 首个实施叶ready，其余叶按照前置顺序推进。
acceptance:
  - 设计覆盖主线修复、生效能力、证据单元、融合重排与DCS、记忆经验和按需Research六项交付，每项明确owner、输入、验收和回滚。
  - 计划与TF-0870、TF-0946及TF-0893至TF-0896衔接，旧TF-0122迁出裁决、TF-0965经验接口和冻结默认保持一致。
  - Task Forest提案在当前base_graph_hash保存、应用并通过validate；完整历史和HTML导出可读回，既有节点状态、百分比、验收和历史产物保留。
  - 规划通过窄Harness验证，源码合同与精选审查输入提交，Task Forest及交接留在本地；实现节点完成须有自己的当前候选证据。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/project-rag/OPTIMIZATION-20261126.md
---

实施前先完成本规划的Task Forest登记。后续每个工作包独立建立或更新窄任务规格，运行Harness context后实施。普通开发、质量实验和原完整资格验收分别保留其真实候选与结果。

真实模型、资源占用及费用使用新候选绑定的执行计划；未知调用和旧失败保留。所有自动化证据标记driven_by: agent。源码文档记录稳定合同，进度只由Task Forest维护。
