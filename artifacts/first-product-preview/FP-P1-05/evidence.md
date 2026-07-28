# FP-P1-05 evidence - restart / recovery + live kill / rollback

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| Electron E2E | `tests/e2e/restart-recovery-fp-p1-05.spec.ts` **1 passed (1.9m)** |
| runtime build | `pnpm run build:runtime` **passed (30.8s)**，含真实 Gateway `/readyz` 冒烟 |
| rollback unit | `tests/unit/app-version-rollback.test.ts` **2 passed** |
| journal unit | `openclaw_runtime/src/agents/tools/write-journal.test.ts` **9 passed** |
| contract / typecheck | `pnpm contract:check`、`pnpm run typecheck` 均通过 |

## 七场景实证

| 场景 | 结果 |
|---|---|
| Gateway restart | child pid `28132 -> 32208`；generation 从旧世代换到新世代，旧 ack 不复用 |
| 应用重启 | session `dea60a9d-7e41-4a86-be60-f513e4427c12` 与 workspace 绑定恢复 |
| 会话中翻 kill | config kill 在 `6980ms` 内完成新 child ack；working-memory/tool-registry 关闭，`wouldChangeTurn=false` |
| kill 后 undo | 真实 agent `undo_write` 返回 `ok:true`，工作区文件逐字恢复 |
| flag-off rollback | `wouldChangeTurn=false`，且 `writeJournal=true`、`worktree=inprocess`、`patchFlow.default=false` 保守基线不变 |
| N -> N-1 | `999.0.0 -> 40.8.4`；普通语言/provider/workspace/文件数据保留，7 个可写预览 flag 强制 OFF |
| restart 失败 | 返回 `pending-restart / restart-failed` 和 operator hint；修复 config 路径后新 child pid `30388` 正常 ack |

## Journal 与世代

E2E 通过真实 agent `edit` 生成 journal，不手工伪造 snapshot。首条 meta 的
`lineage.gatewayGeneration="1"` 与 restart 前 child ack 一致，且带非空 requestId。
Gateway restart 与 Electron restart 后，均由真实 `undo_write` 消费盘上 journal 并恢复内容。

实现锚点：

- `openclaw_runtime/src/agents/tools/write-journal.ts:170` 使用 launcher 实际注入的
  `VERSE_CLAW_GATEWAY_GENERATION`。
- `electron/utils/app-version-rollback.ts:81` 负责降级时的 DCS config fail-closed。
- `electron/utils/app-version-rollback.ts:149` 记录版本迁移与强制关闭 flag 清单。
- `tests/e2e/restart-recovery-fp-p1-05.spec.ts:180` 串行执行全部七场景。

## 构建阻塞与修复

首次重跑发现根 `build:runtime` 清空 `openclaw_runtime/dist` 后只构建核心 entry，
旧 `dist-runtime/extensions/**` wrapper 因缺少 `dist/extensions/**` 公开产物而无法启动 Gateway。
修复后默认构建复用 OpenClaw `cliStartup` 完整编排，并新增真实启动冒烟：

- `scripts/build-openclaw-runtime.mjs:41` 调用 runtime 自有 `build-all.mjs cliStartup`。
- `scripts/smoke-openclaw-runtime.mjs:144` 在隔离 state/config 下等待 `/readyz`。
- 冒烟同时加载 DeepSeek provider wrapper，直接锁住本次缺产物边界。

`pnpm run build:runtime` 最终输出：

```text
[build-all] phase timings: total 13.8s
[runtime-build-smoke] gateway ready on port 49355
```

## Kill 生效上界

本任务把产品上界定义为：**配置写入后 180 秒内完成真实新 child ack，且下一轮 agent turn 前生效**。
本机实测 `6980ms`。测试在收到 kill ack 后才允许下一轮，随后真实 `undo_write` 仍可执行；
不存在 UI 显示已停止、child 仍继续注入的未观测窗口。

## 门禁判定

- G1 dev：版本降级 fail-closed、journal generation、完整 runtime clean build 与 boot smoke 已落地；默认值未翻转。
- G2 test：2 + 9 单测，单文件 Electron E2E 1 passed；失败注入断言具体状态、错误和恢复。
- G3 runtime：真 Electron、真 Gateway children、真 agent tools、真 journal、真 restart failure/recovery。
- G4 human：n/a；长时真人 soak 仍归 `FP-P2-02`，本任务不冒充真人证据。
- G5 accept：self-accept；理由是本任务不是 FP-P1 phase 独立出口，全部 AC 有机器证据。阶段独立验收仍由 `FP-P1-07` 承担。

## Residual

- `FP-P3-05` 继续负责更广泛的 E2E dist 新鲜度守卫；本任务只闭合 clean `build:runtime` 的完整产物与可启动性。
