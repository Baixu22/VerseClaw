# J-03 SenseAudio coding journey with receipt flags

- Operator: agent-driven (Playwright/CDP). Not a human operator.
- Candidate: `b6c73619189f729c9e87b27210bb6abc21c1cda7` branch `feat/runtime-lifecycle-governance`, dirty=`false`.
- Provider: senseaudio-s2-flash via `https://api.senseaudio.cn/v1`. The key lived only in the driver process environment and was passed through `providers.save` into an isolated temp user-data directory. It is not in this directory.
- Flags: `OPENCLAW_RC02_SHADOW_CENSUS=1` and `OPENCLAW_RC03_SEAL=1` were set only on the Electron process spawned by the driver. Product defaults stay off.
- Result: finished=true; tests before exit 1, after exit 0.
- Receipts, read from `openclaw.sqlite` with node:sqlite read-only: runtime_receipts=28; ContextReceipt/v1=7; WireReceipt/v1=7; correlation pairs of context/v1+wire/v1=7.
- The in-driver count threw `columns is not defined` after the model run finished. The journey.json receipt fields were filled by a later read-only query of the same database. The driver is fixed for the next run; this run was not repeated.
- Proxy: HTTP(S)_PROXY=http://127.0.0.1:7897.

## Limits

1. Receipts are off by default. This run turned the two flags on explicitly.
2. This workspace was fullAccess. There is no in-app approval UI for a non-fullAccess workspace; that boundary is J-04.
3. The operator is agent-driven, Windows x64, one provider, one workspace.

## 五条演示尾项裁定（TF-0234，2026-09-22）

复核源码 HEAD：`b6c73619189f729c9e87b27210bb6abc21c1cda7`，与本次 J-03 候选相同。本节是事后对磁盘产物、生产代码和既有截图的复核，没有重跑 provider。裁定列只使用「仍在 / 已消失 / 不修」；「不修」表示本次收尾保留限制，不表示问题消失。

| 观察 | 当前 HEAD 状态 | 裁定 | 依据与收尾处理 |
| --- | --- | --- | --- |
| ① `sessions.history` 与隔离 Runtime 的转写目录不一致 | 仍有路径差异：Main 读 `OPENCLAW_CONFIG_DIR` 或 `~/.openclaw`；Runtime 用 `<userData>/openclaw-source-state`。J-03 没有调用 `sessions.history`，不能声称本轮重新触发 `Transcript not found`。 | 不修 | `electron/utils/paths.ts:71`、`electron/services/sessions-api.ts:1117` / `1686`、`electron/gateway/config-sync.ts:777` / `865`。本次驱动在 `driver.mjs:136` 用 Gateway `chat.history`；`src/stores/chat.ts:1896` 也保留该主路径。演示用已留档的 `session-history.json`，不承诺本地转写回放或其 fallback 可用。 |
| ② 非 fullAccess 执行挂起，无应用内 Runtime 审批入口 | J-04 的 readOnly host `exec.approval.list` 被拦；驱动改为直连 Gateway 后批准一次，随后执行 `node --test`，又出现下一条 pending。编码任务没有完成。 | 仍在 | `electron/services/workspace-permissions.ts:367` / `385`、`electron/services/gateway-api.ts:413`；相邻 J-04 的 `approval-boundary.json` 与 `session.jsonl`：resolve `10:25:22.830Z`，exec 结果 `10:25:24.410Z`。必须写「agent 通过直连 Gateway RPC 决定」，不能写成应用内 UI 或 host RPC 放行；J-04 缺 `journey.json`，本节不替它验收。 |
| ③ 首次配置后 reload 可能被 8 秒保护跳过 | `<8000ms` 的 early return 与 Windows 全重启分支仍在；J-03 已显式重启，事件记录 `pidChanged=true`。本轮 app.log 没有 `skipped_recent_connect`，不声称再次触发。 | 不修 | `electron/gateway/manager.ts:861` / `869`；`driver.mjs:117`，`journey.json.events[event=gateway.restarted]`。保留驱动的显式重启步骤，不承诺首次配置热生效。 |
| ④ 创建/启动工作区会写入引导文件并可能 `git init` | **仍在，纠正原预裁定「git init 已无」**。Main create 只种 Harness；Runtime bootstrap 仍可初始化 Git。J-03 before 仅 3 个业务文件，after 含 `.git/HEAD`、`.git/config`、7 个根目录引导文档、16 个 Harness 文件及 `.openclaw/**`。 | 仍在 | `electron/services/workspaces-api.ts:560`、`electron/utils/clawx-harness-template.ts:75`；`openclaw_runtime/src/agents/workspace.ts:786` / `797` / `861` / `1000`。`app.log:66` 记载 Harness 写入 16 文件；`journey.json.workspace.after.files` 直接列出 `.git/**`。session 的两个 exec 调用都只是 `node --test`。只能认定完整旅程有副作用，不能归咎于 Main create 中不存在的 git 命令；继续用独立练习目录，不修该机制。 |
| ⑤ host 切换后界面仍显示默认工作区 / Read only | `03-workspace.png` 与 `06-final.png` 均可见；同一旅程的 host 事件是 `journey-calc/fullAccess`。驱动直接 `hostInvoke`，绕过 renderer store 更新。 | 不修 | `driver.mjs:81` / `113`；`src/stores/workspaces.ts:182` 正常切换会写回 activeWorkspace，`src/pages/Chat/index.tsx:873` / `3544` 已订阅并传入，`src/pages/Chat/ChatInput.tsx:1133` 已读取 `workspace.permissionMode`。没有「标签未绑定」证据；只改标签不能修复外部 host 变更后的整份陈旧状态，超出本节点单处绑定范围。保留截图与限制；本轮未验证正常 UI 点击切换的 Electron 行为。 |

阶段 2 对外说明的限制栏已同步到 `docs/dev/showcase-overview-20260922.md`（材料草稿，不代表阶段 2 完成）。本轮产品源码改动为 **0**；①③④不进入功能修复，②不建审批 UI，⑤不扩大修改。

验证：`pnpm exec vitest run tests/unit/workspaces-store.test.ts tests/unit/workspaces-api.test.ts tests/unit/workspace-permissions.test.ts --reporter=json --outputFile=artifacts/live-model-cdp/20260922-senseaudio-journey-J03/tail-review-tests.json`，exit **0**；直接读取 JSON 得到 **3 files / 43 passed / 0 failed / 0 skipped**。首次运行仅有本机 pnpmrc 读取 EPERM 警告。测试覆盖 Main/store/权限既有逻辑，不等同于新的 Electron 或 live-provider 验收。原 J-03/J-04 哈希清单分别 **13/13、7/7** 一致；`calc.js.after` 与 journey 哈希一致。复核记录见 `tail-review.json`。

## 审批结果（2026-09-22）

用户授权按证据判断并直接 apply 后，TF-0232 与 TF-0234 验收条件逐项通过；提案 `TFP-tf0234-tail-verdict-20260922` 已应用，两节点为 done/100。原 SQLite 只读重查为 28 行、7 对 v1，digest 集合与 `receipt-join.json` 完全相同；在临时目录使用原始测试离线重放，修复前 exit 1（1 pass / 2 fail），修复后 exit 0（3/3）。没有新的 provider 请求。逐项审批记录与原始测试输出见 `tail-review.json.approvalReview`。

J-04 与阶段 1 仍为 in_progress。Task Forest validate 通过；check-landing exit 1，提示本次两个 done 节点晚于最后提交，证据及状态尚未 Git 入库；不宣称整个阶段或仓库封存完成。

## Re-run

```powershell
$env:SENSEAUDIO_API_KEY = '<see environment variable SENSEAUDIO_API_KEY>'
$env:HTTP_PROXY = 'http://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
node artifacts/live-model-cdp/20260922-senseaudio-journey-J03/driver.mjs --repo D:/ClawX --timeout-min 20
```

The driver itself also sets the two receipt flags on the app process. Do not commit a key.
