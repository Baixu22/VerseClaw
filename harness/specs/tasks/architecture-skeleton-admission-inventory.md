---
id: architecture-skeleton-admission-inventory
lifecycleStatus: active
title: 接入层盘点与唯一入口裁定
type: task
intent: 把当前 renderer 与 Main 之间的全部接入通道（类型化 Host API、扁平 IPC、extension contribution）从磁盘枚举出来，为每个通道指定唯一入口与 owner，并把无法判定的记为 gap；本轮只做只读盘点与裁定，不迁移、不删除、不改运行时行为。
requiredRules:
  - contract-first-boundary
  - renderer-main-boundary
  - repository-artifact-retention
ownedPaths:
  - docs/dev/architecture-skeleton/CHARTER.md
  - docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md
  - harness/specs/tasks/architecture-skeleton-admission-inventory.md
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/architecture-skeleton-admission-inventory.md
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-admission-inventory.md --no-diff
  - pnpm contract:check
  - git diff --check
acceptance:
  - 盘点结果由磁盘静态读取产生，列出每个接入通道的模块名/通道名、当前文件与行号、owner 与消费者。
  - 类型化 Host API 模块、extension contribution 模块与扁平 IPC channel 三类分别计数，并列出三者之间的交集。
  - 至少对「同一领域同时存在类型化入口与扁平入口」给出逐条裁定：保留哪一个是唯一入口、另一个的处置（迁移/冻结/退役），以及无法判定的 gap。
  - 裁定结果不改变任何运行时路径、默认值、权限或 UI 行为，也不新增 Host API 模块。
  - 文档明确标注本节点只产出盘点与裁定，不产出实现，且所有计数可由命令离线复现。
nonGoals:
  - 不迁移、不删除、不改写任何 IPC handler 或 Host API facade。
  - 不新增 Host API 模块、不新增 package script、不新增运行时组件。
  - 不改变产品锁、默认矩阵、发布状态或 GA 口径。
  - 不声称任何性能、收益、采用率或端到端效果。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
---

# 接入层盘点与唯一入口裁定

## 背景

架构骨架收敛批次 A 的第一步。见 `docs/dev/architecture-skeleton/CHARTER.md` 第 1.1 节与第 5 节。

当前同时存在两条 renderer↔Main 接入面：类型化 Host API（`shared/host-api/contract.ts` + `src/lib/host-api.ts` + `HostApiRegistry`）与扁平 IPC（`electron/main/ipc-handlers.ts` 的 `ipcMain.handle`）。`pnpm contract:check` 只覆盖前者。

## 本轮范围

只读盘点 + 裁定。产出 `docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md`。

## 必须回答的问题

1. 类型化 Host API 模块总数，以及每个模块对应的服务实现文件。
2. extension contribution 贡献的模块（当前已知 `electron/extensions/builtin/diagnostics.ts` 贡献 `diagnostics`）。
3. 扁平 IPC channel 总数与全部前缀。
4. 哪些前缀同时是类型化模块名（即双入口领域），以及每个双入口领域里两者的实际消费者。
5. 对每个双入口领域：唯一入口裁定 + 另一个的处置与迁移位点，或记为 gap 并写清缺什么证据才能判定。

## 边界

- 只读。不得修改 `electron/main/ipc-handlers.ts`、`src/lib/host-api.ts`、`shared/host-api/contract.ts`。
- 不得新增或改名任何 channel / action。
- 计数必须能由仓库内命令离线复现，并在文档中写出命令。

## 验收

见 frontmatter `acceptance`。盘点文档必须能被未读过本会话的人直接使用：每个通道都有文件与行号锚点。