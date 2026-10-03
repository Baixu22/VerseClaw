# ClawX 真实产品旅程 J-02（正常编码任务）· 2026-09-21

场景：启动 ClawX 生产构建 → 通过 host API 配置 senseaudio（`https://api.senseaudio.cn/v1`，`senseaudio-s2-flash`，custom/openai-completions）→ 创建 `fullAccess` 工作区并切换 → 重启 Gateway → 下达"修复 calc.js 使 `node --test` 通过"的任务 → 轮询 `chat.history` 并核对真实文件与测试结果。

| 项 | 实际值 |
| --- | --- |
| 候选 | `feat/runtime-lifecycle-governance`，含本轮两处修复（见下），dist 于 2026-09-21T13:5x 重建 |
| 操作者 | agent-driven（Claude Code 经 Playwright/CDP 操作 Electron renderer 的 `window.verseClaw.hostInvoke`），非真人 |
| provider | 真实 senseaudio，key 仅经驱动进程环境 → `providers.save`，落在隔离临时 user-data 的 safeStorage 密文中，运行结束后销毁；本目录密钥扫描 0 命中 |
| runId | `c5b3d298-c7fd-46b1-b982-30f8dee68092`，sessionKey `agent:main:main` |
| 时长 | 发送 14:02:24Z → 最终回复 14:03:22Z，约 58 秒 |
| 工具序列 | exec `node --test`（1 pass/2 fail）→ read ×2 → edit（`item.price` → `item.price * item.qty`）→ exec `node --test`（3 pass）→ git commit（首次 `&&` 在 PowerShell 报错、第二次缺 identity，第三次成功） |
| 结果核对 | `calc.js.after` 与 `journey.json.workspace.after` sha256 一致；驱动进程独立执行 `node --test` exit 0 |
| 收据 | `openclaw.sqlite` 只读计数 `runtime_receipts=0`、`effect_receipts=0`、`context_blocks=0`（RC-03 seal 未开启，与 0911 一致） |

## 本旅程逼出的产品缺陷（均已修复并有单测）

1. **custom provider 的 API key 到不了源码运行时。** ClawX 只把 key 写成 `~/.openclaw/agents/main/agent/auth-profiles.json`，而隔离运行时读 `<userData>/openclaw-source-state/agents/main/agent/openclaw-agent.sqlite`（JSON 格式已退役、迁移被跳过）；注册表 provider 靠 `loadProviderEnv` 的 env 注入幸存，custom 既无 env 也无 SecretRef。运行时报 `No API key found for provider "custom-senseaud"`（截图见旅程 run4）。修复：custom/ollama 条目写入 env SecretRef `{source:'env',provider:'default',id:'CUSTOM_SENSEAUD_API_KEY'}`，并在 Gateway 启动环境注入同名变量。
2. **工作区权限模式到不了源码运行时。** `tools.exec={security,ask}` 写在 `~/.openclaw/openclaw.json`，但隔离配置只同步 `agents/models/plugins/runtime`。运行时按"缺来源"策略降级为 allowlist/on-miss，`node --test` 触发 `exec.approval.requested`，ClawX 没有处理器，内联等待 30 分钟，377 秒被 stuck-session 恢复中止（旅程 run5，`reason=blocked_tool_call`）。修复：`tools` 加入 `SOURCE_RUNTIME_ISOLATION_SYNC_KEYS` 与初始隔离配置。

## 未修、需登记的观察

- ClawX 端 `sessions.history` 同样从 `~/.openclaw/agents/<id>/sessions` 读转写，对隔离运行时返回 `Transcript not found`（UI 聊天走 Gateway RPC 不受影响）。
- 非 `fullAccess` 工作区中模型执行非白名单命令仍会走 `exec.approval.requested`，ClawX 无 UI/处理器 → 同样的 6 分钟挂起。这是 TF-0032（审批和副作用恢复）的直接输入。
- provider save 在 Gateway 连接 8 秒内触发的 reload 会被跳过（`skipped_recent_connect`），首次配置需显式重启；驱动已用 `gateway.restart` 规避。
- 创建工作区会在用户项目目录 `git init` 并写入 20+ 引导文件（`AGENTS.md`、`.verse-claw/harness/**`、`.openclaw/**`）。
- host 层 `workspaces.switch` 后 renderer 头部仍显示"默认工作区/Read only"，需刷新才同步。
- 模型首次用 `&&` 在 PowerShell 失败、git 缺 identity，均自行恢复；保留为真实失败样本。

## 文件

`journey.json`（完整事件、前后文件哈希、测试输出、收据计数）、`session.jsonl`（运行时会话转写）、`app.log`（Electron 主进程日志）、`calc.js.after`、`driver.mjs` + `workload/`（可复现）、`screenshots/`。
