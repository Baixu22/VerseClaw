---
lifecycleStatus: active
id: autonomy-context-baseline
title: 冻结自治上下文基线与中途继续执行评测场景
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: f18b0d7ea9d4b4a34f231a49178225a01e71ca0f
intent: C01只建立当前系统的可复算基线、场景和预注册评测合同，先分清结构保证、模型行为和真实产品结果。
touchedAreas:
  - harness/specs/tasks/autonomy-context-baseline.md
  - harness/specs/guides/autonomy-context-system-design.md
  - shared/long-session-paired-evaluation.ts
  - scripts/verify-autonomy-context-baseline.mjs
  - tests/unit/autonomy-context-paired.test.ts
  - tests/unit/fixtures/autonomy-context-baseline.json
  - tests/unit/autonomy-context-baseline.test.ts
  - harness/specs/fixtures/autonomy-context-system/baseline/**
  - tests/unit/fixtures/autonomy-context-baseline.v2.json
  - harness/specs/tasks/autonomy-context-system-plan.md
  - harness/specs/rules/autonomy-context-system-contract.md
  - harness/specs/scenarios/autonomy-context-system.md
  - harness/specs/fixtures/autonomy-context-system/planning/validation.json
requiredRules:
  - autonomy-context-system-contract
  - identity-scope-boundary
  - autonomy-object-owner-boundary
  - durable-task-system-boundary
  - context-family-boundary
  - context-runtime-kit-boundary
  - runtime-authority-convergence-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 基线明确当前实际任务/上下文能力及证据空白，不改变生产prompt或产品默认。
  - 后续策略使用同一任务环境、输入、模型和剩余预算，能定位状态失真和重复工作。
requiredTests:
  - node scripts/verify-autonomy-context-baseline.mjs
  - pnpm exec vitest run tests/unit/autonomy-context-baseline.test.ts tests/unit/autonomy-context-paired.test.ts tests/unit/long-session-paired-evaluation.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm harness validate --spec harness/specs/tasks/autonomy-context-baseline.md --since f18b0d7ea9d4b4a34f231a49178225a01e71ca0f
  - pnpm harness run --spec harness/specs/tasks/autonomy-context-baseline.md --since f18b0d7ea9d4b4a34f231a49178225a01e71ca0f --dry-run
acceptance:
  - 冻结不少于15类场景、环境中途检查点、owner状态、source/input/config摘要与剩余行动预算。
  - 冻结四臂、数据划分、grader、负控制、质量非劣界、成本上限及功效判据，先于任何模型收益实验。
  - 离线回放覆盖否定/临时范围/修订/未知效果/来源失效/误用经验/代次变化/成本未知，回读真实输出并可复算。
  - 历史30组结构配对与新模型收益分开；脚本模型、真实provider和产品旅程分别标识，不把unknown计为0。
  - 运行代码、默认值、写入权限和原始生产数据保持；任何未来live运行使用新冻结计划与匹配授权。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - harness/specs/guides/autonomy-context-system-design.md
---

C01 的离线输入为 `tests/unit/fixtures/autonomy-context-baseline.v2.json`；旧 v1 文件与 TF-0686/0687 证据保留。
精选证据目录为 `harness/specs/fixtures/autonomy-context-system/baseline/v1/`，包含 baseline-manifest.json、scenario-matrix.json、frozen-evaluation-policy.json、offline-readback.json。

执行者将 oracle 从输入剥离，再调用真实 TaskSystemStore、restoreTaskModelContext、executeTaskGuarded、CompressionArtifact、Main continuityPreview、归档校验、Working Context 与 owner scope 校验。模型与外部 owner RPC 使用明确的离线 fixture。结构断言、脚本继续行为和产品任务结果分栏；产品任务结果为未测量。

45 个输入覆盖 15 类，每类 train/development/final-holdout 各一个。C01 执行前两切片的当前机制与已有 observation masking 对照，每个检查点重复执行两次。最终留出拒绝执行，后两臂 planned。oracle 不因当前机制的失败而修改；回放的缺口是基线产出。负控制必须改变实际观察值且被 grader 拒绝。

测试前读取资源队列并用 enqueue/run 取得回执。TEMP/TMP 指向 D:/tmp，设置 pnpm_config_verify_deps_before_run=false。通过 CLAWX_C01_OUTPUT 指定全新的原始证据目录，已有 offline-run.json 拒绝覆盖。原始 trace、数据库、首次失败及日志留在该目录。

冻结源码以本叶起点 f18b0d7ea9d4b4a34f231a49178225a01e71ca0f 为 diffBase；提交后的 Harness 仍使用此基线。类型检查覆盖新增 grader 与测试入口的真实依赖；原项目无关诊断与本叶诊断分别记录。README en/zh/ja 已核对，本叶新增评测入口和规格，不改变其产品能力描述。

冻结协议在任何收益实验之前确定质量、全成本与功效规则。C01 不启用生产 context_update。未来 live 计划须另绑定真实模型/后端/语料/候选和预算，执行匹配授权。

复算入口：`node scripts/verify-autonomy-context-baseline.mjs` 核对源码、冻结输入、精选报告和独立 grader；传入 `--run-report <新跑次的 offline-run.json>` 比较继续执行观察值的语义摘要。原始文件字节 SHA256 与跨检出的 UTF-8/LF 源码摘要分别记录。
