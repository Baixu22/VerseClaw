---
id: context-moat-m4-evidence-review
title: TF-0127 M4 交付证据与里程碑门复核
scenario: system-maturity-traceability
taskType: program-governance
intent: 复核 M4 已落地子节点的实际交付、生产调用点、真实语料、改动归属与完整 L2；如实保留阻塞，不通过刷新历史证据放行。
touchedAreas:
  - docs/dev/context-moat/reviews/TF-0127.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
  - harness/specs/tasks/context-moat-m4-evidence-review.md
expectedUserBehavior:
  - 接力者能从审核记录复跑检查并区分技术证据、已接受限制和未解决的收口条件。
requiredProfiles:
  - fast
requiredRules:
  - system-maturity-traceability
requiredTests:
  - tests/unit/system-maturity-evidence-validator.test.ts
  - tests/unit/system-maturity-traceability-p7-001.test.ts
acceptance:
  - 实际交付仅为 TF-0128、TF-0138、TF-0143；不把第二轮能力列为已实现。
  - 逐符号核实调用表达式及导入绑定，默认关、kill switch、上游守卫和分支旁路逐条留证；可达性工具必须输出结果并通过阴性对照。
  - 真实语料哈希、轮数和压缩次数与登记一致；仅记录脱敏统计，不发布语料正文。
  - L2 按真实脚本链逐段运行；自改写的 maturity 在隔离工作树运行，按失败集合与冻结基线比较，不仅比较数量。
  - 未归属的交付不能因缺少 trailer 被忽略；分别记录机械读数、已识别漏计和待裁定归属，不擅改预算。
  - 任一门存在未处置的新失败或归属未闭合时，TF-0127 进入 in_progress 并直接处理；依赖外部条件时明确 blocked，不以 review_needed 长期代替结论，也不冒充 done。
docs:
  required: false
---

归属 TF-0127。本任务为治理复核，不改运行时代码、配置默认值、产品锁或历史 artifacts；遵守 DEV-PROTOCOL 的 §D1、§R1、§R2.3、§R3.6、§R3.8、§R4.6 与 §R5。
