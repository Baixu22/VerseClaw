# 集成、页面与辅助模块

> 面向问题：除 Chat、Knowledge、Memory、Task Ledger 外，渠道、Scheduled、Skills/MCP、Inbox、Remote Tasks、Office、媒体、Billing、Agent Dev 和 Settings 分别提供什么？哪些入口只是兼容跳转或开发者表面？

## 1. 当前路由

`src/App.tsx` 是 renderer 路由注册权威。

| 路径 | 当前行为 |
|---|---|
| `/setup/*` | 首次启动向导 |
| `/` | Chat；`?knowledge=ask` 打开 Knowledge Chat |
| `/models` | 兼容重定向到 `/settings/models` |
| `/agents` | 兼容重定向到 `/settings/agents` |
| `/channels` | 兼容重定向到 `/settings/channels` |
| `/skills` | 兼容重定向到 `/settings/skills` |
| `/inbox` | Inbox |
| `/cron` | Scheduled |
| `/remote-tasks` | 重定向到 `/inbox?source=remote-task` |
| `/task-ledger` | Task Ledger |
| `/clawgraph` | ClawGraph |
| `/code-review` | 回到 Chat 并打开 workspace review |
| `/knowledge` | Knowledge |
| `/memory` | Memory |
| `/browser` | 回到 Chat 并打开 workspace browser |
| `/image-generation` | 仅开发者解锁时显示，属于高级/测试表面 |
| `/dreams` | 已退役，重定向到 Chat |
| `/observability` | Observability |
| `/ui-v2-showcase` | 仅 dev surface access 允许时显示，不是产品页面 |
| `/settings/*` | Settings |
| 未知路径 | 重定向到 Chat |

## 2. Settings 页面

Settings section id：

- overview
- general
- models
- agents
- channels
- skills
- browser
- system
- developer
- billing
- archived
- recovery

主要映射：

- Models / Agents / Skills / Channels / Billing / Browser 有独立 lazy-loaded section；
- General/System/Developer 由 Settings 主实现渲染；
- Archived 与 Recovery 有专用 section；
- Settings 搜索与 sidebar 使用同一 section metadata。

Settings 的角色：

- 管理账户、Agent、渠道、Skills/MCP、Browser；
- 管理 general UI、语言、主题、Workspace Context；
- 管理 runtime/system/Gateway/CLI/Doctor；
- 管理 archive/recycle bin 和 session activity 设置；
- 显示 Billing/usage；
- Developer 提供 Agent Dev、上下文、DCS、资源、MCP/hook 等诊断面。

## 3. Channels

类型定义：`shared/types/channel.ts`。

当前枚举 15 类：

- WhatsApp
- WeChat
- DingTalk
- Telegram
- Discord
- Signal
- Feishu/Lark
- WeCom
- iMessage
- Matrix
- LINE
- Microsoft Teams
- Google Chat
- Mattermost
- QQ Bot

重要区别：

- **枚举存在** ≠ 插件已安装；
- **插件已安装** ≠ 账户已认证；
- **账户已认证** ≠ 消息已送达；
- Gateway 运行 ≠ 所有 channel runtime ready。

Channel 模型包括：

- account/configuration；
- connection status：connected/disconnected/connecting/degraded/error；
- access policy：open/allowlist/pairing/disabled/unknown；
- DM/group/channel scope；
- native approval policy；
- targets；
- agent binding；
- credentials；
- login flow；
- runtime status/heratbeat。

Host API：

- accounts/targets/configured；
- setDefaultAccount；
- bindingSave/bindingDelete；
- validateConfig/formValues/saveConfig/setEnabled/deleteConfig；
- validateCredentials；
- startLogin/cancelLogin；
- saveBinding/deleteBinding。

外部渠道是输入/输出边界，不是任意 agent tool 权限。邮件/网页等内容来源应保留 trust/provenance。

## 4. Scheduled / Cron

用户入口：`/cron`。

Host API：

- list
- create
- update
- delete
- toggle
- trigger
- sessionHistory
- deliveryTargets

能力：

- schedule：
  - cron expression；
  - interval；
  - one-shot；
- isolated agent 或指定 session target；
- channel delivery；
- webhook delivery；
- failure destination；
- completion destination；
- run history/diagnostics；
- browser task details；
- cancel/retry 语义由 runtime owner 提供。

Delivery modes：

- `none`
- `announce`
- `webhook`

注意：

- Webhook URL 必须是 http/https；
- 当前 completion destination 主要是 webhook-only 并且有模式组合约束；
- cron host API 不提供逐步审批 UI，涉及需要审批的动作时应 fail closed 或留在既有 approval path；
- 保存 schedule 不等于执行成功。

奇偶/并发、retention、session reaper、stagger 等细节见 `openclaw_runtime/src/cron/`。

任务详情从 `cron.runs` 按时间倒序分批读取最近 500 条运行记录，每页最多 200 条，整个读取共用 8 秒预算。显示时按时间正序排列并应用消息数量限制；后续页失败时保留已收到的记录。

## 5. Inbox

用户入口：`/inbox`，advanced。

Inbox 汇总需要操作的事项：

- runtime approval requests；
- browser task waiting approval；
- remote tasks pending/approval；
- 其他需要 operator attention 的 runtime 事件。

它不等于 Chat 消息列表，也不等于 Task Ledger。Inbox item 处理完成后应回写对应 owner，而不是只在 UI 隐藏。

Approval 相关：

- `permissions.approvals`
- `permissions.decideApproval`
- `runtimeApprovals.list/resolve`
- `sessionActivity.snapshot`

关键事实：

- 等待审批的 run 不是 failed；
-审批恢复后仍需检查 tool effect；
- approval decision 是动作边界，不是对最终任务验收。

## 6. Remote Tasks

Host API：

- list
- create
- preview
- approve
- reject
- execute

Remote Tasks 是远程任务记录和操作面；`/remote-tasks` 兼容入口会回到 Inbox 的 remote-task source 视图。

边界：

- 创建/预览 ≠ 已执行；
- approve ≠ 完成；
- remote task result 需要真实 source/owner evidence；
- 与本地 Task Ledger 的关系通过 typed references/projection，而不是复制状态机。

## 7. Skills 与 MCP

### Skills

Host API：

- local/allConfigs/configs；
- getConfig/updateConfig/updateConfigs；
- status/update；
- quickAccess；
- ClawHub capability/list/search/install/uninstall/readme/path；
- skillPacks list/install/sync/setEnabled/readSkill。

Skill source 可来自：

- workspace；
- OpenClaw；
- agents；
- legacy；
- marketplace；
- preinstalled packs。

边界：

- skill discovered ≠ exposed；
- Skill 启停配置写入 runtime 所有的 `openclaw.json`，受管目录在 Gateway 启动前注册；
- config saved ≠ runtime reloaded；
- marketplace install ≠ executable trust；
- skill contents 可以影响 prompt，但不是权限 grant。

### MCP

Type：`shared/types/mcp.ts`。

Transport：

- stdio
- http
- streamable-http
- sse
- websocket

Scope：

- global
- agent
- workspace

Network policy：

- disabled
- localOnly
- enabled

Host API：

- listServers/create/update/delete/test；
- resolveForContext；
- listTools/callTool；
- reloadRuntime；
- heartbeat。

MCP server 可配置：

- exposure agents/workspaces/roles；
- tool allowlist/denylist；
- permissionMode；
- sandboxProfile；
- network policy；
- masked env/headers；
- heartbeat/status/tool count。

边界：

- server configured 不等于 connected；
- tool listed 不等于 allowed；
- tool call `success:false` 与 Host transport failure 分开；
- `approvalRequired`/`blocked` 必须保留；
- MCP 配置更新通过当前会话 runtime 热重载，旧目录 revision 的调用会被拒绝；
- 工具完成后返回本次调用的实际结果，调用期间产生的合法配置变更用于后续调用的准入；
- MCP 不是绕过 Host API 的第二 action transport。

Loopback HTTP 与 stdio 的工具结果使用同一 SDK 内容校验。`isError`、工具内部错误、审批等待、取消和超时保留失败语义；取消信号进入实际 SDK 调用，重复取消不计作服务故障。模型工具结果保留图片和结构化数据，音频或资源转为文本时记录转换信息。

HTTP 保持现有 `2025-03-26` / `2024-11-05` 协商版本；旧版本不支持的音频、资源链接和结构化字段转换为合法文本，并在 `_meta` 中记录损失。stdio 使用 SDK 协商结果执行相同降级。后续请求的未知协议版本返回 400。

HTTP 初始化返回 `Mcp-Session-Id`，将取消请求绑定到该客户端、agent 会话和 owner 身份；不同客户端使用相同 JSON-RPC id 不会互相取消。会话内调用 id 不可复用；会话处理 4096 次调用后需重新初始化，空闲十分钟后可回收，最多保留 256 个会话。客户端可用 DELETE 结束会话。未携带会话标识的旧请求只使用自身连接断开的取消信号。

HTTP 会话失效返回 404 时，Runtime 回收发起请求的连接，下一次显式调用重新握手。失败调用不自动重放，旧连接的迟到错误不会回收替换后的连接。

## 8. Code Review 与 Remote Forge

Code Review：

- `src/pages/CodeReview/`
- `electron/services/code-review-api.ts`
- 可读取 Git/workspace 状态并生成评审材料；
- route 打开现有 workspace review panel；
- review 是只读/评审视图，不是自动 commit/merge 权威。

Remote Forge：

- `shared/types/remote-forge.ts`
- `electron/services/remote-forge-api.ts`
- Host API：capabilities/readPullRequest/readContents/mutatePullRequest/mergePullRequest。

重要分离：

- capability advertised 后才可能执行 mutation/merge；
- 认证有效性和远端 readiness 需单独观察；
- PR read ≠ mutation 成功；
- mutation/merge 是外部写，必须走既有 approval/security 边界；
- 页面显示 PR 不代表已合并。

## 9. Office / VerseConf 结构化文档

插件：`openclaw_runtime/extensions/verseconf-artifacts/`，默认关闭。

Host `officeTools.*` 覆盖：

- detect/install/uninstall；
- list/sync skills；
- link/unlink agent；
- install status；
- render HTML；
- watch start/stop。

VerseConf 工具：

- structured artifact create/revise；
- record ordering；
- revisions/history；
- export。

当前能力：

- research table → CSV/XLSX；
- slide outline → PPTX；
- content → Markdown；
- artifact panel 展示版本、历史和输出。

硬限制：

- PPTX 使用三页模板；
- 超过三条记录要拒绝/另走 Markdown；
- 长文本视觉排版与任意页数未验收；
- ZIP/XML/文件存在不是视觉保真证据；
- plugin disabled by default；
- 路径 symlink/junction 逃逸被拒绝。

## 10. Media / Image Generation

Host `media.*`：

- thumbnails；
- saveImage；
- imageGenerationSettings；
- saveImageGenerationSettings；
- imageGenerationProviders；
- testImageGeneration。

Image Generation 页面目前：

- advanced/developer/test-gated；
- `/image-generation` 只有 devModeUnlocked 时可达；
- 不是主产品导航承诺；
- provider 配置/测试通过不等于生成的每个媒体都符合业务质量。

Runtime 还包含 image/media/TTS/video 等子系统目录，但它们的存在不能自动推导为产品 UI 或默认能力。

## 11. Billing / Usage

用户入口：`Settings → Billing`。

Billing 主要读取本地 usage history：

- input/output/cache；
- tokens；
- estimated cost；
- provider/model/agent/session；
- 7d/30d/all；
- 按时间或 model 分组。

它不是远程账单或计费中心。Unknown cost 保持 unknown。

Models 页也会显示同一 usage 数据的模型视角。

## 12. Agent Dev Workbench

Settings → Developer 含 Agent Dev Workbench。

CLI：

```bash
pnpm agent-dev:workbench
pnpm agent-dev:deep-test
pnpm agent-dev:deep-test:reuse
pnpm agent-dev:audit
```

证据文件：

- `artifacts/agent-dev-workbench/evidence.json`
- `artifacts/agent-dev-deep-test/report.json`
- `artifacts/agent-dev-audit/report.json`

边界：

- Agent Dev green 不是联合系统 GA；
- `decision.status=needs-full-gate` 仍是 daily-loop evidence；
- requiredFullGates 必须继续运行；
- sandbox/effect log/cost report 不能证明所有 runtime effects；
- source freshness 与 evidence freshness 检查是 gate 的一部分。

## 13. Observability 与 Local Control Plane

`/observability` 是 advanced 用户面：

- trace 列表/瀑布/图；
- trace node diagnostics；
- issue/scorecard；
- trajectory session/history；
- Problems。

Local Control Plane 是 internal：

- `localControlPlane.status`
- reports
- correlations

只读为主，不能据此下控制动作结论。

## 14. Renderer Extensions 与 Plugins

两套扩展需要区分：

- `electron/extensions/`：Main/renderer 扩展 registry/loader；
- `openclaw_runtime/extensions/`：runtime providers/channels/tools/plugins。

已知约束：

- extension source 存在不等于被 manifest 加载；
- plugin enabled 不等于 Gateway 已成功装载；
- generated bridge 可能为空，必须检查实际生成结果；
- `clawx-extensions.json` / `verse-claw-extensions.json` 的历史 manifest mismatch 需要以实际代码和生成桥为准，不能仅凭文件名宣称外部扩展已接线。

## 15. i18n 与 UI 约定

用户可见文本：

- 使用 `react-i18next`；
- locale：en / zh / ja / ru；
- 不硬编码显示文案；
- 四语言 key 必须覆盖；
- `pnpm i18n:lint` 检查。

设计 token：

- `src/styles/globals.css` 是替换与 surface 规则；
- `bg-surface-modal` / `bg-surface-input`；
- selected 状态使用 `bg-black/5 dark:bg-white/10`；
- 状态色按 `text-X-700 dark:text-X-400`；
- 页面标题使用 serif/tracking 规范。

UI 改变应有 Electron E2E；一个页面能打开不等于交互闭环已验证。

## 16. 生命周期/兼容表面

- `/models`、`/agents`、`/channels`、`/skills` 是 settings 兼容入口。
- `/browser`、`/code-review` 是 workspace panel 兼容入口。
- `/remote-tasks` 是 Inbox source 兼容入口。
- `/dreams` 已退役。
- `/ui-v2-showcase` 只用于受控开发查看。
- Image Generation 不作为默认导航承诺。
- Docs 中的“页面存在”不能推导成“该模块 GA”。

## 17. 当前集成限制

- Channels 15 类并非全部在当前机器/包中启用或认证。
- Scheduled/Remote/Browser task 的执行和 delivery 需要各自证据。
- MCP server/tool 权限不统一于 skill 权限。
- VerseConf 插件默认关闭且 PPTX 模板受限。
- Image Generation 仍是开发者/测试边界。
- Billing 是本地估算，不是云端账单。
- Agent Dev、Local Control Plane、Observability 不能互相替代验收。
- Remote Forge 的 mutation/merge 是高风险的 external write。

## 18. 源码索引

- `src/App.tsx`
- `src/pages/Settings/route-config.ts`
- `src/pages/Settings/SettingsRoute.tsx`
- `src/pages/Inbox/`
- `src/pages/Cron/`
- `src/pages/RemoteTasks/`
- `src/pages/CodeReview/`
- `src/pages/ImageGeneration/`
- `src/pages/Billing/`
- `src/pages/Skills/`
- `src/pages/Channels/`
- `src/components/settings/`
- `src/components/knowledge-bot/`
- `electron/services/channels-api.ts`
- `electron/services/cron-api.ts`
- `electron/services/remote-tasks-api.ts`
- `electron/services/mcp-api.ts`
- `electron/services/skills-api.ts`
- `electron/services/skill-packs-api.ts`
- `electron/services/office-tools-api.ts`
- `electron/services/media-api.ts`
- `electron/services/remote-forge-api.ts`
- `shared/types/channel.ts`
- `shared/types/cron.ts`
- `shared/types/mcp.ts`
- `shared/types/skill.ts`
- `docs/dev/verseconf-clawx-implementation-20261001.md`
- `docs/agent-dev-control-plane.md`

延伸阅读：[工作区与编码执行](workspace-and-coding.md)、[资源与可观测性](resources-and-observability.md)、[开发与验证](development-and-validation.md)。
