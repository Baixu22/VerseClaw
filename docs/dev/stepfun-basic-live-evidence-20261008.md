# StepFun 基础真实模型证据 — 2026-10-09

`driven_by: agent` · `actor: codex-stepfun-evidence`

本轮按所有者要求使用纯脚本。2026-10-09 提供方恢复调用权限后，修复后的真实 Gateway 两轮复验已通过：准确回复、上下文延续、用量聚合和模型身份均符合预期。此前的 403 与失败记录仍保留。没有声明桌面、全量系统或发布验收。

## 取得的证据

| 检查 | 结果与范围 |
| --- | --- |
| 认证和模型发现 | `https://api.stepfun.com/step_plan/v1/models` 返回 200，包含 `step-5-preview` |
| 非流式真实响应 | 返回指定标记，提供方报告 68 tokens |
| 真实 SSE 流式响应 | 返回指定标记、结束原因和用量 |
| 真实工具调用往返 | 模型生成预期函数名/参数，脚本执行合成查询后，模型正确读取工具结果；不是运行时文件工具验收 |
| 生产解析反例 | 两项新增回归在旧实现失败：正文/合成推理字段和工具参数会被丢弃 |
| 修复后解析回归 | 两文件 7 passed / 0 failed / 0 skipped |
| 修复后本地 Gateway 脚本 | 合成 SSE 回放通过 4 项检查，真实 Gateway 连续两轮回复、上下文延续及用量聚合正常；外部模型调用数为 0 |
| 前次真实复验 | HTTP 403，`real_name_required`，原始拒绝记录保留 |
| 恢复后的真实 Gateway 复验 | 两次 HTTP 200，均为 step-5-preview；两轮准确回复、随机标记上下文延续、fresh 用量聚合通过 |

真实 API 请求和场景输入由 agent 发起，数据为新建合成标记。直接请求与脚本已知记录合计 10 次请求：9 次 HTTP 200、1 次历史 403，已报告总 token 为 63,696。其中本次复验仅新增 2 次请求，合计 13,073 tokens（输入 13,029、输出 44），第二轮报告 6,144 cached input tokens。早期失败的桌面尝试未采集远端请求数，不计入该总数。没有账单或已确认费率，因此不报告货币费用；运行时默认成本零值也不表示免费。

## 修复

StepFun 的真实响应已经返回 `RUNTIME-LIVE-OK-1`，但会话中 assistant content 是空数组。OpenAI-compatible 解析器在读取帧内 `usage` 后直接 `continue`，跳过同一帧里的正文、推理和工具增量以及结束原因。

最小修复保留 usage 处理，同时继续处理 choices。没有更改模型默认值、产品锁或权限策略。类型检查覆盖 runtime core 与 core-test；运行时重新构建并通过 Gateway smoke；脚本 lint、通信 replay/compare 和隔离候选的 diff-aware Harness 均通过。

生产修复及构建候选：`2749f07b2a5555f65ec45155a5936c038de5b53d`。
最终脚本及合成回放候选：`27b2f2961171c70c7eb02c48b190297474fe2eef`（随后仅增加用量聚合等待及证据说明）。已复用安装依赖，runtime 从修复候选重建。

## 凭据和运行边界

可复用入口为 [check-live-model-evidence.mjs](../../scripts/check-live-model-evidence.mjs)。通过进程 stdin 传入含 `key` 的 JSON，环境变量 `LIVE_MODEL_BASE_URL` / `LIVE_MODEL_ID` 指定端点和模型；参数指定一个不存在的输出目录。脚本最多允许 8 次提供方请求，直接请求输出上限 512 tokens，运行时请求显式限制 1024 tokens，未启用脚本自动重试。

真实密钥仅存在于调用脚本内存。隔离 Gateway 使用只在 loopback 监听的转发器和合成凭据，配置文件不含真实密钥；转发器不改写模型请求/响应内容，仅设置认证。合成回放另有明确的 responseOrigin 和 realProviderCalls=0 标记。

原桌面 E2E 已恢复到本轮开始前的字节。其配置错误及第一轮空回复失败保留，不宣称桌面验收通过。所有者转为脚本后没有继续桌面自动化。英文、中文和日文 README 的现有配置说明仍适用，不扩张能力或验收声明。

## 恢复后的真实脚本复验

2026-10-09 从干净候选 `a3e4cbb9ce370b0199399cce11765a6916b96181` 运行既有 Gateway-only 路径。脚本、修复源码和编译运行时摘要均与前次本地验收匹配，未加载合成 fetch 覆盖，也没有新增实现。第一轮真实返回 `RUNTIME-LIVE-OK-1`，第二轮准确回忆第一轮的随机标记。两次真实 SSE 都包含 usage 与 choices，修复后的运行时均保存了完整正文。

提供方两轮分别报告 6,520 / 6,553 tokens；运行时聚合为 13,073，缓存状态 fresh。第二轮缓存输入 6,144 只代表此次观测，不是稳定命中率或模型性能承诺。金钱费用未测量；没有把默认成本零值当作免费。

脚本 exit 0。原脚本以 exitCode 判断 Gateway 退出，信号终止时仍写出 gatewayExited=false / forcedCleanup=true；这些原字段保留。结束后的独立进程检查确认 runner 和 Gateway PID 均不存在，没有残留进程。此次 23 份本地收据/配置/日志文件的精确密钥扫描零命中。

此前 real_name_required 拒绝仅作为历史事件保留；当前这个限量脚本验收没有剩余阻断。真实凭据仍仅通过 stdin 进入脚本内存。原始新收据保存在 `D:/ClawX-work/stepfun-basic-evidence-20261008/resumed-20261009/`，包括原始报告、干净候选及资产摘要、独立进程检查和扫描。

此次补验没有重跑 Windows 全套或新安装包，原 Windows alpha 报告仍只绑定它自己的候选。不扩张桌面、其他模型、工具权限、跨平台或发布结论。

精选结果：[report.json](../../artifacts/stepfun-basic-live-evidence-20261008/report.json)。同目录保留凭据扫描和 SHA256SUMS。失败与原始收据：`D:/ClawX-work/stepfun-basic-evidence-20261008/`。工作区其他审计文件属于并行工作，未修改、未纳入本轮提交。

落地集成：远端并行清理已到 `2a08f3a72`，本轮在隔离检出合并，生产修复字节未变。四个证据/说明路径已加入新的 reviewed retention 清单，生成忽略规则及隔离 Harness 校验通过。主工作区的其他审计文件保留。
