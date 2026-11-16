---
id: architecture-skeleton-runtime-cycle-removal
lifecycleStatus: active
diffBase: e2ba2aa36814409b6ac7de042008ba9bb9527bb9
title: 拆除 runtime 跨领域的反向依赖
type: task
intent: 让上下文注册和配置解析只加载所需叶模块，消除 provider/plugin、context-engine 与 tool-schema 的 23 文件静态值依赖环，保持运行行为与公开导出。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - contract-first-boundary
  - repository-artifact-retention
  - docs-sync
  - task-forest-autoclose-and-roles
ownedPaths:
  - openclaw_runtime/src/context-engine/cvk/identity.ts
  - openclaw_runtime/src/context-engine/cvk/engine.ts
  - openclaw_runtime/src/context-engine/registry.ts
  - openclaw_runtime/src/context-engine/enhancement-kill-switch.ts
  - openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts
  - tests/unit/architecture-runtime-cycles.test.ts
  - tests/unit/context-engine-registry-default-on.test.ts
  - harness/specs/tasks/architecture-skeleton-runtime-cycle-removal.md
  - harness/specs/fixtures/architecture-runtime-cycles/**
  - docs/dev/architecture-skeleton/CHARTER.md
  - .gitattributes
requiredTests:
  - pnpm exec vitest run tests/unit/architecture-runtime-cycles.test.ts tests/unit/context-engine-registry-default-on.test.ts
  - pnpm exec vitest run tests/unit/model-capability-effective-state-tf0512.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/enhancement-kill-switch.test.ts src/context-engine/chat-turn-vtoken-injection.test.ts src/context-engine/assembler.kill-switch.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run runtime:source:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm repo:artifacts:check
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-runtime-cycle-removal.md
  - pnpm harness run --spec harness/specs/tasks/architecture-skeleton-runtime-cycle-removal.md --dry-run
  - git diff --check
acceptance:
  - 保留从当前基线重新扫描的原 checker 图、23 文件分量、源码哈希和三条反向依赖的逐项分析；不把上一叶子的图当作本叶验收。
  - registry 从 CVK 身份叶模块读取原 ID，engine 继续导出相同常量；两个配置解析模块直接消费 runtime-core/types 的原 isRecord，不改变逻辑、默认值或权限。
  - 原 check-import-cycles.ts 不改规则即 exit 0。用实际导入测试证明 registry 与配置解析不再加载 engine 或 runtime-core 总出口；相关注册、回退、kill switch、VToken 和能力状态测试通过。
  - 相关类型、scoped lint、契约、comms、构建入口与 Harness 的命令和退出码均读回。完整 runtime:source:check 及其六个原子门禁逐项运行，短路未覆盖的后续子门禁必须单独执行；相关失败须修复，继承失败须有同基线复现并保持失败口径。
  - 干净候选 commit/tree、全部限定证据、命令来源、SHA256SUMS 与零命中凭据扫描可从磁盘验证；之后按仓库规则自动收口、导出并保存本地交接。
nonGoals:
  - 不改变 plugin/provider 加载策略、schema 归一化、CVK 注册时序、回退、工具行为、产品锁或冻结默认。
  - 不新增运行时 authority、通用依赖注入平台或第二状态存储，不借机修复无关历史全仓失败。
  - 静态值依赖图不覆盖动态 import、require、非相对包边界或全程序执行效果；不据此声称全仓健康、收益、GA 或发布就绪。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: not-required
---

TF-0789（父 TF-0786，根 TF-0628）接续已关闭的 TF-0788。
`gateway-backend-communication` 是本叶遵守的现有 Runtime 集成场景。
实施前重新扫描 9158 文件，确认仍为同一 23 文件分量。

基线图的三条反向边是 registry → cvk/engine、enhancement-kill-switch →
runtime-core/index、chat-turn-vtoken-injection → runtime-core/index。
对三条边的七种非空删边组合做图分析：只有同时消除三条边才清空所有分量。
前者只需共享现有引擎 ID，后两者只需直接导入原 isRecord 所在叶文件；
不需要改 provider、plugin、tool-schema 或能力事实构建器的行为。

runtime 单文件测试与静态门禁从 runtime 目录通过原 node wrapper 执行，
避免 pnpm 在 linked worktree 中自动重装共享依赖。正式验收额外执行根
runtime:source:check，并逐项保留六个子门禁退出码。所有临时文件写 D:/tmp。
README 三语复核后记录是否需要更新；只做内部静态依赖重排时不改变产品说明。
