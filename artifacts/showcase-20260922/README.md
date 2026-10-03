# ClawX 实习展示演示包（2026-09-22）

阶段 2 材料，对应 Task Forest TF-0237。本目录是三条真实旅程的**离线副本**，加上哈希清单、离线核对说明与演示日预案。读者不需要本机环境、不需要网络、不需要任何凭证，就能逐件核对下面的证据。

定位与边界见 [对外说明一页](../../docs/dev/showcase-brief-20260922.md) 与 [贡献归属一页](../../docs/dev/showcase-contribution-attribution-20260922.md)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `journeys/J-02/` | 09-21 首条产品旅程：58 秒、3/3 测试通过、前后哈希一致（`journey.json`、`session.jsonl`、`screenshots/`、`calc.js.after`、`workload/`） |
| `journeys/J-03/` | 09-22 带收据开关重跑：3/3、28 行 runtime 收据、7 对 ContextReceipt/v1–WireReceipt/v1（`receipt-join.json`） |
| `journeys/J-04/` | 09-22 非 fullAccess 审批边界：`exec.approval.requested` → 决定 → 命令继续（`approval-boundary.json`、`gateway-events.jsonl`、`session.jsonl`） |
| `tail-verdicts.md` | 五条演示尾项裁定表（指向 J-03 README 原文） |
| `manifest.json` | 目录内每个文件的 sha256 与字节数（不含自身） |
| `credential-scan.json` | 凭证扫描的模式、覆盖文件数与命中数（必须为 0） |
| `VERIFY.md` | 离线核对步骤 |

## 演示日脚本（每步都指向留档文件）

1. 定位与主线：读 [对外说明一页](../../docs/dev/showcase-brief-20260922.md) 前三段。
2. 编码旅程：`journeys/J-02/journey.json` 的 `workspace.before/after` 与 `tests`；截图 `journeys/J-02/screenshots/06-final.png`。
3. 护城河第一层（执行有边界）：`journeys/J-04/README.md` 的边界时间线表 + `journeys/J-04/session.jsonl` 决定后的 `exec` toolResult。
4. 护城河第二层（上下文可归因）：`journeys/J-03/receipt-join.json` 的 `v1ContextWirePairs: 7` 与 `journeys/J-03/journey.json` 的 `runtime_receipts: 28`。
5. 护城河第三层（不把测试绿说成产品绿）：[对外说明一页](../../docs/dev/showcase-brief-20260922.md) 第三行 + 五条尾项裁定。
6. 边界与不宣称：`tail-verdicts.md` 与三句限制。

## 两个已修缺陷（提交 `6760b372e`）

J-02 逼出并修掉的首版关键路径缺陷，两条都在同一个提交里，细节见 `journeys/J-02/README.md` 的「本旅程逼出的产品缺陷」：

1. custom provider 的 API key 到不了隔离源码运行时（运行时报 `No API key found`）。
2. 工作区的 `tools.exec` 权限模式到不了隔离源码运行时，导致每次 `exec` 卡在无人处理的 `exec.approval.requested` 上。

## 演示日预案

- provider（senseaudio）不可用：按本目录留档讲解，**不现场重试长跑**；判据与风险预案见 [综合规划 §8](../../docs/dev/qa-synthesis-roadmap-20260922.md)。
- 需要现场重跑：用仓库内 `journeys/J-03/driver.mjs`，key 只经驱动进程环境变量，见该 README 的 Re-run 段。
- 任何一项核对失败：以 `VERIFY.md` 的失败分支为准，不要口头解释成通过。

## 三句限制（与阶段 1 裁定一致）

1. 收据默认关，本次演示在驱动进程环境里显式开启，产品默认未改。
2. 非 fullAccess 工作区没有应用内审批入口、会挂起；J-04 的决定由 agent 经直连 Gateway websocket 作出。
3. 操作者是 agent-driven，不是具名真人；Windows x64、一个 provider、一个工作区。

## 重建与复核

```powershell
node scripts/build-showcase-package.mjs --date 20260922 --verify   # 离线核对：哈希 + 计数 + 凭证扫描
node scripts/build-showcase-package.mjs --date 20260922            # 从 live-model-cdp 重新同步 journeys/ 并重写 manifest
```

`manifest.json` 不含时间戳：包内容不变时重跑生成脚本得到逐字节相同的 `manifest.json` 与 `credential-scan.json`（已实测）。故意改动任一被打包文件会让 `--verify` 以 exit 1 报出「hash drift」；只改计数不改字节则同时报出「expected 7, read 6」。

## 本包不含

Task Forest 导出（`exports/task-forest.*`）、codegraph 库、node_modules、构建产物，以及任何凭证。产品锁 `liveReady`/`productApproved`/`defaultOn` 保持 false。
