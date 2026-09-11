# SenseAudio 真实模型 CDP 采集 · 2026-09-11

已完成 **6 个会话、18 轮 CDP 输入**。这些是用户授权后，通过实际 Verse Claw 界面调用 `senseaudio-s2-flash` 产生的数据：没有替换模型回复，没有使用 mock Provider。

主要数据在 `dataset.jsonl`。每一行包含输入、答案、全部尝试、工具结果、时间、sessionKey、runId 和来源会话文件。`transcripts/` 保留脱敏后的原生 JSONL；`traces/` 保留运行标识、状态、用量的投影，剔除了完整 system prompt、启动元数据和重复的 messagesSnapshot。`cdp-actions.jsonl`、`host-events.jsonl` 和 `screenshots/` 提供操作与产品路径证据。

| 指标 | 实测值 |
|---|---:|
| 独立会话 | 6 |
| CDP 输入 | 18 |
| 原生 user 条目 | 19（同一输入发生一次自动重试） |
| 模型消息条目 | 73（含工具调用和 HTTP 500 错误条目） |
| 有用量的模型消息 | 72 |
| 工具结果 | 56 |
| 正常结束的输入 | 15 |
| 自动重试后结束的输入 | 1 |
| 被停止的输入 | 2 |
| 非缓存输入 tokens | 648,655 |
| 缓存读取 tokens | 984,704 |
| 输出 tokens | 3,165 |
| 应用会话 totalTokens | 1,636,524 |

另外执行了 2 次直接 Provider 预检，合计 772 tokens，独立保存在 `preflight.json` 和 `tool-protocol-preflight.json`，不混入上表的应用会话用量。Provider 未返回实际费用；运行时的 `cost=0` 来自未配置单价，不能解释成免费。

| 场景 | 实际结果 |
|---|---|
| 多轮约束 | 时间与预算更正被保留；最终 JSON 正确返回 15:10–15:55、4200 元。 |
| 订单计算与纠错 | 首次算错：4747/4247 分；追问后纠正为 7248/6748 分；变更数量后的 7798/7298 分也正确。错误样本保留。 |
| 文件诊断与修改 | 实际 read 定位漏乘 qty，实际 edit 修复。模型 exec 挂起后被停止；独立 CLI 复验 4/4 通过，模型随后如实说明测试来源。 |
| 文档读写 | 暂停阈值从 2% 改为 1.5%，生成检查清单，再次读取确认。候选经验没有写入正式知识。 |
| CSV 更新 | 首轮陷入重复 read，产生 43 条 read 结果（包括循环阻止结果），随后被停止。纠正后成功 edit/write，最终 doneCount=5、doneMinutes=63、pendingCount=1。 |
| 重载恢复 | 更正输入遇到一次 HTTP 500；应用以同一 runId 自动重试成功。CDP 重载页面后仍正确返回最新日期、负责人以及 email=null。 |

Provider 预检还记录到：工具调用响应包含 `tool_calls`，但第三方返回 `finish_reason=stop`。运行时仍然执行了工具，因此采集程序不能只凭 stopReason 判断整轮结束；需要等待没有待执行 toolCall 的最终消息，并保留各次尝试。

本轮修复了一个实际产品问题：Main 的密钥状态读取原先只检查 auth-profiles，误判环境变量 SecretRef 为未配置，导致首次发送被拦截。修复在 `electron/utils/openclaw-auth.ts`，保留原凭证优先级，尊重 env provider 与 allowlist，只在 Main 解析，不写回密钥。相关 112 项单元测试、1 项 Electron E2E、Main/Web/Test 类型检查、ESLint（0 error）和 comms replay/compare 已通过。任务专用 Harness validate 与 dry-run 通过。详细执行记录见 `validation/`。

全局 `harness:ci` 仍被整个分支的既有路径归属检查拒绝，没有计为通过；这仍属于 TF-0029 的全局验收范围。模型 exec 挂起及工具循环的产品级终止问题也没有被这份数据报告宣称修复；它们已留下可复现输入与结果。采集程序为后续轮次加了 12 条模型响应的上限，属于采集防护，不是运行时修复。

数据边界：输入、练习代码、文档和 CSV 由采集者新编；操作人是 Codex Agent。前两个会话沿用了应用默认 workspace，仅有对话和 update_plan；开始文件工具任务前，已通过应用 host API 把 workspace 明确切到专用练习目录。后四个会话的原生 cwd 已核对为该目录。这是目录与状态隔离，不是容器沙箱。

密钥通过子进程环境变量引用使用，未写入采集文件。结束时已停止本轮 Electron/Gateway；对采集目录 379 个文件、13,421,219 字节的精确密钥扫描命中为 0。原始资料留在本机采集目录，导出中的个人路径以占位符替换。

本批属于 **live-provider / agent-operated CDP** 证据。只读统计得到 `runtime_receipts=0`、`context_blocks=0`（`receipt-state.json`）；本轮没有打开 RC03 seal，也没有把对话语料冒充 receipt 基线、具名真人验收或 GA。TF-0009 的真人计数仍为 0/10、0/10、0/10。

离线验证（不请求模型、不访问网络）：

```powershell
python -X utf8 artifacts/live-model-cdp/20260911-senseaudio-s2-flash/verify.py
```

验证器检查 SHA-256、会话与尝试关联、用量、错误样本、自动重试去重、关键结果以及导出代码的 4 项测试。它验证的是数据完整性与所列结果，不把失败样本变成模型成功率证明。
