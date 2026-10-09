---
id: harness-gap-baseline
title: Harness缺口基线与最小实施边界核验
intent: 完成TF-0271/B00的只读源码基线、30来源槽位和29个后续包边界；不实现运行时功能，不把局部测试升级为后续包验收。
touchedAreas:
  - .gitignore
  - docs/dev/harness-gap-closure
  - harness/specs/tasks/harness-gap-baseline.md
  - harness/specs/tasks/harness-gap-closure-plan.md
  - scripts/check-harness-gap-baseline.mjs
  - tests/unit/harness-gap-baseline.test.ts
ownedPaths:
  - .gitignore
  - docs/dev/harness-gap-closure/design.md
  - docs/dev/harness-gap-closure/source-inventory.json
  - docs/dev/harness-gap-closure/baseline.md
  - docs/dev/harness-gap-closure/baseline-evidence.json
  - docs/dev/harness-gap-closure/SHA256SUMS
  - harness/specs/tasks/harness-gap-baseline.md
  - harness/specs/tasks/harness-gap-closure-plan.md
  - scripts/check-harness-gap-baseline.mjs
  - tests/unit/harness-gap-baseline.test.ts
requiredProfiles:
  - fast
requiredRules:
  - task-forest-autoclose-and-roles
  - docs-sync
  - repository-artifact-retention
humanEvidence: not-required
requiredTests:
  - tests/unit/harness-gap-baseline.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/unit/runtime-memory-embedding-ablation.test.ts
  - tests/unit/runtime-memory-mvp-module-b-ablation-test.test.ts
  - tests/unit/runtime-memory-phase4-ablation-benefit.test.ts
acceptance:
  - source-inventory.json包含30个唯一槽位与唯一主owner，29个后续包均有精确候选文件、spec状态、入口、测试与不做项；不复制Task Forest动态进度。
  - HG22和HG27保留来源不全，记录可得检出与历史搜索边界和失败，不从零命中推导功能不存在，不虚构原文。
  - 来源证据绑定源候选commit/tree与文件SHA256；静态观察、已运行回归、尚待验证的调用链明确区分。
  - 自动核验拒绝重复或遗漏槽位、错误owner、缺少包、宽泛写范围、不存在的已有spec及漂移的来源；包含正常和负向检查。
  - 窄sink策略、三份局部ablation与Working Context复用结论具有源码与原测试支撑；A1至A6逐项保留原门限及旧证据候选身份。
  - 干净候选运行必需定向门、独立磁盘核验、hash与凭据扫描；只证明B00基线，不声称其他功能包或全系统验收通过。
  - 产品锁与实验阈值分开记录且原文件未改；本地TF通过proposal保存应用、validate与export收口，不更改旧done或TF-0263。
expectedUserBehavior:
  - 下一包从当前Task Forest依赖与对应窄spec开始；候选文件清单不是全目录写权限。
  - 自动模拟与检查标driven_by=agent和actor，来源不全不等待真人。
docs:
  required: true
  files:
    - docs/dev/harness-gap-closure/baseline.md
    - docs/dev/harness-gap-closure/source-inventory.json
  note: 仅新增开发基线与验证器；复核三语言README，无用户行为或接口变化，不改产品宣传。
---

# B00边界

本包消费已应用的30工作包规划，输出可复核来源与窄实施边界，不另建任务进度真源。
原始运行记录保留在私有本地；稳定清单、核验器与精选报告进入源码。

生产effect/网络调用/UI/故障恢复在本包不适用：本包不修改生产代码或发外部请求。
对应正常/拒绝/缺失/重复/漂移/恢复矩阵由清单核验器的正反回归覆盖；
恢复指纠正无效清单后可重新核验，不是产品运行恢复验收。

所列原有ablation回归只校准“已经存在局部实验”的事实，不替代E01/E02、六个pilot或V02全门。
后续通信改动须使用各包独立spec并引用gateway-backend-communication，不能借本包范围写运行时。
