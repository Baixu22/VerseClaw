# 接入层兼容回归与收敛报告（TF-0652 / A6）

> 节点：TF-0652（批次 A / A6，父 TF-0628）
> 合同：harness/specs/tasks/architecture-skeleton-admission-regression.md
> 候选：314a2e193f07480f882ec9410195ab080e927cf7（tree 24d4b97f...）
> 基线：97cda35de（A3 的直接父提交）
> 产出者：agent（driven_by: agent，actor: codex）；没有真人操作或真人 verdict
> 本轮取代 2026-11-02 的上一份报告（候选 6b7f8eb49，当时单测/E2E/lint 均未收口）

## 1. 结论

A5 的接入层收敛本身是成立的：仓库只剩 `host:invoke` 一个请求/响应入口，默认矩阵与权限路径相对 A3 之前的基线零 diff。

A6 的兼容回归在本轮**已取得可判定结果，且未发现候选引入的产品回归**：

| 轴 | 结果 | 分类 |
|---|---|---|
| 构建 | exit 0 | pass |
| 类型检查 | node / web / test 三段 exit 0，errorCount 0 | pass |
| lint:check | exit 0（0 error，warning 在配置上限 120 内） | pass |
| contract:check | exit 0 | pass |
| repo:artifacts:check | exit 0 | pass |
| harness validate + dry-run | 干净候选上 exit 0 | pass |
| 全量单测 | exit 1；**58 个失败套件全部在基线 97cda35de 上同样失败** | 既有失败，非候选回归 |
| 全量 E2E | exit 1；418 条中 411 条是同一个 `firstWindow` 超时 | 环境失败 |
| 默认矩阵 / 权限路径 | 7 个受保护 blob 全等，changedFiles 为空 | pass |

因此「现有产品行为变化 = 0」这一判据在本轮**有正面证据**：受保护边界零 diff，且没有任何一个失败是候选独有的。

## 2. 单测：基线对照把 187 个失败归到「既有」

上一轮记录了 exit 1、187 failed，但把整批判为「未证明」。本轮改为**基线差分**：

- 候选 314a2e193 上，全量单测失败 58 个套件。
- 在同一个 A3 之前的基线 97cda35de 上重跑这 58 个套件：**58 个全部同样失败**（其中 50 个首行错误信息逐字相同）。
- 候选独有、基线不失败的套件：**0 个**。

`unit/unit-regression-classification.json` 是机器可读的逐套件对照表；`unit/unit-a2.json`、`unit/unit-b.json`、`unit/unit-baseline.json`、`unit/unit-b-baseline.json` 保留原始 JSON 报告。

根因单一：`resolveRuntimeMemoryFeatureFlags` 自 `91c429310`（TF-0500，2026-10-23）起把 `persist`/`shadow`/`provider`/`proposeFacts` 硬钉为 false。该提交早于 A3 基线，因此 runtime-memory 家族、migration、grounding、host-services 等失败在基线上即存在。测试仍按「开启持久化」断言，属于**既存测试与已退役开关的口径差**，不是 A3–A5 改动造成。

`pnpm run test:dcs` 另有 1 个失败（`dcs-prod-flags-catalog.test.ts`：working-memory 默认 off）。同一个用例在基线 97cda35de 上同样失败。

## 3. E2E：413 条失败是同一环境根因，不是产品失败

`pnpm run test:e2e:run` 完整跑完 418 条（单一 worker 串行，约 4.8 小时），exit 1：

- 413 unexpected / 5 skipped / 0 expected。
- 其中 **411 条**是逐字相同的 `TimeoutError: electronApplication.firstWindow: Timeout 30000ms exceeded`。
- 另 2 条分别是单条 90s 超时与一条 rc10 驱动错误。

根因经三层独立证据确认为**宿主访问控制**，与候选代码无关：

1. 应用自身 stderr：`Failed to initialize logger: Error: EPERM: operation not permitted, mkdir '<profile>\logs'`。
2. Chromium stderr：`Failed to create network context data directory <profile>\Network: 拒绝访问 (0x5)`。
3. **最小复现**：一个不含任何 ClawX 代码的独立 Electron 应用（`D:\tmp\min-electron`）在同一环境下同样 EPERM。

把 profile 分别放到 `D:\tmp`、仓库内、`%APPDATA%`，三者都失败；加 `--no-sandbox` / `--disable-features=NetworkServiceSandbox` 也无效。说明是当前宿主对 Electron 子进程的写入限制，不是路径选择问题。

**结论：本次 E2E 运行不能作为产品行为的通过证据，也不能作为回归证据。** 它被如实记为 `environment`，没有把任何失败改写成 pass。

## 4. Lint 已收口

上一轮 lint:check 为 5 errors / 133 warnings。本轮在候选上 exit 0：

- `check-no-bom` ok
- ESLint 0 error，warning 数在 `--max-warnings 120` 之内
- `lint:dcs`（oxlint type-aware）clean
- `lint:artifact-completion-class` OK

## 5. 候选与写集

A6 从 6b7f8eb49 推进到 314a2e193，共 68 个提交、101 个文件。相对 A6 规格提交，**运行时源码改动只有 5 个 `openclaw_runtime/src/config/runtime-context-block-*.test.ts` 测试文件**，没有产品运行时行为文件。

这正是 CHARTER §8「新增运行时组件 / 第二真源 = 0」的盘上依据。

## 6. 证据目录

```
candidate.json                候选/基线身份与写集口径
gates.json                    11 项门禁的 exit code 与分类
boundary-diff.json            7 个受保护 blob 的逐文件比较
credential-scan.json          23 个保留文件、0 命中
e2e-environment-failure.json  E2E 环境失败的三层证据
unit/                         原始 JSON 报告 + 逐套件基线对照
e2e/                          完整 Playwright JSON（418 条）
logs/                         各门禁的 stdout/stderr
SHA256SUMS                    全部保留文件的摘要
```

所有运行均由 agent 触发；未声称 real-human 证据。

## 7. 边界

- 未改产品默认、产品锁、权限、approval 或发布状态；`liveReady` / `productApproved` / `defaultOn` 仍为 false。
- 未通过放宽门禁把任何失败变成通过；E2E 环境失败按原样记录。
- 不声称 E2E 产品行为已验证：该轴在本宿主上仍为 not-run。
- 不声称全量单测全绿：58 个套件仍在失败，只是**已证明非候选引入**。
