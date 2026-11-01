# 扁平 IPC 接入面门禁（ADMISSION-GATE）

> 状态：`implemented`（批次 A / A1；只加静态门禁，**不迁移、不删除、不改名**任何 channel / action / handler / facade）
> 节点：`TF-0630`（父 `TF-0628` 架构骨架收敛；依赖 `TF-0629`）
> 合同：`harness/specs/tasks/architecture-skeleton-admission-gate.md`
> 输入：`docs/dev/architecture-skeleton/ADMISSION-INVENTORY.md` §4 / §6 / §7
> 录入日期：2026-10-31，Asia/Shanghai
> 产出者：agent（`driven_by: agent`，`actor: claude-fable-5`）；本文件不含任何真人操作或真人数据

本文件回答一个问题：**`pnpm contract:check` 现在对接入面 C（扁平 `ipcMain.handle`）、preload 白名单与 `HostApiContract` 别名成员是如何 fail-closed 的，以及如何离线证明坏例被拒绝。**

---

## 0. 基线

| 项 | 值 |
|---|---|
| 开工 HEAD | `8a9d173c012c8318cf18fe76a67c0f4c49e61994`（TF-0629 候选） |
| 开工 tree | `8f5cb4fc826a20babd7baa057a864a27c60fbf63` |
| 开工工作区 | `git status --porcelain` 0 行 |
| 门禁入口 | `pnpm contract:check` → `node scripts/contract-check.mjs`（`package.json:127`，**未新增 package script**） |
| 运行时改动 | **0**：未修改 `electron/main/ipc-handlers.ts`、`electron/main/ipc/host-invoke.ts`、`electron/preload/index.ts`、`shared/host-api/contract.ts`、`shared/types/change-context.ts`、`src/lib/host-api.ts` 或任何 service |

---

## 1. 结论摘要

| 项 | 本轮前 | 本轮后 |
|---|---|---|
| `parseContractActions` 看到的 `HostApiContract` 模块 | 57（跳过别名成员） | **58**（`changeContext` 的 8 个 action 参与 facade / `invokeHost` 对账） |
| 扁平 `ipcMain.handle` channel 受门禁 | 0 / 43 | **43 / 43**，每条必须在冻结清单中有裁定 |
| 冻结清单 | 无（§6 为人工表格） | `scripts/contract-check-flat-ipc.json`：35 retire / 4 migrate / 4 freeze |
| preload `validChannels` 受门禁 | 0 / 44 | **44 / 44** 双向对账；2 条不可达 handler 与 3 条悬空 `env:*` 显式登记 |
| `ipcMain.handle` 出现在 `ipc-handlers.ts` 与 `host-invoke.ts` 之外 | 不检查 | 任何出现即 `[flat-ipc/bypass-registry]` |
| 负例 | 无 | 8 个 fixture，全部经真实入口 exit 1，各产生恰好 1 条可定位诊断 |
| 正例（当前仓库） | 通过 | 通过（`Contract check passed.`，exit 0） |

---

## 2. 冻结清单：`scripts/contract-check-flat-ipc.json`

schema `ContractCheckFlatIpcAdjudication/v1`。它是 ADMISSION-INVENTORY §6 裁定表的机器形式；43 条 `channels` 按 `electron/main/ipc-handlers.ts` 源码顺序排列。

| 字段 | 含义 | 校验 |
|---|---|---|
| `channel` | `ipcMain.handle` 第一参数字面量 | 必须与源码双向一致（`unregistered-channel` / `stale-registry-entry`） |
| `typedModule` | 该领域的唯一入口（类型化模块名） | 必须等于前缀的类型化解析结果（字面或单复数近似）；否则 `dual-entry-unacknowledged` |
| `typedAction` | 逐条对应的类型化 action，无则 `null` | 非 `null` 时必须存在于 `HostApiContract`（`typed-action-missing`） |
| `preload` | `allowlisted` / `unreachable` | 必须与 `validChannels` 实际成员一致（`preload-mismatch`） |
| `disposition` | `retire` / `migrate` / `freeze` | 枚举外失败（`invalid-disposition`） |
| `reason` | 为什么允许该双入口暂存 | 空即失败（`dual-entry-unacknowledged`） |
| `removalPlan` | `migrate` / `freeze` 的退出路径 | 这两类缺失即失败（`removal-plan-missing`） |

另有 `danglingAllowlistEntries`（3 条 `env:*`，各带 `disposition` + `reason`）、`handlersFile`、`allowlistFile`、`hostInvoke`。

**与 §6 的差异**：§6 汇总行把 retire 写成 32，逐行相加实为 35（4+2+3+4+2+5+11+4）；机器清单以逐行裁定为准，§6 已加勘误，裁定内容未变。

---

## 3. 规则（全部离线、静态、无密钥）

诊断格式统一为 `<file>[:<line>]: [<family>/<rule>] <message>`，其中 `<file>` 指向最适合修复的位置（源码行、preload、或清单文件）。

### 3.1 别名成员（接入面 A 的解析盲区）

| 规则 | 触发 |
|---|---|
| `host-api/unresolved-alias-member` | `HostApiContract` 中 `x: SomeType;` 形式的成员，其 `SomeType` 既不在 `contract.ts` 也不在其 `import type { … } from './…'` 相对导入的定义文件中 |
| （既有）`missing hostApi.<m>.<a> facade` / `does not call invokeHost(...)` | 别名成员解析成功后，与内联模块走**同一条**对账循环 |

解析方式：`parseContractAliasMembers` 只在 `HostApiContract` 块内匹配；`parseContractTypeImports` 读相对 `import type`；`readAliasTypeTexts` 把 `shared/host-api/../types/change-context` 解析到 `shared/types/change-context.ts`（或 `/index.ts`）。无需手工维护类型→文件映射。

### 3.2 扁平 IPC（接入面 C）

| 规则 | 触发 | 对应合同判定 |
|---|---|---|
| `flat-ipc/unregistered-channel` | `ipc-handlers.ts` 中的 `ipcMain.handle('x:y')` 不在清单 | 规则 1、3（未登记即失败） |
| `flat-ipc/stale-registry-entry` | 清单有、源码无 | 清单与源码不得漂移 |
| `flat-ipc/dual-entry-unacknowledged` | 前缀落在类型化领域，但 `typedModule` 不符或 `reason` 为空 | 规则 2（双入口须显式登记并写明理由） |
| `flat-ipc/removal-plan-missing` | `migrate` / `freeze` 无 `removalPlan` | 规则 2（移除计划） |
| `flat-ipc/no-typed-domain` | 前缀既非类型化模块名也非其单数形式 | 扁平 channel 不得拥有独占领域 |
| `flat-ipc/typed-action-missing` | `typedAction` 不在 `HostApiContract` | 清单不得指向不存在的 action |
| `flat-ipc/invalid-disposition` / `invalid-preload-state` / `duplicate-registry-entry` | 清单字段非法 | 清单自洽 |
| `flat-ipc/bypass-registry` | `electron/**/*.ts` 中任何 `ipcMain.handle` 不在 `ipc-handlers.ts`，且不是 `host-invoke.ts` 的 `host:invoke` | 绕过 `HostApiRegistry` 的通道 |
| `flat-ipc/non-literal-channel` | `ipcMain.handle(<非字符串字面量>)` | 无法枚举即失败 |
| `flat-ipc/typed-entry-missing` | `host-invoke.ts` 中找不到 `ipcMain.handle('host:invoke')` | 唯一类型化入口必须存在 |

枚举口径：递归扫描 `electron/**/*.ts`（排除 `*.test.ts` / `*.spec.ts` / `*.d.ts` / `node_modules` / `dist` / `__tests__`），对含 `ipcMain.handle(` 的文件做正则 `ipcMain\.handle\(\s*([^,)]+)`，多行写法一并覆盖。

### 3.3 preload 白名单

| 规则 | 触发 |
|---|---|
| `flat-ipc/allowlist-missing` | 找不到 `const validChannels = [ … ];` |
| `flat-ipc/allowlist-duplicate` | 白名单内重复 |
| `flat-ipc/preload-mismatch` | 某 handler 在白名单中的实际状态与清单 `preload` 不一致 |
| `flat-ipc/allowlist-dangling` | 白名单条目无 handler，且未在 `danglingAllowlistEntries` 登记 |
| `flat-ipc/dangling-unacknowledged` | 登记的悬空条目缺 `disposition` / `reason` |
| `flat-ipc/stale-dangling-entry` | 登记为悬空，但已不在白名单或已有 handler |

### 3.4 fail-closed 的输入缺失

清单未加载、站点未枚举、preload 文本缺失，各自产生 `registry-missing` / `sites-missing` / `allowlist-missing`，而不是静默跳过。

---

## 4. 负例 fixture 与真实入口

fixture 在 `tests/fixtures/contract-check/*.json`（schema `ContractCheckFixture/v1`）。每个 fixture 声明对若干仓库文件的**内存改写**（`find`/`replace`、`append`、`prepend`；按目标文件自身的 EOL 归一化），由同一入口加载：

```bash
node scripts/contract-check.mjs --fixture tests/fixtures/contract-check/<name>.json
```

- 改写只发生在读入之后，**不触盘**；其余文件仍读真实仓库，因此每个 fixture 恰好触发一条规则。
- 门禁失败 → exit **1**；fixture 自身坏（文件不存在、`find` 不命中、无 `mutations`）→ exit **2**，与门禁失败可区分。
- 不带 `--fixture` 的默认行为与改动前完全一致（这正是 `pnpm contract:check`）。

| fixture | 改写 | 期望诊断（节选） | exit |
|---|---|---|---|
| `flat-ipc-unregistered-channel` | `ipc-handlers.ts` 末尾追加 `ipcMain.handle('rogue:thing', …)` | `electron/main/ipc-handlers.ts:1748: [flat-ipc/unregistered-channel] ipcMain.handle('rogue:thing') is not adjudicated in scripts/contract-check-flat-ipc.json` | 1 |
| `flat-ipc-bypass-registry` | `host-invoke.ts` 末尾追加 `ipcMain.handle('rogue:bypass', …)` | `electron/main/ipc/host-invoke.ts:386: [flat-ipc/bypass-registry] … registered outside electron/main/ipc-handlers.ts and bypasses HostApiRegistry` | 1 |
| `flat-ipc-dual-entry-unacknowledged` | 清单中 `openclaw:status` 的 `reason` 置空 | `scripts/contract-check-flat-ipc.json: [flat-ipc/dual-entry-unacknowledged] 'openclaw:status' shares domain 'openclaw' … has no reason` | 1 |
| `flat-ipc-removal-plan-missing` | 清单中 `file:stat`（freeze）的 `removalPlan` 置空 | `… [flat-ipc/removal-plan-missing] 'file:stat' is freeze but declares no removalPlan` | 1 |
| `flat-ipc-allowlist-dangling` | preload 白名单追加 `'rogue:dangling'` | `electron/preload/index.ts: [flat-ipc/allowlist-dangling] 'rogue:dangling' is in validChannels but has no ipcMain.handle …` | 1 |
| `flat-ipc-preload-mismatch` | preload 白名单删去 `'gateway:status'` | `electron/preload/index.ts: [flat-ipc/preload-mismatch] 'gateway:status' is unreachable in validChannels but the registry declares allowlisted` | 1 |
| `host-api-alias-member-unreconciled` | `ChangeContextApiContract` 追加 `newUnreconciledAction` | `src/lib/host-api.ts: missing hostApi.changeContext.newUnreconciledAction facade` | 1 |
| `host-api-unresolved-alias-member` | `contract.ts` 把 `changeContext` 指向未知类型 | `shared/host-api/contract.ts: [host-api/unresolved-alias-member] HostApiContract.changeContext aliases type 'TotallyUnknownContractShape' …` | 1 |

**关键对照**：`host-api-alias-member-unreconciled` 在改动前的 checker 上**不产生任何 issue**（别名成员被跳过），这正是 ADMISSION-INVENTORY §7.1 记录的盲区；改动后它被同一条 facade 对账规则拒绝。

`tests/unit/contract-check.test.ts` 的 `real gate entry` 组用 `child_process.execFile(process.execPath, ['scripts/contract-check.mjs', …])` 逐个运行上表（断言 exit 1、恰好 1 条 `- ` 诊断、含期望子串），并断言正例 exit 0、坏 fixture exit 2。合同第 27 行"负例通过真实门禁入口执行"由此满足，而不是只调用 `collectContractIssues`。

---

## 5. 不变量（本轮未改）

- `electron/main/ipc-handlers.ts`、`electron/main/ipc/host-invoke.ts`、`electron/preload/index.ts`、`shared/host-api/contract.ts`、`shared/types/change-context.ts`、`src/lib/host-api.ts`：`git diff` 为空。
- 43 个 channel、44 条白名单、58 个类型化模块、559 个 action 的名称与顺序不变；无迁移、无退役、无改名。
- 无新增 Host API 模块、action、channel、package script、运行时组件；产品锁 / 默认矩阵 / 权限 / UI / 发布状态不变。
- 负例改写只在进程内存中发生；`git status` 在任何 fixture 运行后不变。

---

## 6. 复现命令（离线，仓库根目录，Git Bash）

```bash
export TMPDIR=/d/tmp   # C: 盘紧张，临时产物一律走 D:

# 正例
pnpm contract:check                                   # → Contract check passed. / exit 0

# 全部负例（每个 exit 1，恰好 1 条 "- " 诊断）
for f in tests/fixtures/contract-check/*.json; do node scripts/contract-check.mjs --fixture "$f"; echo "exit=$?"; done

# 坏 fixture 与门禁失败可区分
node scripts/contract-check.mjs --fixture tests/fixtures/contract-check/does-not-exist.json; echo "exit=$?"   # → 2

# 计数口径（与 ADMISSION-INVENTORY §10 对齐）
node --input-type=module -e '
import { readFile } from "node:fs/promises";
import { parseContractActions, parseContractAliasMembers, parseIpcMainHandleSites, parsePreloadAllowlist } from "./scripts/contract-check.mjs";
const r=(p)=>readFile(p,"utf8");
const contract=await r("shared/host-api/contract.ts");
const c=parseContractActions(contract,{ cc: await r("shared/types/change-context.ts") });
const sites=parseIpcMainHandleSites(await r("electron/main/ipc-handlers.ts"),"ipc-handlers.ts");
const reg=JSON.parse(await r("scripts/contract-check-flat-ipc.json"));
const d={};for(const e of reg.channels)d[e.disposition]=(d[e.disposition]||0)+1;
console.log("alias",[...parseContractAliasMembers(contract)],"modules",c.size,"changeContext",c.get("changeContext").size,"flat",sites.length,"registry",reg.channels.length,d,"allowlist",parsePreloadAllowlist(await r("electron/preload/index.ts")).length);'
# 期望：alias [["changeContext","ChangeContextApiContract"]] modules 58 changeContext 8 flat 43 registry 43 {retire:35,freeze:4,migrate:4} allowlist 44

# 单测（含真实入口组）
pnpm exec vitest run tests/unit/contract-check.test.ts --maxWorkers=1
```

---

## 7. 证据链

以下命令于 2026-10-31 在本轮改动的工作区上运行（临时目录指向 `D:\tmp`，日志 `D:\tmp\tf0630-gate-<name>.log` 与 `D:\tmp\tf0630-fixtures.log`，仅本地保留）。退出码由 shell 直接捕获。本表的"exit / 关键输出"列先按预期起草，再在命令运行后逐项与实际退出码和日志尾部核对，核对后未发现差异；核对后对本文件敏感的快速门禁（#3、#6、#7、#8）在本文件最终字节上重新运行并保持 exit 0。候选 commit 见 Task Forest `TF-0630` 的 `evidence`。

| # | 命令 | exit | 关键输出 |
|---|---|---|---|
| 1 | `pnpm harness context --spec harness/specs/tasks/architecture-skeleton-admission-gate.md` | 0 | 输出最小阅读清单（rules: `contract-first-boundary` / `renderer-main-boundary` / `repository-artifact-retention`） |
| 2 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-admission-gate.md` | 0 | `Spec is valid`（带 diff：本轮全部改动路径均在 `ownedPaths` 内） |
| 3 | `pnpm harness validate --spec harness/specs/tasks/architecture-skeleton-admission-gate.md --no-diff` | 0 | `Spec is valid` |
| 4 | `pnpm contract:check` | 0 | `Contract check passed.` |
| 5 | `pnpm exec vitest run tests/unit/contract-check.test.ts --maxWorkers=1` | 0 | `Tests 30 passed (30)`（含 8 个 fixture 的真实入口运行 + 正例 + exit 2 对照） |
| 6 | `git diff --check` | 0 | 无输出 |
| 7 | `node scripts/check-repository-artifacts.mjs` | 0 | `Repository artifact retention passed` |
| 8 | `node scripts/check-local-paths.mjs` | 0 | `[local-paths] PASS` |
| 9 | 8 × `node scripts/contract-check.mjs --fixture …`（§6 循环） | 8 × 1 | 每个恰好 1 条 `- <file>[:line]: [rule] …`，见 §4 表 |
| 10 | `node scripts/contract-check.mjs --fixture …/does-not-exist.json` | 2 | `Contract check fixture error: ENOENT …` |
| 11 | `pnpm exec eslint scripts/contract-check.mjs tests/unit/contract-check.test.ts` | 0 | 无输出 |

**本轮明确未运行**（不在合同 `requiredTests` 内，且本轮无运行时代码改动）：`pnpm run typecheck`、`pnpm test`（全量）、`pnpm run test:e2e`、`pnpm run lint`（全仓）、`pnpm agent-dev:*`、任何 live provider / Gateway 运行。这些项记为 `not-run`，不得被解读为已通过。

**验收逐条对照**（合同 frontmatter `acceptance`）：

| 验收条 | 状态 | 证据位置 |
|---|---|---|
| contract:check 在现有功能上保持通过，不新增 package script | 达成 | 表 #4；`package.json` 未改 |
| 门禁能从磁盘枚举扁平 IPC channel，并与类型化模块名做交集检查 | 达成 | §3.2（`parseIpcMainHandleSites` + `resolveTypedDomain`）；§6 计数命令 flat 43 / modules 58 |
| 独立负例：未登记 channel、双入口同域冲突、绕过 HostApiRegistry 各自被拒绝，诊断可定位到 channel 名与规则 | 达成 | §4 表前三行（`unregistered-channel` / `dual-entry-unacknowledged` / `bypass-registry`），每条含 channel 名与 `[flat-ipc/<rule>]` |
| 负例通过真实门禁入口执行，而非只单测 checker；错误输入不能产生有效 pass | 达成 | §4：`node scripts/contract-check.mjs --fixture` 即 `pnpm contract:check` 的入口；8/8 exit 1；坏 fixture exit 2；缺输入 fail-closed（§3.4） |
| 现有 43 个扁平 channel 与 58 个类型化模块的行为、顺序与命名保持不变 | 达成 | §5；六个运行时文件 `git diff` 为空 |

---

## 审查勘误与已知限制（2026-11-01，独立审查后落地）

本节由 TF-0629…TF-0637 收尾审查追加（`driven_by: agent`，`actor: claude-fable-5`）。上文保持 TF-0630 收口时的原貌。

### 本次修补（审查提交）

| 修补 | 原缺陷（审查探针） | 改动 | 负例 / 验证 |
|---|---|---|---|
| `tests/unit/contract-check.test.ts:171` TS7006 | `function registryWithChannel(mutate)` 无类型注解，在 `tsconfig.test.json`（strict）下是隐式 any；`git blame` 归 `fd2d93a41`，即**由 TF-0630 引入**，不是"既有红"。§7 虽如实记 `pnpm run typecheck` 为 not-run，但该节点让仓库级 typecheck 变红而未说明 | `mutate: Record<string, unknown>` | `pnpm run typecheck:test` 不再报该行（本次审查中该子门禁另有环境项，见审查报告） |
| 未被门禁读取的 fixture 变更现在 exit 2 | `--fixture` 若只改写门禁从不读取的文件（如 `src/pages/Chat/index.tsx`），原实现仍打印 `Contract check passed.`、exit 0，违反"错误输入不能产生有效 pass" | 记录被读取过的变更文件集合；存在未消费的变更文件时以 `Contract check fixture error: fixture mutations target files the gate never reads` 退出 2 | 探针 `D:/tmp/probe-unread.json` → exit 2 |
| 新规则 `flat-ipc/preload-direct-invoke` | "44/44 双向对账"只覆盖 `validChannels` 数组成员；preload 里一个直连包装 `ipcRenderer.invoke('provider:getApiKey', id)` 可以让清单标为 `unreachable` 的 handler 对 renderer 可达而门禁仍通过 | preload 中每个 `ipcRenderer.invoke('<literal>'` 若既不是 `host:invoke` 也不在 `validChannels`，即失败；可达性仍由白名单单独定义，因为任何绕过白名单的直连包装现在都会失败 | `tests/fixtures/contract-check/flat-ipc-preload-direct-invoke.json`（exit 1，1 条，定位 `electron/preload/index.ts:<line>`）；测试的规则清单已加入该规则 |

正例在修补后仍 `Contract check passed.`、exit 0；9 个 fixture 各 exit 1 且恰 1 条诊断。

### 已知限制（本次未修，记录而非扩大 TF-0630）

这些是正则门禁的表达力边界；上文把门禁描述为"任何出现即 bypass-registry"等处应按本节收窄理解。

1. `ipcMain.handle(` 只识别精确拼写：`ipcMain.handle (` 带空格、`const { handle } = ipcMain; handle(...)` 解构、以及 `.mts/.cts/.js` 主进程文件都不在扫描内（扫描只覆盖 `electron/**/*.ts`）。
2. 别名成员只识别 `name: Ident;` 一种形态；`name: Partial<T>;`、`name: T | null;`、行内对象字面量成员会被所有三类对账静默跳过（当前 58 个成员都在可识别形态内，所以现在的通过是真实的）。
3. 注释里的 `ipcMain.handle('…')` 会产生 `bypass-registry` 误报（fail-closed 噪音）；别名类型若以非相对路径（`@shared/...`）import 会误报 `unresolved-alias-member`。
4. `danglingAllowlistEntries` 的重复条目被 `Map.set` 静默覆盖（`channels` 有 `duplicate-registry-entry`，这里没有）；`host-invoke.ts` 内第二个 `ipcMain.handle('host:invoke')` 不报（Electron 运行时会抛错，影响低）。
