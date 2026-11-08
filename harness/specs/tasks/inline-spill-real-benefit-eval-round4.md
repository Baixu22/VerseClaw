---
lifecycleStatus: active
id: inline-spill-real-benefit-eval-round4
title: Inline/Spill 第四轮评测页预算适配与收益对照
scenario: context-family
taskType: runtime-bridge
diffBase: f1921062df779b0bfebc17685471c1c4b67b024d
intent: 在评测工具入口要求显式的 1–5500 字符页并说明翻页与停止条件，按原模型、预算和样本复测回读投影与任务收益。
touchedAreas:
  - harness/specs/tasks/inline-spill-real-benefit-eval-round4.md
  - harness/specs/scenarios/context-family.md
  - harness/specs/rules/inline-spill-eval-projected-input.md
  - harness/specs/fixtures/context-inline-spill-benefit-round4/**
  - scripts/context-inline-spill-benefit-loop-eval.mts
  - scripts/context-inline-spill-benefit-input.mts
  - tests/unit/context-inline-spill-benefit-input.test.ts
  - docs/modules/context-and-memory.md
  - docs/context-family/goal-progress.md
expectedUserBehavior:
  - 模型自主选择有效的回读页，参数错误由评测入口返回原有 invalid_arguments 诊断。
  - 模型收到的回读文本仍只来自生产投影，实际页尺寸、保留效果、任务正确率和 token 一起记录。
  - 收益判据按原口径复算，每项失败和控制任务配对如实保留。
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
  - pnpm exec vitest run tests/unit/context-inline-spill-benefit-input.test.ts tests/unit/context-inline-spill-benefit-scoring.test.ts tests/unit/context-inline-spill-retention.test.ts tests/unit/context-inline-spill-eval-provider.test.ts --maxWorkers=1
  - openclaw_runtime/node_modules/.bin/tsx scripts/context-inline-spill-benefit-loop-eval.mts --mode deterministic --out D:/tmp/context-inline-spill-benefit-r4 --repeats 1 --max-turns 8
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm harness validate --spec harness/specs/tasks/inline-spill-real-benefit-eval-round4.md
  - pnpm harness run --spec harness/specs/tasks/inline-spill-real-benefit-eval-round4.md --dry-run
acceptance:
  - 四臂使用同一工具定义，max_chars 必填且为 1–5500 整数；缺失或超界参数在生产工具调用前拒绝，单测验证边界、诊断和输入投影。
  - 夹具、oracle、问题、四臂开关、压力消息、输入装配正文、评分源码及 B1-B7 阈值与第三轮保持原字节；生产 recall 默认 12000 和其他产品默认值保持原值。
  - 干净候选 commit/tree、源码摘要、语料摘要、provider/模型、temperature=0、max_output_tokens=900、maxTurns=8、四臂乘八任务乘三次及最多 768 次请求在 live 前冻结。
  - deterministic 覆盖四臂，baseline 证据 0/6、两个正臂 6/6、retention-off 低于 stable，控制任务全过；5500 页序列化结果不超过 6000 字符，负臂输入和投影无 oracle 旁路。
  - live 完成 96 次运行，24 对 stable/off 首轮完整请求相同；逐次请求、响应、工具参数/原始结果和实际投影可回读，所有统计及 B1-B7 可由原始文件复算。
  - 分别报告证据任务与控制任务的保留正向/反向配对、超页、oracle 下一请求丢失、incomplete、usage、延迟及费用口径；费用缺费率或单位时为 not-run。
  - 第四轮证据单独封存，全包 SHA256 匹配、凭证扫描零命中、三个旧证据包和既有四个冻结未跟踪文件保持原样。
  - 所选单测、无缓存类型及 Harness 门禁具备磁盘回执；Task Forest 校验、导出与当前投影读回完成。收益失败时父节点保持未完成，第四轮执行节点按已完成的评测及真实判定收口。
---

服务于 TF-0749，执行节点 TF-0859，实施切片依据 `context-inline-spill-benefit-closeout-20261108/NEXT-EXPERIMENT.md`。运行时通信边界沿用 `gateway-backend-communication` 场景。

只适配评测器的工具说明、页参数契约和执行前校验。已有模型输入装配、生产 truncation/pruner/recall、压力和评分保持原实现。新页错误使用既有 `invalid_arguments` 回传路径。

先通过页边界与生产投影自测，再执行一次冻结 live。若序列化页超过 6000 字符，保存失败并重新冻结设计后再执行 live。每轮首次失败保留，输出预算耗尽继续记 incomplete。
