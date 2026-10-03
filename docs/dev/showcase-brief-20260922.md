# ClawX 实习展示说明（对外一页）

阶段 2 材料（TF-0236）；限制栏逐条来自 TF-0234 裁定，草稿版见 [showcase-overview](showcase-overview-20260922.md)，方向以[综合规划](qa-synthesis-roadmap-20260922.md)为准。

**定位（一句）**：这是一个人与 AI Agent 协作完成的「Agent 基座 + Harness + LLM 工程化」展示项目，不是商业产品、不是 GA、不承诺长期运营。

**主线（一句）**：在 Windows x64 上，一个 agent 用一个真实 provider、在一个独立练习工作区里做完一件工程事——跑测试、改代码、再跑测试——并留下可离线复核的产物。

## 三层护城河

| 层 | 一句话与代码坐标 | 真实产物 |
| --- | --- | --- |
| 执行有边界 | `tools.exec` 策略把命令分为放行与需批准；需批准时运行时发出 `exec.approval.requested` 并等待显式决定——`openclaw_runtime/src/` 下 `infra/exec-approvals.ts:105`、`agents/bash-tools.exec-approval-request.ts:187`、`gateway/server-methods/exec-approval.ts:357` | J-04：readOnly 下 requested → 决定 → 命令继续（[README](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J04/README.md)） |
| 上下文可归因 | 封条钩子在最终请求体边界写入 ContextReceipt/v1 与 WireReceipt/v1，可按 `correlation_digest` 配对——`openclaw_runtime/src/` 下 `context-engine/rc03-seal-hook.ts:284`、`agents/receipt-store.ts:469`、`agents/shadow-census.ts:181`、`context-engine/dcs-receipts.ts:18-19` | J-03：真实调用上 28 行收据、7 对 v1（[receipt-join.json](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/receipt-join.json)） |
| 不把测试绿说成产品绿 | 能力声明按 TP-SRC / TP-TEST / TP-RUN / FP-OVERCLAIM 分类（[`artifacts/capability-claims/status-table.json`](../../artifacts/capability-claims/status-table.json)，44 条 / 2026-07-05）；验收器只产出 `engineeringAcceptedByAgent`，`allowedPromotion` 恒 false——`scripts/lib/agent-engineering-acceptance.mjs:1789-1795`、`scripts/validate-runtime-authority-convergence.mjs:326`、`tests/unit/tf0009-engineering-evidence-audit.test.ts:113-119` | TF-0076 以成本 NO-GO 收口（[节点记录](task-forest-existing-nodes-20260915.md)） |

## 四栏边界

| 栏 | 内容 | 证据 |
| --- | --- | --- |
| 跑过 | J-02 编码旅程 58 秒 / 3-3 通过 / 前后哈希一致；J-03 带收据开关重跑 3-3、28 行收据、7 对 v1；J-04 审批边界一次 | `artifacts/live-model-cdp/` 下 J02/J03/J04 三目录 |
| 只证明机制 | 双收据默认关，只在驱动进程开 flag；RC-02 全量普查未完成；双执行者验收流程可用；审批 RPC 运行时侧齐全 | 同上；`harness/specs/tasks/agent-engineering-acceptance-orchestrator.md:16-17` |
| 未完成 | TF-0030 全量普查、TF-0032 审批跨重启持久化、应用内审批 UI、本地转写回放、切换后头部刷新 | 任务图 TF-0030/TF-0032；[J-03 README](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md) |
| 范围外 | RC-03～RC-10、M6、Docker、渠道扩展、第二产品面、CodeGraph 产品面、拆三个 200 KB 大文件 | [综合规划 §1.1、§5](qa-synthesis-roadmap-20260922.md) |

## 限制栏

三句随材料走的限制：① 收据默认关，演示时在驱动进程环境显式开启，产品默认未改（[J-03 README:6,14](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md)）；② 非 fullAccess 没有应用内审批入口、会挂起，J-04 的决定由 agent 经直连 Gateway websocket 作出，host 在 readOnly 下会拦住 `exec.approval.*`（[J-04 README:36](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J04/README.md)、`electron/services/workspace-permissions.ts:386`）；③ 操作者是 agent-driven，不是具名真人，Windows x64、一个 provider、一个工作区（[J-03 README:3,16](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md)）。

另有五条演示尾项（①历史回放 ②审批入口 ③8 秒 reload ④工作区副作用含 git init ⑤界面同步），阶段 1 逐条裁定为 ①不修 ②仍在 ③不修 ④仍在 ⑤不修，坐标见 [J-03 README 尾项裁定](../../artifacts/live-model-cdp/20260922-senseaudio-journey-J03/README.md)。

## 演示日预案

provider 不可用时按留档讲解，不现场重试长跑（[综合规划 §8](qa-synthesis-roadmap-20260922.md)）。三锁 `liveReady`/`productApproved`/`defaultOn` 保持 false，未翻任何默认值。
