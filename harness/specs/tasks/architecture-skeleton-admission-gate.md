---
id: architecture-skeleton-admission-gate
lifecycleStatus: active
title: 让 contract:check 覆盖扁平 IPC 接入面
type: task
intent: 在不新增 package script、不迁移任何 handler 的前提下，让既有 pnpm contract:check 对扁平 IPC（ipcMain.handle）接入面 fail-closed：未登记的 channel、双入口同域冲突、绕过 HostApiRegistry 的新增通道都必须被拒绝。
requiredRules:
  - contract-first-boundary
  - renderer-main-boundary
  - repository-artifact-retention
ownedPaths:
  - scripts/contract-check.mjs
  - scripts/contract-check.d.mts
  - scripts/contract-check-flat-ipc.json
  - scripts/repository-artifacts.json
  - .gitignore
  - tests/unit/contract-check.test.ts
  - tests/fixtures/contract-check/**
  - docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md
  - docs/dev/architecture-skeleton/ADMISSION-GATE.md
  - harness/specs/tasks/architecture-skeleton-admission-gate.md
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/architecture-skeleton-admission-gate.md
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-admission-gate.md
  - pnpm contract:check
  - pnpm exec vitest run tests/unit/contract-check.test.ts
  - git diff --check
acceptance:
  - contract:check 在现有功能上保持通过，不新增 package script。
  - 门禁能从磁盘枚举扁平 IPC channel，并与类型化模块名做交集检查。
  - 独立负例证明：新增未登记 channel、双入口同域冲突、绕过 HostApiRegistry 的通道各自被拒绝，且诊断可定位到 channel 名与规则。
  - 负例通过真实门禁入口执行，而不是只单测 checker 自身；错误输入不能产生有效 pass。
  - 现有 43 个扁平 channel 与 58 个类型化模块的既有行为、顺序与命名保持不变；不迁移、不改名、不改默认值。
nonGoals:
  - 不迁移任何 handler 到类型化 Host API；迁移属于后续节点。
  - 不新增 Host API 模块、不新增运行时组件、不改 IPC 实现。
  - 不改变产品锁、默认矩阵、发布状态或 GA 口径。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
    - docs/dev/architecture-skeleton/ADMISSION-GATE.md
---

# 让 contract:check 覆盖扁平 IPC 接入面

## 背景

架构骨架收敛批次 A 的第二步。依赖 `architecture-skeleton-admission-inventory` 的裁定结果。

`scripts/contract-check.mjs` 当前解析 `shared/host-api/contract.ts`、`src/lib/host-api.ts` 与 `ipc-handlers.ts` 中的 `registerCoreServices` 块，但不检查同一文件里的 `ipcMain.handle('x:y', ...)`。

## 本轮范围

把扁平 IPC 通道纳入同一门禁的枚举与冲突检查。复用现有入口。

## 判定规则（最小集）

1. 每个扁平 channel 必须出现在声明清单里（清单来源在盘点节点确定）。
2. 同一前缀不得同时是类型化模块与扁平 channel，除非显式登记为兼容例外并写明理由与移除计划。
3. 新增 channel 未经登记即失败。

## 负例要求

三类坏例必须各自被拒绝，且失败信息能定位到 channel 名与所触规则：

- 未登记 channel；
- 双入口同域冲突；
- 绕过 `HostApiRegistry` 直接注册的通道。

坏例要经过真实门禁入口（`pnpm contract:check`）验证，不能只调用 checker 函数。

## 边界

- 不迁移 handler，不改名，不改顺序。
- 需要新增清单文件时，放在既有 evidence/docs 根下，不新建顶层目录。

## 落地形态（TF-0630，2026-10-31）

- 冻结清单：`scripts/contract-check-flat-ipc.json`（`ContractCheckFlatIpcAdjudication/v1`），是 `docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md` §6 裁定表的机器形式，每个扁平 channel 记 `typedModule` / `typedAction` / `preload` / `disposition` / `reason`，`migrate` 与 `freeze` 另记 `removalPlan`；preload 悬空条目单列。
- 门禁入口不变：`pnpm contract:check`。负例经同一入口的 `--fixture <json>` 模式执行（只在读入后改写文本，不触盘），fixture 在 `tests/fixtures/contract-check/`，坏 fixture 以 exit 2 与门禁失败的 exit 1 区分。
- 规则、诊断格式与证据见 `docs/dev/architecture-skeleton/ADMISSION-GATE.md`。

## 验收

见 frontmatter `acceptance`。