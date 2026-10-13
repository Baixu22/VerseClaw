# S02：敏感 sink 覆盖台账（enforced / partial / residual）

日期：2026-10-13（Asia/Shanghai）。包码：S02（TF-0277）。真实 provider 调用：无。

本台账是对既有 `shared/security/content-provenance.ts` 的 `SENSITIVE_SINK_CLASSIFICATION` 的**执行化核对**：逐 sink 记录“来源→策略→副作用”实际接到哪一步，并列出**未覆盖的残余出口**。它证明的是“某些出口有窄闸门”，**不是**“全网强制”。

## 六个 sink 的强制程度（权威来源：代码）

| sink | enforcement | 策略模块 | 导出符号 | 生产调用点 | 拒绝形态 |
|---|---|---|---|---|---|
| secret-read | narrow | `openclaw_runtime/src/agents/tools/message-secret-read-policy.ts` | `assertMessageSecretReadAllowed` | `openclaw_runtime/src/agents/tools/message-tool.ts` | policy-throw |
| network-send | narrow | `openclaw_runtime/src/infra/outbound/outbound-policy.ts` | `enforceCrossContextPolicy` | `openclaw_runtime/src/infra/outbound/message-action-runner.ts` | policy-throw |
| external-write | narrow | `openclaw_runtime/src/agents/workspace-external-write-provenance-policy.ts` | `wrapToolWithWorkspaceExternalWriteProvenance` | `openclaw_runtime/src/agents/agent-tools.ts` | policy-throw |
| command-exec | source-dependent | `openclaw_runtime/src/agents/exec-provenance-policy.ts` | `resolveCommandExecProvenancePolicy` | `openclaw_runtime/src/agents/bash-tools.exec.ts` | constrain |
| browser-effect | narrow | `openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.ts` | `resolveAgentBrowserExternalAccessPolicy` / `resolveAgentBrowserSessionEffectPolicy` | `openclaw_runtime/src/agents/tools/agent-browser-tool.ts` | call-site-throw |
| credential-use | narrow | `openclaw_runtime/src/agents/tools/provider-credential-use-policy.ts` | `resolveProviderCredentialUsePolicy` | `openclaw_runtime/src/agents/tools/image-generate-tool.ts` | call-site-throw |

以上每一行的 policyFile / 导出符号 / callSite / 拒绝形态都由 `tests/unit/sensitive-sink-enforcement-drift.test.ts` 对工作树逐项解析验证，并由该测试的反向扫描保证“新增 provenance 闸门必须登记进表”。

## network-send 的残余出口（未接入 cross-context 闸门）

`enforceCrossContextPolicy` 目前**只在** `message-action-runner.ts` 调用（工具驱动的 message-action 路径）。下列出口目前**不**引用 `isExternalOrUnknownProvenance` / `enforceCrossContextPolicy`（对工作树逐文件核对，0 命中），属 **residual / classification-only**：

- `openclaw_runtime/src/infra/outbound/outbound-send-service.ts`（低层 send service / channel action dispatch）
- `openclaw_runtime/src/channels/plugins/message-action-dispatch.ts`（插件 action 直派）
- `openclaw_runtime/src/gateway/cli-runtime/outbound-send-deps.ts`（CLI runtime 出口）
- `openclaw_runtime/src/sessions/send-policy.ts`
- `openclaw_runtime/src/auto-reply/send-policy.ts`
- `openclaw_runtime/src/gateway/server-broadcast.ts`（网关广播）

残余由 `tests/unit/sensitive-sink-residual-ledger.test.ts` 钉住：一旦上述任一出出口接入 provenance 闸门，该测试会失败，强制同步更新本台账（避免“悄悄扩大覆盖”或“台账过期”）。

## 边界与不做项

- 本台账**不**声称任何 sink 已被全网强制；`narrow` 只是“某条生产路径会拒绝”。
- `command-exec` 是 `source-dependent`（收紧既有 security/ask 底线），不是直接拒绝；`command-exec` 的正反回归基线沿用既有测试。
- 不新建第二套 provenance 引擎；不改产品默认值/锁/approval；无真实 provider 调用。
