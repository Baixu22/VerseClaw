---
id: architecture-review-and-integration
lifecycleStatus: active
diffBase: c97ea58faf2e66cc52cabe1df7f9c5b31bc387cd
title: 架构收敛独立审查、修复与主分支集成
type: task
intent: 以同模型独立审查定位架构收敛缺口，修复并在合并候选验证，保留主仓其他会话改动及历史证据，回收本轮进程和磁盘产物。
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - repository-artifact-retention
  - docs-sync
  - disk-temp-policy
ownedPaths:
  - scripts/contract-check.mjs
  - scripts/check-evidence-refs.mjs
  - scripts/check-semantic-authority-adjudication.json
  - scripts/repository-artifacts.json
  - shared/component-authority-manifest.ts
  - shared/dcs/component-disposition-catalog.ts
  - shared/product-semantics.ts
  - electron/services/sandbox-api.ts
  - electron/services/sandbox-state.ts
  - electron/services/workspace-runtime-sync.ts
  - electron/services/workspaces-api.ts
  - openclaw_runtime/src/agents/tools/context-agent-tools.ts
  - openclaw_runtime/src/agents/tools/context-view-tool-surface.ts
  - openclaw_runtime/src/context-engine/chat-turn-vtoken-injection.ts
  - openclaw_runtime/src/context-engine/cvk/engine.ts
  - openclaw_runtime/src/context-engine/cvk/identity.ts
  - openclaw_runtime/src/context-engine/enhancement-kill-switch.ts
  - openclaw_runtime/src/context-engine/registry.ts
  - tests/unit/architecture-*.test.ts
  - tests/unit/contract-check.test.ts
  - tests/unit/evidence-refs-exist.test.ts
  - tests/unit/product-semantics.test.ts
  - tests/unit/semantic-authority-consistency.test.ts
  - tests/unit/context-engine-registry-default-on.test.ts
  - tests/unit/sandbox-api.test.ts
  - tests/unit/workspace-runtime-sync.test.ts
  - tests/unit/workspaces-api.test.ts
  - tests/fixtures/contract-check/**
  - tests/fixtures/semantic-authority/**
  - harness/specs/fixtures/architecture-*/**
  - harness/specs/fixtures/ontology-lite-existing-contracts/negatives/known-wrong-endpoint.json
  - harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures/known-wrong-endpoint.json
  - harness/specs/fixtures/ontology-lite-existing-contracts/report/fixtures/validator-noop.json
  - harness/specs/tasks/architecture-*.md
  - harness/specs/rules/contract-first-boundary.md
  - docs/dev/architecture-skeleton/**
  - docs/dev/component-disposition-matrix-20261021.md
  - docs/clawx-product-semantics.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - .gitattributes
  - .gitignore
requiredTests:
  - pnpm exec vitest run tests/unit/contract-check.test.ts tests/unit/architecture-authority-convergence.test.ts tests/unit/product-semantics.test.ts tests/unit/evidence-refs-exist.test.ts --maxWorkers=1
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm repo:artifacts:check
  - pnpm harness validate --spec harness/specs/tasks/architecture-review-and-integration.md
  - git diff --check
acceptance:
  - 三个同模型只读审查覆盖IPC门禁、运行拆环与语义/证据，所有可执行发现修复并有失败到通过的复现。
  - 主仓提交合并在隔离树验证；重叠的未提交文件以原字节备份并三方合成，其他脏文件及暂存状态保留，不夹带其它会话改动。
  - 新合并候选使用明确命令和退出码验证相关架构/owner完整测试文件、类型、contract/authority/evidence、comms及原循环门禁，历史LOC和Agent Dev残差不伪装通过。
  - 代码与新证据提交并进入本地main，历史候选/验收包不重签；当前指针和交接指向合入后的路径。
  - 清理只针对本轮已确认归属的孤儿进程、已合入工作树和临时产物；先保存需要的本地原始证据索引，删除不跟随junction，回读进程/工作树/目录不存在及回收字节。
nonGoals:
  - 不提交或清理其它会话脏改动，不删除其它工作树或共享依赖，不改产品锁/默认值/公开发布状态。
  - 不重写Git历史或扩大为全仓所有历史残差整改；不宣称独立真人、GA或全产品性能收益。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
readmeUpdates: not-required
---

用户2026-11-06授权审查、修复、提交合并与清理。沿用gateway-backend-communication的现有owner。
审查修复在原候选上完成，合并验证以主仓最新提交为基准检查完整架构差异。
