---
lifecycleStatus: active
id: inline-spill-final-hygiene-20261114
title: G7 集成后的证据保留规则与最终清理
scenario: context-family
taskType: documentation
diffBase: e4d43e587634fe819b2d9784cdfc7c4c9e22b6c1
intent: 修复集成main中已提交验收证据的精确保留登记，验证原字节、清理归档空目录，并在无待提交变化后完成收尾。
touchedAreas:
  - .gitattributes
  - .gitignore
  - scripts/repository-artifacts.json
  - harness/specs/tasks/inline-spill-final-hygiene-20261114.md
  - harness/specs/fixtures/context-inline-spill-final-hygiene-20261114/**
requiredProfiles:
  - fast
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
humanEvidence: not-required
requiredTests:
  - pnpm repo:artifacts:check
  - pnpm repo:duplicates:check
  - pnpm exec vitest run tests/unit/repository-artifact-retention.test.ts --maxWorkers=1
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-final-hygiene-20261114.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-final-hygiene-20261114.md --dry-run
acceptance:
  - 已提交的15份UI层级证据加入retainedFiles，80份G8日志和截图使用精确ignore例外，不扩大任何目录的保留范围。
  - 95份现有证据、G7第九轮原始清单和冻结候选字节保持；不改写历史失败或产品默认。
  - repo:artifacts与repo:duplicates均退出0，证据保留规则回归和定向Harness通过。
  - 新修改提交并回流main，已有未提交字节保持；私有远端同步并回读。
  - 旧归档空目录清理完成；仅在工具允许且无占用时清理会话主工作树，否则保留clean主检出并记录具体状态。
docs:
  required: true
  files:
    - harness/specs/fixtures/context-inline-spill-final-hygiene-20261114/REPORT.md
---

保留规则只登记main中已存在且由原清单、README或报告引用的证据文件。
新运行和其他文件继续遵守本地输出规则，原始验收候选与历史判定保持。
