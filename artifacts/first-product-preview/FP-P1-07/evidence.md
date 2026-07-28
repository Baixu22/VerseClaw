# FP-P1-07 evidence - first-product Electron journey

| item | value |
|---|---|
| 收账日期 | 2026-07-28 |
| Electron E2E | `tests/e2e/first-product-journey-fp-p1-07.spec.ts` **4 passed (2.6m)** |
| runtime profile | 真 Electron + 真 Gateway + 本地 OpenAI-compatible HTTP Provider；只脚本化模型决策，不 mock Main/runtime/tools/journal |
| 原始汇总 | [`e2e-run.log`](./e2e-run.log) |
| 状态 | G1-G4 已满足；G5 独立验收后置，任务保持 `in_progress` |

## 成功主链

单一成功用例从干净 E2E user-data profile 经过 Setup、Provider/Model 验证、workspace 选择、DCS runtime ack，再执行真实 read/edit/test/undo。随后重启 Electron，恢复同一 session，再次执行 read/undo，最后从 UI 导出并校验 support bundle。

运行证据：

```json
{"model":"mock-coder","dcsAck":"applied","read":true,"edit":true,"test":true,"undoBeforeRestart":true,"undoAfterRestart":true}
```

测试还断言：

- Setup 实际显示 `Windows x64 controlled preview`；
- Settings 实际显示 `DCS Controlled Preview Flags` 与 `DCS Coding Controlled Preview`；
- edit 返回 diff，test 返回通过结果，两次 undo 都逐字恢复文件；
- restart 前后 session id 相同，盘上 journal 可继续消费；
- support bundle schema 为 `verse-claw-support-bundle/1`，runtime mirror 可用，且不含 Provider key 或源文件正文。

## 六类失败路径

| 失败类 | 可操作断言 | fail-closed 结果 |
|---|---|---|
| Gateway 未就绪 | 显示 start-gateway 操作 | 启动完成前 Next 禁用 |
| 无 Provider | 显示 configure-provider 操作 | Chat 发送被 Provider gate 拦截 |
| 凭据无效 | 提示粘贴新 key 并重试 | Provider 步骤不能继续 |
| model 不可用 | 显示 model-list 错误与 Retry | Model 步骤不能继续 |
| workspace 拒绝 | 显示选择其他目录的指引 | `C:\Windows` 不被接受 |
| approval / kill | ack 为 `failed/killed` 且显示 kill-switch 解释 | 不静默回退到启用态 |

## 门禁判定

- G1 dev：路线 A 已实现；spec 使用真 Gateway、本地 Provider 端点和具名失败断言。
- G2 test：精确命令 exit 0，4/4 通过；无 skip、占位断言或宽松 fallback。
- G3 runtime：成功链和失败矩阵均在真 Electron + 真 Gateway child 中执行，ack/lineage/journal/support bundle 均来自运行时。
- G4 human：n/a；本任务是自动化出口门禁，真人联合任务归 `FP-P2-02`。
- G5 accept：未满足。验收人必须不同于实现人；不得由本次自动化运行 self-accept。

## 运行说明

本次完整运行取代此前在 7.6 秒被用户中止的重复运行；那次中止既不是通过证据，也不记为测试失败。Node 输出的 `NODE_TLS_REJECT_UNAUTHORIZED=0` 警告已原样保留在日志中，它来自隔离测试 Provider 配置，不是产品默认策略证明。

## Residuals

- `FP-P1-07` 独立 G5 与 FP-P1 phase 出口确认留到最终集中真人阶段。
- 安装包级 clean install/升级/回滚不由该 E2E 宣称，仍归 `FP-P3-03`。

