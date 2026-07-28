# DCS 与关联组件就绪度复核（2026-07-20，P0 最终）

> 结论：**P0 受控投用资格已闭合，可进入 P1 小范围 opt-in canary；仍不具备 default-on、liveReady、productApproved 或联合系统 GA 资格。**

## 1. 最终判定

| 组件 | 当前判定 | 允许范围 | 仍然禁止/缺口 |
|---|---|---|---|
| DCS 核心与 Context tools | **浅绿：P1 canary ready** | 默认关闭、指定 cohort 的 on-demand tools | default-on、无界 cohort |
| Context Orchestrator | **浅绿：已纳入交付基线** | opt-in、kill-switchable | 绕过统一入口或熔断 |
| BlockStore / working-memory | **浅绿：受控候选** | 指定 workspace、显式开启 | 默认开启、无 soak 扩面 |
| VToken | **浅绿：受控候选** | Developer opt-in、可 kill | 默认开启 |
| Runtime Memory | **黄色：diagnostics-only** | scripted/synthetic eval 与受控 corpus 实验 | 默认 prompt injection、liveReady 宣称 |
| SEKB | **浅绿：人审 canary ready** | capture/suggest/confirm/retrieve | 自动写回、无人确认持久化 |
| Browser | **浅绿：监督 canary ready** | 公网 allowlist、审批升级、可解释恢复 | 私网默认开放、无人监督 |
| 发布与证据治理 | **浅绿：P0 证据闭合** | staged change set 与 shadow 复现 | commit/push/PR/发布未获授权 |

## 2. 最终可复现结果

| Gate | 结果 |
|---|---|
| `pnpm run p0:accept` | **通过**：8 files / 107 tests |
| `pnpm test:dcs` | **通过**：32 files / 253 tests |
| `pnpm lint:dcs` | **通过** |
| `pnpm contract:check` | **通过** |
| VToken + host-api + knowledge focused unit | **通过**：3 files / 70 tests |
| Runtime Memory enhanced eval | **通过**：17 files / 159 tests；scripted/synthetic |
| DCS P0 smoke | **通过**；默认值未改变 |
| `pnpm run build:vite` | **通过**；clean checkout 自动生成 ext bridge |
| Browser focused unit | **通过**：3 files / 24 tests |
| Browser Workbench E2E | **通过**：1/1，覆盖 interrupted + Retry |
| DCS W5 | **通过**：3/3，授权 sender/Main-owned Gateway 路径 |
| 关键 Electron 组合 | **通过**：6/6；主工作区与 shadow 各一轮 |
| `pnpm run maturity:validate` | **通过**：35 findings fresh，0 stale |
| Harness structural/shadow validate | **通过** |
| `git diff --cached --check` | **通过** |

## 3. 已关闭的原 P0 阻塞

### 3.1 W5 sender 接线漂移

根因是测试 helper 传空 IPC event，而不是生产 `senderAuth` 错误。W5 现使用真实 `BrowserWindow.webContents` sender，并通过 Main-owned `gateway.rpc -> chat.send -> agent.wait` 执行。missing sender、错误 sender id 与错误 URL 仍由 unit test 锁定为 fail-closed。

### 3.2 staged change set 与 clean checkout

Context Orchestrator、kill switch、SEKB/Browser 黄金路径、P0 gate、docs、Harness、task-forest 与必要 artifacts 已进入同一精准 staged inventory。`AGENTS.md` 和三个明确禁止的本地临时项保持未 stage。

shadow checkout 暴露并修复了 clean build 对 `_ext-bridge.generated.ts` 的隐含依赖：`prebuild:vite` 现在先运行生成脚本，P0 acceptance 同步锁定该契约。shadow 的 runtime build 和 6/6 Electron E2E 均通过。

### 3.3 maturity hash drift

14 个初始 mismatch 已通过既有 evidence collector、traceability 流程和官方 delivery hash 同步脚本处理。没有手改 frozen hash，也没有扩大 allowlist。最终 maturity validation exit 0。

## 4. Runtime Memory 证据边界

159 个增强评估测试继续通过，但证据仍由脚本化 driver、合成事实与确定性场景构成。缺少真实 corpus、human live A/B、soak 与产品批准，因此：

- `evidenceClass=scripted-synthetic`；
- `diagnosticsOnly=true`；
- `liveReady=false`；
- `productApproved=false`；
- TF-0006 保持 blocked。

## 5. 允许与禁止

允许：开始准备并执行边界明确、可回滚的 P1 内部 canary；独立启用 DCS、working-memory、VToken、SEKB 人审或 Browser 监督 profile。

禁止：翻转默认值、SEKB 自动写回、Browser 私网默认开放、Runtime Memory 默认注入、扩大为无界 cohort，或宣称 default-on/liveReady/productApproved/联合系统 GA。

完整收口与复现限制见 `docs/dev/component-controlled-rollout-p0-closeout.md`。
