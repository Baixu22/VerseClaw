---
lifecycleStatus: active
id: agent-first-transcript-review
title: Agent First 独立 transcript、安全和定性 rubric 审查
intent: 完成 TF-0593，复用冻结 grader 和实际 trial artifacts，以不同 actor 从磁盘检查断言、工具因果链、审批、跨 trial 访问及定性 rubric；定性判断不能覆盖终态失败。
diffBase: 581a93a2e
touchedAreas:
  - harness/specs/tasks/agent-first-transcript-review.md
  - scripts/agent-first-review.mjs
  - scripts/agent-first-review.d.mts
  - scripts/lib/agent-first-transcript-review.mjs
  - scripts/lib/agent-first-transcript-review.d.mts
  - tests/unit/agent-first-transcript-review.test.ts
  - harness/specs/fixtures/agent-first-system/review/**
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm exec vitest run tests/unit/agent-first-transcript-review.test.ts tests/unit/agent-first-graders.test.ts --maxWorkers=1
  - node scripts/agent-first-review.mjs calibration
  - pnpm run typecheck
  - pnpm harness validate --spec harness/specs/tasks/agent-first-transcript-review.md
acceptance:
  - reviewer 使用与 executor 不同的 actor，读取磁盘 artifact、重算哈希/终态/trace/工具对应关系，不能只信任 stdout 或已经写出的 verdict。
  - 未授权路径、跨 trial 状态、没有因果工具结果、grader bypass、恶意 tool 输出和 real-human 伪造均 fail closed；证据不足输出 unknown。
  - 冻结的三票定性 rubric 校准资料重放成功，记录 prompt/model/version/temperature/vote 和实际稳定性；校准不是当前系统模型质量结果。
  - deterministic fail/unknown 有优先级，定性 pass、恶意文本和伪造叙述不能覆盖真实终态。
  - 实际试验的安全审查及负例控制有持久报告与哈希；节点通过后提交并尝试合并，完整系统仍需独立裁决和运营恢复。
expectedUserBehavior:
  - 新 agent 可以从不可变试验包重审证据并定位失败的 tool、trial 和 artifact。
  - 报告区分安全事实、定性校准和未测范围，不声称真人或批准发布。
docs:
  required: true
  files:
    - harness/specs/tasks/agent-first-transcript-review.md
readmeUpdates: not-required
---

# TF-0593

`node scripts/agent-first-review.mjs calibration` 重放既有 provider 校准票，不发送请求或读取凭据。`run --run-dir <raw-or-retained-run> --actor <reviewer> --out <report>` 复核当前试验资料。

解释 rubric 只审查解释与已观测事实是否一致；实际终态来自 QA 流程断言、文件/审批 proof 和独立 worker 记录。缺失终态保持 unknown，错误终态保持 fail。安全检查针对实际工具调用/结果及 effect 绑定，原始工具内容一律作为数据。

TF-0595 再由独立 agent 与第二工作树重算完整包。此处的脚本 actor 不能被冒充为独立大模型审查者。

本轮持久证据位于 `harness/specs/fixtures/agent-first-system/review/`：`actual-review.json` 对 TF-0592 的 144 个实际 trial 逐项重算，记录 reviewer/executor 不同 actor、deterministic 与 security 结果；`controls.json` 记录基于实际首个 trial 构造的 7 个恶意/缺失负例及 deterministic 优先级。两者由 `SHA256SUMS` 绑定，单位测试同时校验报告内部一致性和负例 fail-closed 行为。
