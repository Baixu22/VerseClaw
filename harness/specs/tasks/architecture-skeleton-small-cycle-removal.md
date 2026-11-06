---
id: architecture-skeleton-small-cycle-removal
lifecycleStatus: active
diffBase: dc7fbf3cc0a901b1ef413e7b91b86e4129fb795f
title: 解除 workspace 服务和 context 工具的小规模依赖环
type: task
intent: 调整既有状态读取与常量的依赖方向，消除 workspace/sandbox/runtime-sync 三文件环和 context-agent-tools/context-view-tool-surface 两文件环，保持公开 API 与运行行为。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - contract-first-boundary
  - repository-artifact-retention
  - docs-sync
  - task-forest-autoclose-and-roles
ownedPaths:
  - electron/services/workspaces-api.ts
  - electron/services/workspace-runtime-sync.ts
  - electron/services/sandbox-api.ts
  - electron/services/sandbox-state.ts
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/src/agents/tools/context-view-tool-surface.ts
  - tests/unit/workspace-runtime-sync.test.ts
  - tests/unit/workspaces-api.test.ts
  - tests/unit/sandbox-api.test.ts
  - tests/unit/context-view-tool-surface.test.ts
  - tests/unit/architecture-small-cycles.test.ts
  - harness/specs/tasks/architecture-skeleton-small-cycle-removal.md
  - harness/specs/fixtures/architecture-small-cycles/**
  - docs/dev/architecture-skeleton/CHARTER.md
  - scripts/repository-artifacts.json
  - .gitignore
  - .gitattributes
requiredTests:
  - pnpm exec vitest run tests/unit/workspace-runtime-sync.test.ts tests/unit/workspaces-api.test.ts tests/unit/sandbox-api.test.ts tests/unit/context-view-tool-surface.test.ts tests/unit/architecture-small-cycles.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts src/agents/tools/context-agent-tools.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm repo:artifacts:check
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-small-cycle-removal.md
  - pnpm harness run --spec harness/specs/tasks/architecture-skeleton-small-cycle-removal.md --dry-run
  - git diff --check
acceptance:
  - 盘上保存当前候选的静态值依赖图和基线图；workspace 三文件环与 context 两文件环消失，重新注入任一反向边仍被图检查拒绝。
  - workspace 服务提供活动 workspace 读取函数；同步叶模块不反向加载 API。沙箱服务与同步复用同一状态 owner；store 名称、profile 回退和策略解析行为保持原样。
  - 工具工厂继续导出原来的四个名称；名称、顺序、目录 digest、注册条件和执行行为由现有 owner 测试验证。
  - 相关 owner 测试、完整 node/web/test 类型、契约、scoped lint、comms replay/compare 与 Harness 检查通过；保留命令退出码、测试 JSON 和干净候选 commit/tree。
  - 原 runtime import-cycle 门禁重新运行并记录完整剩余分量。本叶子只消除已指定小环；剩余大分量归 TF-0789，不能据此宣称全图无环或全仓通过。
  - 精选最终证据有完整 SHA256SUMS 和零命中凭据扫描，读回后更新本地任务图并导出；历史与产品冻结边界保持。
nonGoals:
  - 不迁移 workspace 存储，不改变工作区切换/同步时序、权限默认值、sandbox 回退或 Gateway 重启行为。
  - 不增加新的 runtime authority、注册表、依赖或通用架构平台。
  - 本轮不修改 23 文件 runtime 分量、陈旧权威声明、UI 或发布范围。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: not-required
---

TF-0788（父 TF-0786，根 TF-0628）续接上一叶子的独立分支。
`gateway-backend-communication` 是 Main/Runtime 接入边界，内部依赖重排不改变其
Host API 或 transport 合同。README 三语按 docs-sync 复核。

已确认的基线边：sandbox-api → workspaces-api → workspace-runtime-sync，后者同时
导入 sandbox-api 和 workspaces-api；context 工具工厂导入目录状态，目录又从工厂
再导出四个常量。以函数参数注入 workspace 读取器，移动既有 sandbox 状态函数为
单一共享叶模块，并由目录持有名称常量即可去环。

runtime 单文件测试从 runtime 目录通过 scripts/run-vitest.mjs 执行；requiredTests
中的命令供 Harness 选择与追溯，实际运行直接调用 node wrapper，执行记录保存 cwd 和 argv。原完整循环检查
通过 node --import tsx scripts/check-import-cycles.ts 从 runtime 目录运行，不修改其规则。

基线 sandbox-api 的只读断言仍预期 workspaceAccess=none，而冻结 mapper 和现有
同步测试均为 ro；基线复跑确认同一失败。本叶子只把该断言对齐现有只读语义，
不改 mapper 或权限规则，并保留基线失败证据与修复说明。
