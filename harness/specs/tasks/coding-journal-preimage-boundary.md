---
lifecycleStatus: active
id: coding-journal-preimage-boundary
title: TF-0765 在读取 journal pre-image 前执行工作区授权
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 024380f996238a87d81edd51f3ddd8cd792c133e
intent: 修复真实 write/edit 装配中 journal 先于 workspace guard 读取外部文件的问题，并在路径锁内用现有 fs-safe 读取受限快照。
touchedAreas:
  - harness/specs/tasks/coding-journal-preimage-boundary.md
  - harness/specs/rules/coding-mutation-consistency-boundary.md
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - docs/modules/workspace-and-coding.md
  - harness/specs/fixtures/coding-fixes/TF-0765/**
  - scripts/coding-baseline/verify.d.mts
expectedUserBehavior:
  - workspaceOnly拒绝的write/edit不读取或保存外部文件pre-image，可信来源也不能绕过限域。
  - 合法工作区写入保留journal与undo能力，未限域的明确授权外部写入保持现有行为。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - coding-mutation-consistency-boundary
  - disk-temp-policy
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/coding-journal-preimage-boundary.md
  - node node_modules/vitest/vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/agent-tools.workspace-boundary.test.ts src/agents/tools/write-journal.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - 真实coding工具write/edit的可信、外部与未知来源在journal默认开启时拒绝外部绝对路径、junction和hardlink，磁盘目标及journal均无泄露或变更。
  - 正常写/改/undo及显式未限域外部写保持可用；快照对应实际规范化路径。
  - 授权检查在所有write-kit读取之前，journal本身在锁内使用现有fs-safe读取当前路径，拒绝读取时不先创建pre-image。
  - 前置C0原始失败不修改，新测试先红后绿；命令exit/count/产物与源码绑定，代码不改变默认值或产品锁。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: README的工作区限域承诺不变；本修复落实该承诺，模块文档说明快照顺序。
---

复用现有Workspace guard、fs-safe和write journal；不创建第二权限面。直接外部read必须拒绝，随后被拒的write/edit也不能通过journal复制该内容。测试使用生成的标记文件，不读取开发者凭据或个人文件。原baseline只用于定位，修复验收不修改其失败值。

本节点类型门发现前一节点的基线验证器缺少 .d.mts 声明；仅补声明以使现有测试类型检查可执行，不改原基线实现或证据。
