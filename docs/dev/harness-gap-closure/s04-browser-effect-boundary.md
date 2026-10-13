# S04：浏览器来源、会话归属与副作用边界（台账）

日期：2026-10-13（Asia/Shanghai）。包码：S04（TF-0279）。真实 provider / 真实浏览器账号调用：无。

## 链路（source → policy → effect）

`openclaw_runtime/src/agents/tools/agent-browser-tool.ts` 对**每个** action 先跑：
- `resolveAgentBrowserExternalAccessPolicy`（来源 + connectionMode）：external/derived-untrusted/missing/invalid 来源**不得**选择 `auto-connect` / `cdp` / `external-profile`；只有 `managed` 放行。
- `resolveAgentBrowserSessionEffectPolicy`（来源 + 会话语义）：**仅 click / type** 额外要求“会话被判定为 Main-owned managed”；否则拒绝。

两条策略都在 `openclaw_runtime/src/agents/tools/agent-browser-external-access-policy.ts`。

## 每个 action 的覆盖

| action | 外部来源闸门（连接模式） | 会话归属闸门（click/type 同款） | 备注 |
|---|---|---|---|
| status | ✅ 全 action 生效 | — | 只读 |
| navigate | ✅ | — | 受连接模式约束 |
| waitForSelector | ✅ | — | 只读等待 |
| click | ✅ | ✅ 仅 managed | 副作用 |
| type | ✅ | ✅ 仅 managed | 副作用 |
| screenshot | ✅ | — | 只读 |
| getConsoleMessages | ✅ | — | 只读 |
| **evaluate** | ✅ | ❌ **未接线** | 可执行页面 JS（残余） |
| **command** | ✅ | ❌ **未接线** | 任意浏览器命令（残余） |
| **close** | ✅ | ❌ **未接线** | 关闭会话（残余） |

## 残余 residual（显式记录，不冒充已覆盖）

- `evaluate` / `command` / `close` 是副作用型 action，但**没有**走 click/type 那套“会话必须 managed”的会话归属闸门；它们只受连接模式闸门约束。若 external 来源配 managed 会话，仍可执行这些 action。
- 本台账只覆盖 `agent_browser` 工具出口；不覆盖渲染器/其他浏览器入口。
- 不弱化 SSRF、private-network、kill switch：这些规则独立，未被本核验改动。

## 边界与不做项

- 只核验既有两条策略，不新建第三套策略；不改 managed/external 的既有语义。
- 不改产品默认值/锁/approval；非真人证据。
