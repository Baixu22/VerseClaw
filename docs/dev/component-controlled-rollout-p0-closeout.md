# DCS 与关联组件受控投用 P0 收口

> 日期：2026-07-20
> 判定：**P0 通过，可开始准备/执行 P1 小范围受控 canary；不是 default-on、liveReady、productApproved 或联合系统 GA。**

## 1. 收口结论

本轮已把此前仅在主工作区成立的绿色状态，收敛为可审查的 Git change set，并恢复真实 Windows Electron 接线证据：

- DCS W5 在既有 `senderAuth` 边界下 3/3 通过；缺失、错误 sender id 或错误 URL 继续 fail-closed；
- DCS Settings、DCS W5 三条、SEKB、Browser 关键组合 6/6 通过；
- P0、DCS、contract、focused unit、Runtime Memory eval、smoke、build、lint/typecheck/i18n 与 maturity 门禁通过；
- Context Orchestrator、kill switch、SEKB/Browser 路径、测试、文档和必要 evidence 已纳入同一 staged inventory；
- staged patch 已在从 `HEAD` 构造的 shadow checkout 中完成 build/runtime 构建和关键 6 条 Electron E2E 复现。

允许的下一状态仅是 **P1 controlled canary ready**：可开始准备 owner、cohort、预算、指标、隐私边界、kill switch 与 rollback，并执行最小受控任务。P1 实际投放尚未发生。

## 2. W5 根因与修复

旧 W5 helper 直接调用 Electron 私有 `ipcMain._invokeHandlers.get('host:invoke')`，却传入空 IPC event。`senderAuth` 正确拒绝该请求并返回 `Host request missing sender`，Gateway readiness 因同一路径无法执行而显示 `startAttempts: 0`。

修复没有降低生产安全要求：

1. 以真实 `BrowserWindow.webContents` 构造授权 sender，并保留 sender id、frame URL 与 session 绑定；
2. 不再从禁止返回 renderer 的 `gateway.controlUi` 读取 token；
3. 使用 Main-owned `gateway.rpc -> chat.send -> agent.wait` 路径；
4. 每条 W5 用例使用独立 Gateway 端口并显式 restart；
5. `ensureGatewayReady` 保留 validation/start/status 的最后根因并快速失败；
6. `tests/unit/host-invoke.test.ts` 锁定 missing sender、错误 id、错误 URL 的 fail-closed 行为。

结果：主工作区 W5 3/3 通过；关键组合 6/6 通过；shadow checkout 关键组合再次 6/6 通过。default-off 场景仍报告 `toolCount=32`，未出现默认开启漂移。

## 3. 成熟度证据处理

最初 `maturity:validate` 的 14 个 hash mismatch 均映射到本轮有意的 host-api、Browser、contract、IPC 与 package 变更。处理严格使用现有 collector 和官方 hash 同步脚本：

- 运行 traceability evidence 流程；
- 首次 collector 因自身更新 focused hash 失败后，以 `--resume` 继续并通过；
- traceability 最终为 35 findings、35 fresh、0 stale；
- 使用 `node scripts/update-system-maturity-delivery-hashes.mjs` 同步 delivery hash；
- 未手改 frozen hash，未扩大 drift allowlist；
- 最终 `pnpm run maturity:validate` exit 0。

## 4. clean-checkout / shadow 复现

验证使用从仓库 `HEAD` 克隆、仅应用 staged patch 的 shadow checkout。

- 第一 shadow 独立执行 `pnpm install --frozen-lockfile`，完成 build 与全部非 Electron P0 门禁；Electron 默认源下载超时后，改用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 独立取得并验证 Electron 40.8.4。
- clean checkout 首次 build 暴露缺失 `_ext-bridge.generated.ts`，因此在 `package.json` 增加 `prebuild:vite` 调用 `scripts/generate-ext-bridge.mjs`，并由 P0 acceptance 测试锁定。
- 短路径 shadow 通过 junction 复用本机 pnpm 依赖缓存，并补齐 `ipaddr.js`、`markdown-it` 的 pnpm 隔离解析投影；`node scripts/build-openclaw-runtime.mjs` 通过。
- 关键 Electron 组合在较早短路径 shadow 中 6/6 通过（671.4 秒），并在包含最终当前 staged patch 的新 shadow 中再次 6/6 通过（643.7 秒）。

限制：Electron 二进制虽由 shadow 独立下载，但最终关键 E2E 为避免临时 pnpm copy 的包文件缺失，复用了原工作区依赖缓存/junction。该验证证明 staged source/runtime 接线可复现，不等同于完全离线、全新依赖缓存的供应链复现。

## 5. 默认值与安全边界

以下状态保持不变：

- DCS、working-memory、VToken、Runtime Memory inject、SEKB 默认关闭；
- Context enhancement kill switch 保留且 fail-closed；
- SEKB 仍需人工确认，不存在自动写回 worker；
- Browser 私网默认拒绝，mode upgrade 需要用户批准；
- Runtime Memory 仍为 diagnostics-only，159 个测试属于 scripted/synthetic evidence；
- `liveReady=false`、`productApproved=false`、`readyForDefaultFlagGraduation=false`、`jointSystemGa=false`；
- TF-0006 保持 blocked。

## 6. Git inventory 与排除项

Goal 相关实现、测试、docs、Harness、task-forest 和必要 evidence 已精准 stage；未使用 `git add -A`。

明确保持未 stage：

- `AGENTS.md`（用户既有改动）；
- `.tmp-compass-skills/`；
- `compass-skills.zip`；
- `_acc.py`。

`git diff --cached --check` 通过。正式 Harness diff 在主工作区只会看到上述 4 个非 Goal 路径；shadow checkout 中只应用 staged patch，Harness spec 校验通过。

## 7. 文档同步审阅

已审阅 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`。本轮恢复既有受控路径、测试接线和证据封装，没有新增或改变面向普通用户的产品流程、外部接口或默认行为，因此无需同步修改三份 README。

## 8. 剩余事项

- P1 canary 尚未实际执行，仍需明确 owner/cohort/budget/metrics/privacy/rollback 并产生真实运行记录；
- Runtime Memory 缺少真实 corpus、human live A/B、soak 与产品批准，继续 diagnostics-only；
- TF-0006 继续阻塞 default-on 与 GA 讨论；
- 完全独立、空缓存依赖安装的 Electron E2E 仍可作为后续供应链强化项，但不改变本轮 staged source 的 P0 结论。

机器可读详情见 `artifacts/component-controlled-rollout-p0/final-report.json`。
