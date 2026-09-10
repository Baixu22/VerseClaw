# 模型端错误参考（Model Error Reference）

> 状态：缺口补齐交付物（对比主流 agent 错误处理后的两项低风险补齐之一）
> 日期：2026-08-25
> 分支：codex/model-error-gap-fill
> 范围：ClawX（内置 OpenClaw 运行时）处理模型请求时**用户可见**的错误文案、触发原因与恢复步骤
> 注意：文案以撰写时 HEAD 为准；`openclaw_runtime` 上游文案变化时需同步更新本文档。
> 上游参考：OpenClaw 官方 [Model failover](https://docs.openclaw.ai/concepts/model-failover)

---

## 1. 架构概览

模型端错误处理分三层：

1. **分类层**：所有模型侧失败被归一成 15 种闭集 `FailoverReason`
   （`openclaw_runtime/src/agents/embedded-agent-helpers/types.ts`），
   上层逻辑永不解析原始错误文本：

   | 分组 | Reason |
   |---|---|
   | 鉴权 | `auth` / `auth_permanent` |
   | 配额与容量 | `rate_limit` / `overloaded` / `billing` |
   | 服务端与网络 | `server_error` / `timeout` |
   | 模型与请求 | `model_not_found` / `format` / `session_expired` |
   | 模型输出 | `refusal` / `empty_response` |
   | 兜底 | `no_error_details` / `unclassified` / `unknown` |

2. **恢复层**：三层递进的恢复阶梯
   （决策引擎 `openclaw_runtime/src/agents/embedded-agent-runner/run/failover-policy.ts`）：
   - **同模型重试**：idle 超时（模型长时间不吐字）同模型重试；overload 先退避再重试；
     thinking 级别不支持时自动降档重试。
   - **鉴权档案轮换**：401/429 时自动换下一个 API key/OAuth profile；失败档案进入冷却
     （`blockedUntil`/`cooldownUntil`/`disabledUntil`），冷却期内允许有限的"探针"请求试探恢复。
   - **模型回退链**：凭证耗尽后沿 `agents.defaults.model.fallbacks` 逐个切换；
     回退是 **turn 级**的——不改变会话选择的模型，下一轮仍从所选主模型开始。

3. **展示层**：原始错误文本被改写为可操作的用户文案（本文档第 2 节），
   并经过隐私消毒（路径、堆栈、密钥形状不外泄）；日志同样做注入消毒。

**瞬态/非瞬态纪律**：`format` / `model_not_found` / `auth_permanent` / `session_expired`
被判定为非瞬态——同样的请求重试必然同样失败，因此不做无效重试；
瞬态错误（`rate_limit` / `overloaded` / `timeout` 等）才消耗重试与探针预算。

---

## 2. 用户可见错误文案总表

### 2.1 鉴权类

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| Authentication failed (provider returned HTTP 401). Your provider token may have expired — try the request again in a moment. If the failure persists, re-authenticate this provider. | 供应商返回 401 且错误文案为通用令牌失效形态 | 稍等重试；持续失败则重新登录该供应商 |
| Authentication failed at the provider. Re-authenticate and verify your provider credentials and account access. | 供应商鉴权页返回 HTML（非 API 响应） | 重新鉴权；核对账号对该模型/服务的访问权限 |
| Authentication is missing the required OpenAI ChatGPT scopes. Re-run OpenAI login and try again. | OAuth scope 不足 | 重新执行 OpenAI 登录 |
| Authentication refresh failed. Re-authenticate this provider and try again. | 令牌刷新失败 | 重新鉴权该供应商 |
| Authentication refresh is already in progress elsewhere and this attempt timed out waiting for it. Retry in a moment. | 令牌刷新竞争 | 稍等重试 |
| Authentication refresh timed out before the provider completed. Retry in a moment; re-authenticate only if it keeps failing. | 令牌刷新超时 | 稍等重试；反复失败再重新鉴权 |
| Browser OAuth did not complete before manual fallback kicked in. Retry the login flow and paste the redirect URL if prompted. | 浏览器 OAuth 回调超时 | 重新登录；按提示粘贴完整重定向 URL |
| Browser OAuth returned an invalid or incomplete callback. Retry the login flow and make sure the full redirect URL is pasted. | OAuth 回调无效/不完整 | 重新登录并粘贴完整重定向 URL |
| Re-authenticate with: `openclaw models auth login --provider <provider> --force` | 回退链因鉴权失败耗尽时的修复提示（自动附带可粘贴命令） | 直接执行提示中的命令 |

### 2.2 限流与计费类

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| ⚠️ API rate limit reached. Please try again later. | `rate_limit`（429/供应商限流文案） | 等待后重试；系统会自动轮换凭证/回退模型 |
| ⚠️ {供应商限流详情} | 供应商 429 且自带具体重试提示（时长/配额字样） | 按文案中的时间窗等待 |
| ⚠️ Selected model is at capacity. Try a different model, or wait and retry. | 供应商报告模型容量已满 | 换模型或稍后重试 |
| The AI service is temporarily overloaded. Please try again in a moment. | `overloaded` | 稍后重试；系统先退避再重试 |
| ⚠️ {provider} ({model}) returned a billing error — your API key has run out of credits or has an insufficient balance. Check your {provider} billing dashboard and top up or switch to a different API key. | `billing`（402/余额不足，含中文文案"余额不足/欠费"匹配） | 充值或更换 API key |
| ⚠️ API provider returned a billing error — your API key has run out of credits or has an insufficient balance. Check your provider's billing dashboard and top up or switch to a different API key. | 同上（无供应商上下文时的通用文案） | 同上 |
| ⚠️ The model provider returned HTTP 429 before replying. This can mean rate limiting, exhausted quota, or an account balance/billing issue. Check the selected provider/model, API key, and provider billing/quota dashboard, then try again. | 请求发出前即 429 且为通用运行时错误文案 | 检查供应商/模型、API key、计费面板 |

### 2.3 上下文溢出类

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model. | 上下文超出模型窗口（含各家供应商特化文案匹配） | `/reset` 或 `/new` 重开会话；或换大上下文模型。系统会先尝试自动压缩（见 3.3） |
| Context overflow: prompt too large for the model (precheck). | 发送前预估即超窗（预压缩检查） | 同上 |

### 2.4 会话状态类

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| ⚠️ The model provider rejected the conversation state. Please try again, or use /new to start a fresh session. | 供应商拒绝会话状态（角色顺序错乱、tool 配对缺失等） | 重试；持续失败用 `/new` |
| Message ordering conflict - please try again. If this persists, use /new to start a fresh session. | 消息角色顺序错误（含 JSON 包裹/"400" 前缀变体） | 重试或 `/new` |
| Session history looks corrupted (tool call input missing). Use /new to start a fresh session. If this keeps happening, reset the session or delete the corrupted session transcript. | 历史中 tool call 输入缺失 | `/new`；反复出现则重置/删除损坏的会话转录 |
| Session history or replay state is invalid. Use /new to start a fresh session and try again. | replay 状态无效 | `/new` |

### 2.5 格式与流式类

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| LLM request failed: provider rejected the request schema or tool payload. | 供应商拒绝请求 schema/工具载荷（非瞬态，不无效重试） | 重试通常无意义；`/new` 重开会话或检查工具配置 |
| LLM streaming response contained a malformed fragment. Please try again. | 流式响应畸形片段/流式 JSON 解析失败 | 重试 |
| LLM request failed: provider returned an invalid streaming response. Please try again. | 流式事件顺序非法（message_start/message_stop 乱序） | 重试 |
| Reasoning is required for this model endpoint. Use /think minimal (or any non-off level) and try again. | 端点强制要求 reasoning | `/think minimal`（或任意非 off 级别）后重试 |
| The AI service returned an internal error. Please try again in a moment. | 供应商通用内部错误（如 "An error occurred while processing your request"） | 稍后重试 |

### 2.6 网络与超时类

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| LLM request timed out. | 请求超时（`timeout`） | 重试；系统按瞬态处理并可能轮换凭证 |
| LLM request failed: connection refused by the provider endpoint. | ECONNREFUSED/连接被拒 | 检查端点地址/代理 |
| LLM request failed: network connection was interrupted. | ECONNRESET/EPIPE/socket hang up 等 | 检查网络后重试 |
| LLM request failed: DNS lookup for the provider endpoint failed. | ENOTFOUND/EAI_AGAIN/DNS 失败 | 检查 DNS/域名 |
| LLM request failed: the provider endpoint is unreachable from this host. | ENETUNreach/EHOSTUNREACH 等 | 检查路由/防火墙 |
| LLM request failed: network connection error. | fetch failed/通用连接错误 | 检查网络 |
| LLM request failed: provider reported a network error. | 供应商中文网络错误文案（网络错误/网络异常/连接错误） | 稍后重试 |
| The provider returned an HTML error page instead of an API response. This usually means a CDN or gateway (e.g. Cloudflare) blocked the request. Retry in a moment or check provider status. | CDN/网关返回 HTML 错误页 | 稍后重试；查看供应商状态页 |
| LLM request failed: proxy or tunnel configuration blocked the provider request. | 代理/隧道配置阻断 | 检查代理配置 |

### 2.7 本地资源与其他

| 文案 | 触发原因 | 恢复步骤 |
|---|---|---|
| OpenClaw could not write local session data because the disk is full. Free some disk space and try again. | ENOSPC/磁盘满 | 清理磁盘空间 |
| Request failed after repeated internal retries. Please try again, or use /new to start a fresh session. | 内部重试预算耗尽且不满足模型回退条件 | 重试或 `/new` |
| LLM request rejected: {供应商 invalid_request 详情} | 供应商 `invalid_request_error`（消息体直接透出） | 按详情处理；常见为历史状态问题，可 `/new` |
| LLM request failed. | 无法归类的兜底文案 | 重试；若持续出现请附带日志反馈 |

### 2.8 UI 层（ClawX 渲染进程归一化）

来自 `src/lib/error-message.ts`（`AppError` 码 → 统一文案，未知错误经隐私消毒后才展示）：

| 文案 | 错误码 | 恢复步骤 |
|---|---|---|
| Authentication failed. Check API key or login session and retry. | AUTH_INVALID | 检查 API key/登录态 |
| Request timed out. Please retry. | TIMEOUT | 重试 |
| Too many requests. Please wait and try again. | RATE_LIMIT | 等待后重试 |
| Permission denied. Check your configuration and retry. | PERMISSION | 检查配置/权限 |
| Service channel unavailable. Retry after restarting the app or gateway. | CHANNEL_UNAVAILABLE | 重启应用或网关 |
| Network error. Please verify connectivity and retry. | NETWORK | 检查网络连接 |
| Configuration is invalid. Please review settings. | CONFIG | 检查设置 |
| Gateway is unavailable. Start or restart the gateway and retry. | GATEWAY | 启动/重启网关 |
| Unexpected error occurred. | UNKNOWN | 查看日志；反馈时附带复现步骤 |

### 2.9 动态文案（不逐条列出）

- **回退通知**：某轮转到回退模型时发送可见通知（群聊/频道会话除外），后续回到所选主模型时再发一次恢复通知；`/status` 可查看所选模型与当前生效的回退模型及原因。
- **回退链耗尽**：所有候选失败时抛出携带每次尝试记录的 `FailoverError`，外层据此生成如
  "all models are temporarily rate-limited" 的具体消息，并附最近冷却到期时间（模型感知）。
- **沙箱工具策略拦截**：模型调用不存在/被策略禁止的工具时，错误会被改写为工具策略说明文案
  （含工具名），并计入工具循环检测。

---

## 3. 内部行为说明

### 3.1 重试与退避

- 频道/网络操作默认 3 次重试：400ms 起步、上限 30s、jitter 0.1；
  重试判定覆盖 `429|421|timeout|connect|reset|closed|unavailable|temporarily`；
  支持读取服务端 `retry-after`（`openclaw_runtime/src/infra/retry-policy.ts`）。
- 纯过载导致全链失败时：在尚未产生工具执行/助手输出的前提下，
  整个 turn 级候选链最多重试 10 次（指数退避），30 秒后发送一次状态通知避免静默等待。

### 3.2 冷却与探针

- 失败凭证档案进入冷却；瞬态原因（`rate_limit`/`overloaded`/`timeout`/未知类）
  允许在冷却期发**限量探针**（每供应商每次回退运行最多 1 个），非瞬态原因不消耗探针预算。
- 冷却中的同供应商兄弟模型在失败看起来瞬态时仍可尝试（限流常是模型维度的）。

### 3.3 上下文溢出自愈

- 发送前预估（`preemptive-compaction.ts`）：prompt 压力超过预算先在本地做预压缩。
- 运行中溢出（`run.ts`）：attempt 内自动压缩后重试，有次数上限；
  压缩后仍溢出则记录并继续尝试。
- 历史配对修复：发往严格供应商前自动修复 tool_use↔tool_result 配对
  （`session-transcript-repair.ts`），减少"供应商拒绝会话状态"类错误。

### 3.4 Fallback skip cache（本轮新增默认值）

- `OPENCLAW_FALLBACK_SKIP_TTL_MS`：启用后，回退链对最近因 `auth`/`auth_permanent`
  失败的候选在 TTL 内不再逐轮重试（内存态、按 `(sessionId, provider, model)` 作用域、
  网关进程重启即清；runtime 钳制范围 1s–10min）。
- **ClawX 默认**：启动网关时注入 `60000`（60s，与 OpenClaw 官方文档示例一致），
  注入点在 `electron/gateway/process-launcher.ts` 的 `buildGatewayRuntimeEnv()`。
- **覆盖方式**：用户 shell 环境中的显式值优先（含 `0` = 关闭本机制）。
- 未启用时的行为：每轮重试每个配置的回退候选，包括最近鉴权失败的候选
  （保证修复凭证后无需重启即恢复）。

### 3.5 工具循环保护

- 最近 30 次工具调用受监控（`tool-loop-detection.ts`）：重复调用、
  反复调用不存在的工具（`unknown_tool_repeat`）、无进展轮询、全局熔断等。
- 反复调用不存在工具达到阈值时，向模型注入明确停止指令，引导其放弃该工具继续作答。

---

## 4. 代码路径索引

| 文案分组 | 主要源文件（相对仓库根） |
|---|---|
| 鉴权类（2.1） | `openclaw_runtime/src/agents/embedded-agent-helpers/errors.ts`（`formatAssistantErrorText`）；`openclaw_runtime/src/agents/failover-error.ts`（re-auth 命令提示） |
| 限流与计费类（2.2） | `openclaw_runtime/src/agents/embedded-agent-helpers/sanitize-user-facing-text.ts`；`openclaw_runtime/src/auto-reply/reply/provider-request-error-classifier.ts` |
| 上下文溢出类（2.3） | `openclaw_runtime/src/agents/embedded-agent-helpers/errors.ts`；`openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts` |
| 会话状态类（2.4） | `openclaw_runtime/src/agents/embedded-agent-helpers/errors.ts`；`openclaw_runtime/src/auto-reply/reply/provider-request-error-classifier.ts` |
| 格式与流式类（2.5） | `openclaw_runtime/src/shared/assistant-error-format.ts`；`openclaw_runtime/src/agents/embedded-agent-helpers/errors.ts` |
| 网络与超时类（2.6） | `openclaw_runtime/src/agents/embedded-agent-helpers/sanitize-user-facing-text.ts`（`formatTransportErrorCopy`） |
| 本地资源与其他（2.7） | `openclaw_runtime/src/agents/embedded-agent-runner/run/retry-limit.ts`；`openclaw_runtime/src/agents/embedded-agent-helpers/errors.ts` |
| UI 层（2.8） | `src/lib/error-message.ts`；`src/lib/error-model.ts`；`shared/privacy/ui-error-sanitize.ts` |
| 分类与恢复逻辑 | `openclaw_runtime/src/agents/embedded-agent-helpers/types.ts`；`openclaw_runtime/src/agents/failover-error.ts`；`openclaw_runtime/src/agents/embedded-agent-runner/run/failover-policy.ts`；`openclaw_runtime/src/agents/model-fallback.ts`；`openclaw_runtime/src/agents/fallback-skip-cache.ts` |