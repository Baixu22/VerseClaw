# VerseConf 真实模型链路与证据规划

## 现状判断

当前仓库已经有一条以合成夹具和固定输入为主的 agent-driven 验收链路：

- `scripts/verify-verseconf-clawx-integration.mjs` 覆盖 WASM/worker、源码 Gateway、打包 Gateway、创建、修订、导出、历史和嵌套幂等冲突。
- `artifacts/verseconf-clawx-integration/idempotency-acceptance-20261003.json` 记录了源码运行时的幂等修复结果。
- `artifacts/verseconf-clawx-integration/acceptance-20261003.json` 记录了模块更新的历史门禁和残余项。
- `harness/specs/tasks/verseconf-clawx-integrated-consumer.md` 定义了写入 owner、journal、权限、取消、历史恢复和导出等契约。

这条链路可以证明代码契约和本地运行时行为，但历史记录明确 `realHumanEvidence: false`、`paidModelCalls: 0`，没有把真实模型输出接入 VerseConf 的完整使用链。因此当前结论是：有较完整的合成/运行时链路，但还没有完整的真实模型驱动链路，不能直接宣称“使用一切正常”。

## 规划的唯一主链路

```text
Responses API（用户授权的模型）
  -> 保存脱敏响应与模型文本（本地）
  -> 本地 JSON 形状门禁
  -> OpenClaw Gateway /tools/invoke
  -> structured_artifact_create
  -> structured_artifact_inspect
  -> 模型生成受控 changes
  -> 本地 changes 门禁
  -> structured_artifact_revise
  -> 相同 idempotencyKey 重放
  -> 相同 key 的嵌套 payload 冲突
  -> structured_artifact_export
  -> structured_artifact_history
  -> 报告与 issue（本地）
```

每一轮都保留请求摘要、响应、Gateway 调用、文件 SHA-256、历史长度和导出结果。模型文本先经过本地检查，再交给 VerseConf schema/worker 和 runtime write owner；模型输出不直接作为通过理由。

## 产物边界

| 内容 | 位置 | 是否提交 Git | 用途 |
| --- | --- | --- | --- |
| 可重复驱动器 | `scripts/verseconf-live-chain.mjs` | 是 | 执行真实模型两轮输出与 Gateway 链路 |
| 使用说明与门禁 | 本文件 | 是 | 规划、范围、判定和复测入口 |
| package 入口 | `package.json` 的 `verseconf:live` | 是 | 统一启动命令 |
| 原始模型响应 | `.local/verseconf-live/<run>/` | 否 | 防止幻觉，支持事后复核 |
| 临时 Gateway workspace、日志、xlsx | `.local/verseconf-live/<run>/runtime/` 及同级文件 | 否 | 运行时原始证据 |
| 失败 issue JSON/Markdown | `.local/verseconf-live/<run>/issues/` | 否 | 每次失败的可复制问题记录 |
| 必要的代码、schema、契约和精选结论 | `scripts/`、`docs/`、`harness/`、`artifacts/verseconf-clawx-integration/` | 是 | 后续审查和复现所需的长期资料 |

`.local` 已由现有 `.gitignore` 规则忽略，本次不扩大忽略范围，也不把必要的脚本、规划、契约或精选证据放入忽略规则。API key 只从进程环境读取；驱动器不写 key、Authorization header 或完整环境变量。

## 复测轮次与通过条件

首次运行使用 `space-bunny` 和用户提供的本地 Responses 端点。驱动器会完成两次模型调用：一次生成研究表源文档，一次生成受控修订。每次复测生成独立时间戳目录，不覆盖上一轮。

通过需要同时满足：模型 HTTP 成功且输出可解析；源文档满足本地形状门禁并被 `structured_artifact_create` 接受；修订被 runtime 提交；同 key 重放返回同一结果；改变嵌套 payload 后返回 `idempotency_conflict` 且文件和历史不变；inspect、xlsx export、history 均成功；保存的证据中不存在 API key。

任一条件失败都生成 `VC-LIVE-<timestamp>.json/.md`，包含失败阶段、实际 HTTP 状态、Gateway 详情、复现命令和证据目录，并保持 `status: open`。问题先留在本地，确认属于实现缺陷后再单独提升为仓库 issue；模型输出不符合约束也按可复现的模型契约问题记录，不能改写成通过。

## 仍然需要后续单独验证的边界

真实模型链路通过后，还需要按任务 spec 重新跑当前 dirty 工作区的完整 unit/typecheck/contract/comms/build 门禁；历史 Electron 全量运行已有失败与跳过项，且不是本次 idempotency 修复后的单次全绿证据。UI 交互、Windows 安装包和真实第三方渠道也不由本脚本自动升级为通过，必须各自留下对应产物。

## 2026-10-04 当前轮次结果

- `.local/verseconf-live/20261003T163823Z/report.json`：使用 `space-bunny` 完成两轮 Responses API 调用，真实接入当前源码 Gateway，12/12 检查通过；包含 create、受控 revise、相同 key 重放、嵌套 payload 冲突、inspect、xlsx export、history 和凭据落盘扫描。
- `.local/verseconf-live/20261003T163823Z/runtime/`：本轮 Gateway 的隔离 workspace、日志和导出文件都在同一轮次目录内，可独立复核；该目录由现有 `*.local` 规则忽略。
- `.local/verseconf-live/20261003T163350Z/issues/VC-LIVE-20261003T163350Z.*`：首轮驱动器断言了错误的 inspect 响应路径，已标记为 P3/closed，并保留原始失败证据；修正驱动器后下一轮通过。
- `.local/verseconf-live/20261003T164500Z-existing-verifier/issues/VC-INTEGRATION-20261003T164500Z.*`：记录了嵌套 OpenClaw SDK 导出解析导致的 bootstrap 失败；通过把 VerseConf 核心存储和工具运行时改为本地 host-neutral 接口、将 OpenClaw 限定在适配层后，已关闭该问题。
- `.local/verseconf-live/20261004T-verifier-seam-2/verification.json`：通过 `pnpm run verseconf:verify` 完成 43/43 case，0 failed，凭据扫描 0 命中；验证了源码 verifier、隔离存储、create/revise/idempotency conflict/restore/history/export 与渲染产物链路。
- 本轮解耦边界：`src/state-db.ts`、`src/runtime.ts`、`src/store.ts`、`src/engine.ts` 和 `src/tools.ts` 为本地核心；`api.ts`、`index.ts`、`src/gateway.ts`、`src/openclaw-runtime.ts` 以及显式 seam 测试属于 OpenClaw 宿主适配面。OpenClaw 仍被保留为宿主插件注册 seam，但不再是 VerseConf 核心存储、计算和工具执行的启动前提。
- `.local/verseconf-live/20261004T-stepfun-responses-v2/report.json`：使用用户授权的 `step-5-preview` 完成 2 次 HTTP 200 模型调用，12/12 检查通过；包括源文档门禁、受控修订、幂等重放、嵌套冲突、inspect、xlsx export、history 和凭据落盘扫描。
- `.local/verseconf-live/20261004T-stepfun/issues/VC-LIVE-20261004T025800Z.*`：原始版本根路径 404 已关闭，保留了失败响应和 `/responses` 路径的复测证据。
- `.local/verseconf-live/20261004T-stepfun-responses/issues/VC-LIVE-20261004T025838Z.*`：StepFun 推理项与最终消息混读导致 JSON 解析失败已关闭；驱动器现在只读取最终 message/output_text 项。

本轮证据均为 agent-driven；模型输出明确标注为未独立验证，不含 real-human 或 paid-model 结论。必要的驱动器、规划、package 入口和 spec 变更保持可审查；原始响应、运行时目录与本地 issue 留在 `.local`，不上传 Git。

## 复现入口

```powershell
$env:VERSECONF_LIVE_BASE_URL = 'http://127.0.0.1:3065/v1/responses'
$env:VERSECONF_LIVE_MODEL = 'space-bunny'
$env:VERSECONF_LIVE_API_KEY = '<owner-provided-key>'
pnpm verseconf:live
```

也可以用 `--output-dir` 指定一个已经被审计过的本地目录；默认目录是 `.local/verseconf-live/<UTC timestamp>`。
