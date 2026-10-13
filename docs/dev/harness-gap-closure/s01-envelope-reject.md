# S01：Provider 内容守卫的可拒绝窄边界

日期：2026-10-13（Asia/Shanghai）。包码：S01（TF-0276）。真实 provider 调用：无。

## 范围

把已有的 Stage-1 请求信封守卫从 shadow-only 观察升级为一个 **opt-in 可拒绝边界**：只有 RC-02 shadow 边界活动、且显式开启开关、且信封 `!ok` 时，才在 `fetchWithSsrFGuard` 之前抛出 `ProviderEnvelopeRejectedError`，从而不发送任何 provider 字节。

复用既有 RC-02 shadow 边界与既有 digest-only `shadow_wire` receipt；不新建 store/registry/router；不改变 SSRF、超时、代理、重定向或出站预算规则。

## 开关

- `ShadowReceiptOptions.rejectInvalidEnvelope`（默认 `false`），或
- 环境变量 `OPENCLAW_RC02_REJECT_INVALID_ENVELOPE`。

`resolveEnvelopeRejectEnabled()` 默认返回 false，所以默认与 flag-off 路径**与之前完全一致**（观察、不改变字节、请求照发）。

## 顺序保证

拒绝判定位于既有 `emitShadowWireReceipt(...)` 之后、`fetchWithSsrFGuard(...)` 之前：
1. 先写 digest-only wire receipt（只含 digest/ref/相关性摘要）；
2. 若开启且信封 `!ok` → throw，wire 从未发生。

## 实测（本地，无真实 provider）

- `resolveEnvelopeRejectEnabled`：默认 false；option/env 开启为 true；显式 false 为 false。
- 开启 + 非法信封（`transformIds: ['definitely-unregistered-transform']`）：抛 `ProviderEnvelopeRejectedError`，**provider fetch 调用数 = 0**。
- 关闭 + 同样非法信封：请求照常发出（fetch ≥ 1），行为不变。
- 既有守卫单测 `shadow-census.test.ts` + `stage1-request-envelope.test.ts` 15/15 通过（无回归）。

## 边界与基线残余

- 网络 SSRF / 超时 / 代理 / 出站预算独立，本包不接管。
- `openclaw_runtime` 的 **test-typecheck baseline 已红**：`tsgo:core:test` 在 7 个与本包无关的文件上共 12 条错误（context-health-monitor / http-endpoint-budget / tool-search-* / verseshell governed-process / capabilities v3 等），与 S01 文件无关，属既有基线，不扩大本包 ownedPaths 放行。
- `rc02-shadow-census.acceptance.test.ts` 的 “embedded runner …” 用例在本机 30s 超时：**已用 revert-我的改动 的干净基线复现同样超时**，故为既有环境/性能残余，非 S01 引入。
- 不改产品默认值/锁/approval；非真人证据。
