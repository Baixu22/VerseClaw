# G01：错误返回可执行且受权限约束的修复动作

日期：2026-10-13（Asia/Shanghai）。包码：G01（TF-0289）。真实 provider 调用：无。

## 链路

`src/lib/error-model.ts` 的 `AppErrorCode` 现在绑定一张预登记 recovery 表：

- 每个 code 有 `retryable`（布尔）与 `scope`（`self-retry` / `user-action-required`）与可选 `action`。
- `AppError` 实例携带 `retryable` 与 `nextAction`。

## 约束

- **固定动词**：`nextAction.kind` ∈ `retry | reauthenticate | reconfigure | open-settings | contact-support`；键只有 `kind`(+`target`)。
- **非可执行**：绝不出现 `command/cmd/script/shell/exec/argv` 等字段。
- **权限边界**：只有 `self-retry` 类（TIMEOUT/RATE_LIMIT/NETWORK/GATEWAY/OVERLOADED/CHANNEL_UNAVAILABLE）retryable=true 且 action=`retry`；其余为 `user-action-required`（如 PERMISSION→open-settings:permissions、CONFIG→reconfigure、MODEL_NOT_FOUND→reconfigure:model、BILLING→open-settings:billing）。
- **无法自动修复即暴露原始错误**：`UNKNOWN` 不携带 action。
- 复用既有单一 envelope（`HostResponse`/`AppError`），不新增第二套 envelope 或错误类型。

## 实测

| 断言 | 结果 |
|---|---|
| 每个 code 都有 recovery 表项 | ✅ |
| 只有 self-retry 可 retry，action 恰为 retry | ✅ |
| nextAction 无任何可执行字段、键受限 | ✅ |
| AppError 带 retryable/nextAction；UNKNOWN 无 action | ✅ |
| 既有 error-governance 检查 16 checks PASS | ✅ |

## 残余（residual）

- 本包提供 error→recovery 映射；具体 UI 展示“下一步”按钮属渲染层集成。
- 不改默认值/产品锁/approval；非真人证据。
