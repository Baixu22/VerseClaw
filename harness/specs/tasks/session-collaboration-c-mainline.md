---
lifecycleStatus: active
id: session-collaboration-c-mainline
title: 整合跨会话材料与任务上下文复用
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c834668c555a86aabc6d58065132916f5693830b
intent: 在已合并的消息回执底座上交付材料发布、查询、生命周期与实际消费追溯。
touchedAreas:
  - README.ja-JP.md
  - README.md
  - README.zh-CN.md
  - docs/modules/sessions.md
  - electron/services/session-activity-api.ts
  - electron/services/sessions-api.ts
  - harness/specs/fixtures/session-collaboration-center/C-development-20261127/**
  - harness/specs/rules/session-collaboration-center-contract.md
  - harness/specs/scenarios/session-collaboration-center.md
  - harness/specs/tasks/session-collaboration-c-mainline.md
  - harness/specs/tasks/session-collaboration-c1.md
  - harness/specs/tasks/session-collaboration-c2.md
  - harness/specs/tasks/session-collaboration-c3.md
  - harness/specs/tasks/session-collaboration-c4.md
  - harness/specs/tasks/session-collaboration-c5.md
  - openclaw_runtime/extensions/ollama/src/stream.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/execution-task-authority.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/session-collaboration-material-prompt.ts
  - openclaw_runtime/src/agents/tool-description-presets.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/tools/session-collaboration-query.ts
  - openclaw_runtime/src/agents/tools/sessions-list-tool.ts
  - openclaw_runtime/src/agents/tools/sessions-watch-tool.ts
  - openclaw_runtime/src/gateway/server-methods/session-activity.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-context.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-material.ts
  - openclaw_runtime/src/gateway/server-methods/session-collaboration-watch.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/agents.json
  - shared/i18n/locales/ja/agents.json
  - shared/i18n/locales/ru/agents.json
  - shared/i18n/locales/zh/agents.json
  - shared/session-collaboration-watch.ts
  - shared/task-system/store.ts
  - shared/task-system/trace.ts
  - shared/types/session-collaboration-context.ts
  - shared/types/session-collaboration-material.ts
  - shared/types/session-collaboration-watch.ts
  - src/components/agents/SessionCollaborationMaterials.tsx
  - src/components/agents/SessionCollaborationPanel.tsx
  - src/lib/host-api.ts
  - src/stores/session-collaboration.ts
  - tests/e2e/session-collaboration-material-lifecycle.spec.ts
  - tests/e2e/session-collaboration-material-reuse.spec.ts
  - tests/e2e/session-collaboration-material-search.spec.ts
  - tests/unit/session-collaboration-material-adoption.test.ts
  - tests/unit/session-collaboration-query.test.ts
  - tests/unit/session-collaboration-material-ollama.test.ts
  - tests/unit/session-collaboration-material-lifecycle.test.ts
  - tests/unit/session-collaboration-material-query.test.ts
  - tests/unit/session-collaboration-material-view.test.tsx
  - tests/unit/session-collaboration-context-host.test.ts
  - tests/unit/session-collaboration-context-read.test.ts
  - tests/unit/session-collaboration-panel.test.tsx
  - tests/unit/session-collaboration-shared-material.test.ts
  - tests/unit/session-collaboration-task-context.test.ts
  - tests/unit/session-collaboration-watch.test.ts
  - tests/unit/task-worktree-retention.test.ts
requiredRules:
  - session-collaboration-center-contract
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - 从可见会话读取原任务目标、检查点与证据，不取得写入资格。
  - 按任务、文件或主题发现材料，选中后回读精确版本及失效原因。
  - 材料面板保留进行中的读取，展开后展示结果并记录实际呈现。
  - 模型请求仅消费当次运行显式选择且仍有效的材料，留下来源与响应追溯。
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-material-ollama.test.ts --maxWorkers=1 --no-file-parallelism
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-context-host.test.ts tests/unit/session-collaboration-context-read.test.ts --maxWorkers=1 --no-file-parallelism
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-task-context.test.ts tests/unit/session-collaboration-shared-material.test.ts tests/unit/session-collaboration-material-query.test.ts tests/unit/session-collaboration-material-lifecycle.test.ts tests/unit/session-collaboration-material-adoption.test.ts --maxWorkers=1 --no-file-parallelism
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-material-view.test.tsx tests/unit/session-collaboration-panel.test.tsx tests/unit/session-collaboration-watch.test.ts tests/unit/task-worktree-retention.test.ts --maxWorkers=1 --no-file-parallelism
  - node node_modules/vitest/vitest.mjs run tests/unit/session-collaboration-query.test.ts tests/unit/session-collaboration-control-semantics.test.ts tests/unit/session-collaboration-delivery.test.ts tests/unit/durable-task-system.test.ts tests/unit/durable-task-tool.test.ts --maxWorkers=1 --no-file-parallelism
  - node scripts/contract-check.mjs
  - node scripts/i18n-lint.mjs
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/session-collaboration-c-mainline.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/session-collaboration-c-mainline.md --dry-run
acceptance:
  - 读取后按当前可见性、A2A 和来源关系复核材料及上下文；最终材料由最多四项的单次 Gateway 批次同步采集，载荷保留核验状态。
  - 载荷回调先处理引用再注入材料，无法识别的文本不带入正文；诊断字节数对应实际请求。无关任务事件不挤掉当前修订的证据。
  - 最终材料扫描超过长度或嵌套上限时中止请求，保留明确错误；嵌套 JSON 字符串仍核对原信封。
  - JSON 合法前导空白不跳过最终材料复核；原生 Ollama 等待异步载荷回调并发送其返回值，回执与实际请求一致。
  - 异步载荷处理后复核原材料状态；结构化剔除保持其余正文字面量，来源删除不扩大历史材料读取权限。
  - 任务上下文采用一致读取快照；异步后到期材料在最终载荷中移除；冲突扫描预算耗尽时保持 unknown。
  - 系统页的材料查询使用实际活动读取者；模型流支持标准 AsyncIterator，消费归属绑定原模型调用的任务和运行。
  - 任务上下文绑定当前活动读取者；读取者伪造、换代或切换工作区时清除旧结果，材料查询使用相同身份核对。
  - 原任务 owner 绑定发布来源、证据和版本，拒绝旧代、跨工作区及不匹配证据。
  - 查询和详情遵循相同可见性与原版本，撤销、替代、证据变化和过期可回读。
  - 面板折叠时完成的读取不丢失；再次展开时显示已选详情，旧请求不覆盖新搜索。
  - 候选、呈现、引用、模型请求消费与结果分别记录；裁剪或失效不产生消费回执。
  - 同候选定向回归、合同、四语、通信、规范校验通过，星驰独立开发验收通过。
  - 第一轮失败和历次候选保留；完整类型、构建、Electron 实跑及 CI 记录延期。
docs:
  required: true
  files:
    - docs/modules/sessions.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

本规格绑定当前主线上的 C1–C5 开发整合。原叶规格继续定义完整验收，历史报告保留原候选身份。开发记录回读每个命令的源哈希、退出码和测试结果；Electron 用例发现单独记录。

用户要求先完成开发。完整类型检查、Runtime 和桌面构建、Electron 实跑及 CI 待恢复集成验收后执行。
