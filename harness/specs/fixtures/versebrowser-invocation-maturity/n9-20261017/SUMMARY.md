# N9（TF-0354）重复运行与限定范围收口 — 2026-10-17，candidate `23c2de13`（含修复 `d4c3f102`）

范围：Windows x64 + 本候选构建的**实际打包产物**（`release/win-unpacked/Verse Claw.exe`）。这是限定范围的可用性证据，不是产品 GA/发布声明。

## 1. 方法

- 每一轮都**新起一个独立应用实例**：全新的隔离 `user-data-dir`（`<repo>/.tmp/n9-<kind>-*`，运行后回收）、独立 CDP 端口，`VERSE_CLAW_E2E=1` + `VERSE_CLAW_E2E_SKIP_SETUP=1`（agent 驱动，非真人）。
- 冷启动轮：等待 renderer page 出现 + `agentBrowser.status` 返回 ok。
- 闭环轮：`setEnabled → open → takeSnapshot(升级前，须 fail-closed) → requestModeUpgrade → type → click → takeSnapshot(须含 fixture 业务文本) → status(owner 归属) → close → status(会话数)`。
- 中断轮：`open` 后**带着活动会话**整棵进程树强杀（`taskkill /T /F`）；紧随一轮 recovery 用完整闭环证明下一次运行仍可用。
- 每轮记录：`residualProcesses`（按该轮 `user-data-dir` 匹配进程命令行）、`runDirReclaimed`、`durationMs`、`launchMs`、`rendererReadyMs`、进程树 RSS、业务字段（`snapshotHasFixture` / `ownedSessionCount` / `sessionsAfterClose`）。原始逐轮数据见 `stability.json`。

## 2. 结果（`stability.json`，exit 0，issues []）

| 相位 | 轮数 | 通过 | 指标 |
| --- | --- | --- | --- |
| 冷启动 | 10 | 10 | p50 7392 ms，max 7484 ms，最大残留进程 0 |
| 基础闭环 | 30 | 30（`fullLoops` 30/30） | p50 6693 ms，p95 8281 ms，max 9441 ms，最大残留进程 0，RSS 峰值 1356.2 MB |
| 受控中断 | 3 | 3（均带活动会话被强杀） | — |
| 中断后恢复 | 3 | 3（完整闭环 + fixture 断言通过） | — |
| 运行目录回收 | 46 | 46 | 零残留 |

逐轮不变式（全部 46 轮成立）：`residualProcesses === 0`、`runDirReclaimed === true`；30 个闭环轮全部 `ownedSessionCount === 1`、`sessionsAfterClose === 0`、`snapshotHasFixture === true`、`closed === true`。

## 3. 时间 / 内存口径（不捏造基线）

- 本仓库**没有既有的 VerseBrowser 性能预算**文件可作为门限；因此这里记录的是**同候选的观测参考值**，不是"提升"声明，也不作为通过门限。
- 参考点：N8 修复后 packaged-flow 两次实跑各 5-7 秒（见 `n8-20261016/packaged-flow-verify-after-fix.json` 与 `FIX-SUMMARY.md` 门禁表）；N9 闭环 p50 6693 ms / p95 8281 ms，与之一致。
- 冷启动 p50 7392 ms 含 renderer 就绪；`launchMs`（CDP 就绪）样本约 4.6-5.7 秒。
- RSS 为**进程树工作集合采样**（按该轮目录匹配），非泄漏判定；泄漏结论来自"46/46 轮零残留进程 + 零目录残留"。

## 4. 绑定与卫生

- 产物绑定：`n8-20261016/artifact-identities-after-fix.json` —— NSIS 安装器 678800538 B `a999e010…cad68`；`win-unpacked/Verse Claw.exe` 214315008 B `339ab98b…172caa9`；`resources/app.asar` 305714053 B `ae0bb8d0…34be3c`；包内 `main-runtime.asar` 与 `build/main-runtime-delivery/main-runtime.asar` 逐字节相同（`b5a22d6f…b2ce81c`）。
- 能力一致性：全部 46 轮 `status.capabilities.cliAvailable === false`（与 N3 桌面收据、以及修复后的 `packages/README.md` 表述一致）。
- 凭据扫描：对 `n8-20261016/` + `n9-20261017/` 全部 fixture 做正则扫描（sk-/ghp_/gho_/AKIA/PRIVATE KEY/明文 key=value），**0 命中**。
- 全部收据 SHA256 见同目录 `SHA256SUMS`。

## 5. 强制验收对照

| 验收（spec L169 / TF-0354） | 证据 |
| --- | --- |
| 10 次冷启动、30 次基础闭环、3 次中断/恢复 | `stability.json`：10/10、30/30、3/3 + 3/3 recovery |
| 每轮业务断言/采集/owner 可追溯 | 每行含 `snapshotHasFixture`（业务文本）、`ownedSessionCount`/`sessionsAfterClose`（owner 与会话守恒）、`runId`/`profile` |
| 测试进程/会话残留为 0 | 46/46 轮 `residualProcesses=0`、`runDirReclaimed=true`；闭环轮 `sessionsAfterClose=0` |
| 时间/内存按既有预算记录并比较，不捏造基线 | §3：记录观测值 + 明确无既有预算、参考 N8 同候选实测 |
| 强制场景与启用能力有当前代码/安装包绑定证据、凭据扫描与 hash | §4 + `gates-after-fix.json`（requiredTests 全 exit 0，含 E2E 3 passed） |
| README/模型 schema/能力矩阵一致，限制明确 | `packages/README.md` 已同步（桌面走 browser-window 引擎、`command` 不在桌面面广告、CLI 属独立/MCP 面）；模型 schema 由能力快照过滤 |

## 6. 明确边界

- 仅 Windows x64 实测；不外推其它平台。
- NSIS 安装器/卸载器本体未执行（assisted installer 需交互提权），沿用 agent 驱动的解包等价路径；PATH 增删与卸载回收未验证。
- 桌面面不提供 `command`/外部浏览器复用（CLI 专属能力属独立/MCP/CLI 面）。
- 未发布、未改变仓库公开性、未改动冻结默认值。
- 中断恢复覆盖"进程被强杀后下一轮可用且零残留"，不覆盖 OS 级崩溃转储或磁盘损坏场景。
