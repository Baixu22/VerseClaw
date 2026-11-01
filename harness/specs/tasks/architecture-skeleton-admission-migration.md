---
id: architecture-skeleton-admission-migration
lifecycleStatus: active
title: 接入层收敛 A3：迁移 4 个活体消费者到类型化入口
type: task
intent: 把 ADMISSION-INVENTORY §6 裁定为 migrate→retire 的 4 条扁平 channel 的全部活体消费者（shell:openExternal 的 4 处 renderer 包装调用；settings:getAll / usage:recentTokenHistory / provider:save 的 7 处 E2E 直接 invoke）改到唯一入口（hostApi.shell.openExternal / window.verseClaw.hostInvoke），使这 4 条扁平入口不再有任何 renderer 或测试侧消费者；不删 handler、不改 preload、不动 E2E mock 缝。
requiredRules:
  - renderer-main-boundary
  - contract-first-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
ownedPaths:
  - src/components/channels/ChannelConfigModal.tsx
  - src/pages/Settings/index.tsx
  - tests/e2e/dcs-prod-p0-settings.spec.ts
  - tests/e2e/settings-memory-embedding.spec.ts
  - tests/e2e/settings-proxy.spec.ts
  - tests/e2e/telemetry-consent.spec.ts
  - tests/e2e/token-usage.spec.ts
  - tests/e2e/provider-lifecycle.spec.ts
  - scripts/contract-check-flat-ipc.json
  - docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md
  - harness/specs/tasks/architecture-skeleton-admission-migration.md
humanEvidence: not-required
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-admission-migration.md --no-diff
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm exec eslint src/components/channels/ChannelConfigModal.tsx src/pages/Settings/index.tsx tests/e2e/dcs-prod-p0-settings.spec.ts tests/e2e/settings-memory-embedding.spec.ts tests/e2e/settings-proxy.spec.ts tests/e2e/telemetry-consent.spec.ts tests/e2e/token-usage.spec.ts tests/e2e/provider-lifecycle.spec.ts --max-warnings 0
  - pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/contract-check.test.ts --maxWorkers=1
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/dcs-prod-p0-settings.spec.ts
  - pnpm run test:e2e:run tests/e2e/settings-memory-embedding.spec.ts
  - pnpm run test:e2e:run tests/e2e/settings-proxy.spec.ts
  - pnpm run test:e2e:run tests/e2e/telemetry-consent.spec.ts
  - pnpm run test:e2e:run tests/e2e/token-usage.spec.ts
  - pnpm run test:e2e:run tests/e2e/provider-lifecycle.spec.ts
  - node scripts/check-no-bom.mjs
  - node scripts/check-repository-artifacts.mjs
  - node scripts/check-local-paths.mjs
  - pnpm harness:specs:lifecycle
  - git diff --check
acceptance:
  - src/ 中 window.electron.openExternal 的调用为 0（grep -rnE "window\.electron(\?)?\.openExternal" src/ 无命中），4 处位点改为 hostApi.shell.openExternal(url)；相关组件既有单测与 E2E 通过。
  - tests/e2e 中对 settings:getAll、usage:recentTokenHistory、provider:save 的 window.electron.ipcRenderer.invoke 直接调用为 0（grep -rhoE "window\.electron\.ipcRenderer\.invoke\('[^']+'" tests/e2e/ 无命中），改为经 window.verseClaw.hostInvoke 的 settings.getAll / usage.recentTokenHistory / providers.save，请求形状符合 shared/host-api/types.ts 的 HostRequest，payload 符合 shared/host-api/contract.ts 的类型化 action 签名；fixture 的 mock 缝（gateway:status/rpc、file:stat/readText）与 handler 本身不在本叶范围。
  - 受影响的 6 个 E2E spec（dcs-prod-p0-settings、settings-memory-embedding、settings-proxy、telemetry-consent、token-usage、provider-lifecycle）在 Electron 下真实运行并逐条记录 exit code；无法运行的逐条写明环境原因，且不得解读为通过。
  - pnpm contract:check 仍通过；scripts/contract-check-flat-ipc.json 中 shell:openExternal / settings:getAll / usage:recentTokenHistory / provider:save 四条的迁移状态已更新为 consumers-migrated（含节点、日期与候选 commit），disposition 仍为 migrate（退役属 A5），且与 ADMISSION-INVENTORY §12 一致。
  - pnpm run typecheck 全量绿；改动文件 eslint 0 warning；git diff --check 0。
  - 无权限路径、默认值、产品锁改动：git diff 对 electron/、shared/、docs/dev/default-config-matrix.md 为 0；不新增 Host API action；不改 preload 白名单。
  - ADMISSION-INVENTORY.md 新增 §12 "A3 迁移记录"：每处位点（文件:行）、改前、改后、6 个 spec 的 exit code、门禁命令与 exit code、未运行项；全部产物 driven_by: agent。
nonGoals:
  - 不删除任何 ipcMain.handle、不改 preload 白名单或 electronAPI.openExternal 包装（A5 / TF-0651）。
  - 不改写 gateway:status / gateway:rpc / file:stat / file:readText 的 E2E mock 缝与 tests/e2e/fixtures/electron.ts 的 legacy-override 分支（A4 / TF-0650）。
  - 不修改 electron/main/ipc-handlers.ts、electron/preload/index.ts、shared/host-api/contract.ts、src/lib/host-api.ts；不新增 Host API 模块或 action；不新增 package script。
  - 不改权限路径（host:invoke 的 senderAuth 与 HostApiRegistry）、默认值、产品锁、默认矩阵、发布状态或 GA 口径。
  - 不要求全量 pnpm test 或全量 E2E；未运行项如实记 not-run。
  - 不引入任何以真人操作或真人数据为前置的验收条件。
docs:
  required: true
  files:
    - docs/dev/architecture-skeleton/CHARTER.md
    - docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md
---

# 接入层收敛 A3：迁移 4 个活体消费者到类型化入口

## 背景与输入

批次 A 实际收敛的第一步（A3，Task Forest `TF-0649`，父 `TF-0628`）。宪章
`docs/dev/architecture-skeleton/CHARTER.md` §2.1 第 4 条（2026-11-01 修订）授权批次 A 的实际收敛，
§5 批次 A 把它拆为 A3（本叶）→ A4（`TF-0650` 改写 E2E mock 缝）→ A5（`TF-0651` 退役扁平通道与 preload
第二入口）→ A6（`TF-0652` 兼容回归）四个串行叶子。

输入是 `docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md` §4 扁平表与 §6 裁定表中
disposition 为 **migrate → retire** 的 4 条 channel，以及 `scripts/contract-check-flat-ipc.json`
中对应的 `removalPlan`：

| channel | 唯一入口 | 活体消费者（迁移位点） |
|---|---|---|
| `shell:openExternal` | `hostApi.shell.openExternal(url)` | renderer 4 处 / 2 文件，经 preload 包装 `window.electron.openExternal`：`src/components/channels/ChannelConfigModal.tsx:423-424`、`src/pages/Settings/index.tsx:2289,2292,2295` |
| `settings:getAll` | `host:invoke` → `settings.getAll` | E2E 4 spec 的 `page.evaluate(() => window.electron.ipcRenderer.invoke('settings:getAll'))`：`dcs-prod-p0-settings.spec.ts:41`、`settings-memory-embedding.spec.ts:14`、`settings-proxy.spec.ts:14`、`telemetry-consent.spec.ts:6` |
| `usage:recentTokenHistory` | `host:invoke` → `usage.recentTokenHistory` | `tests/e2e/token-usage.spec.ts:106,129` |
| `provider:save` | `host:invoke` → `providers.save` | `tests/e2e/provider-lifecycle.spec.ts:8-14` |

本叶只改**消费者**。handler、preload 白名单、`electronAPI.openExternal` 包装的退役属 A5；
`gateway:*` / `file:*` 的 E2E mock 缝改造属 A4。

## 迁移形状

### renderer（`shell:openExternal`）

`window.electron.openExternal(url)` → `hostApi.shell.openExternal(url)`（facade 已存在于
`src/lib/host-api.ts`，renderer 既有 25 处 / 20 文件在用；返回 `Promise<void>`，既有用法以
`void …` 或 `.catch(() => …)` 处理）。`ChannelConfigModal.openDocs` 保留 `window.open` 作为
失败回退；`Settings` About 区三条链接改为 `void hostApi.shell.openExternal(...)`。

### E2E 直接 invoke（`settings:getAll` / `usage:recentTokenHistory` / `provider:save`）

在 `page.evaluate` 内改为 `window.verseClaw.hostInvoke({ id, module, action, payload })`
（`HostRequest`，`shared/host-api/types.ts`；`window.verseClaw` 由 `src/types/electron.d.ts` 声明，
`tsconfig.test.json` 已包含该声明），响应为 `HostResponse` 信封 `{ ok, data } | { ok, error }`，
`ok !== true` 时抛错而不是静默返回 `undefined`：

| 旧 | 新 payload（类型化签名） |
|---|---|
| `invoke('settings:getAll')` | `{ module: 'settings', action: 'getAll' }` → `SettingsSnapshot` |
| `invoke('usage:recentTokenHistory', 20)` | `{ module: 'usage', action: 'recentTokenHistory', payload: { limit: 20 } }` → `UsageHistoryEntry[]` |
| `invoke('provider:save', config)` | `{ module: 'providers', action: 'save', payload: { config } }` → `HostSuccess`（`{ success, error? }`） |

类型化 `providers.save` 与扁平 `provider:save` 在 Main 侧走同一条
`_saveProviderInternal` + `syncSavedProviderToRuntime` 路径（`saveLegacyProvider` 只是加了弃用日志的
委托），行为等价；`usage.recentTokenHistory` 的 `{ limit }` 由 `getSafeLimit` 解析，与扁平侧的
`Math.max(Math.floor(limit), 1)` 等价。

`tests/e2e/fixtures/electron.ts` 的 `host:invoke` 拦截器只在 spec 通过 `installIpcMocks` 登记了
`/api/settings` 或 `/api/usage/recent-token-history` 时才短路这两个 action；受影响 6 个 spec 均未登记，
因此调用到达真实服务。

## 写集与硬边界

只允许改动 frontmatter `ownedPaths`。**禁止**改动 `electron/**`、`shared/**`、
`docs/dev/default-config-matrix.md`、`src/lib/host-api.ts`、`src/lib/host-api-client.ts`、
`tests/e2e/fixtures/**`、`package.json`、`scripts/contract-check.mjs`。

`scripts/contract-check-flat-ipc.json` 的 4 条只追加 `migration` 对象（`status: consumers-migrated`、
`node`、`migratedOn`、`commit`、`consumersBefore`）并把 `removalPlan` 改写为"消费者已迁移；A5 退役
handler + 白名单"；`disposition` 保持 `migrate`，`typedModule` / `typedAction` / `preload` / `reason`
不变。`pnpm contract:check` 不读取 `migration` 字段，正例必须仍 exit 0。

## E2E 运行环境（Windows，本检出）

`D:\ClawX` 为 Low-integrity 目录，Electron 只能写同完整性级别的路径：`TEMP` / `TMP` 指向
`<repo>/.local/tmp`，`CLAWX_E2E_RUN_ROOT` 指向 `<repo>/.local/e2e`，`unset ELECTRON_RUN_AS_NODE`；
renderer 改动需先 `pnpm run build:vite`，再逐个 `playwright test tests/e2e/<spec>.ts`。pnpm 包装命令
以 `--config.verify-deps-before-run=false` 调用以绕过 pnpm 11 的交互式 modules-purge 提示（不安装任何
东西）。每个 spec 的 exit code 由 shell 捕获并记入 ADMISSION-INVENTORY §12；无法运行的写明环境原因，
不得解读为通过。

## 证据回读与收口

| 验收条 | 证据 | 回读方式 |
|---|---|---|
| 1 renderer 0 处 | `grep` 无命中；两份源码 diff | Read 源码 / grep 退出码 1 |
| 2 E2E 直接 invoke 0 处 | `grep` 无命中；6 份 spec diff | Read 源码 / grep 退出码 1 |
| 3 六个 spec 真实运行 | 每个 spec 的 Playwright 日志与 exit code | Read `D:/tmp/tf0649/e2e-<spec>.log` 尾部与 exit 行 |
| 4 清单更新 + contract:check | `scripts/contract-check-flat-ipc.json` 四条 `migration`；`contract:check` exit 0 | Read JSON / 日志 |
| 5 typecheck / eslint / diff --check | 各命令 exit 0 | Read 日志 |
| 6 禁改路径 diff = 0 | `git diff --stat -- electron/ shared/ docs/dev/default-config-matrix.md` 为空 | Read 命令输出 |
| 7 §12 迁移记录 | ADMISSION-INVENTORY.md §12 | Read 文档 |

收口按 `AGENTS.md` §Task Forest closure policy 与 `harness/specs/rules/task-forest-autoclose-and-roles.md`：
全部验收条由磁盘产物核实、`base_graph_hash` 仍匹配、`todo --json` 中 stored-status `ready` 恰为 TF-0649，
则 `proposal-save` → `proposal-apply --yes` → `validate` → `export`，同一提案把 TF-0650（A4）置 ready。
未运行的全量门禁（全量 `pnpm test`、全量 E2E、lint 全仓、agent-dev、live provider）如实记 `not-run`。
所有产物 `driven_by: agent`。

## 验收

见 frontmatter `acceptance`。
