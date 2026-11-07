# 工作区与编码执行

> 面向问题：项目目录怎样成为 Workspace？文件、终端、Git、预览、浏览器和代码评审由谁实现？不同权限模式下什么能自动执行、什么必须审批？编码写保护和验证目前做到哪一步？

## 1. Workspace 是什么

`WorkspaceProfile` 是一个本地执行根和组合配置，包含：

- id、name、rootPath；
- permissionMode；
- activeSessionKey；
- sessionStates；
- agent bindings；
- session folders / assignments；
- coordinator bindings；
- UI 状态与 panel hints。

当前职责：

- 把一个项目根绑定到聊天和 Agent；
- 作为文件、终端、Git、预览、Review、Browser 的安全边界；
- 保存 session 的 workspace/folder 关系；
- 提供长会话 coordinator 的 canonical root / worktree 元数据。

Workspace 不是 Git worktree 的同义词；一个 workspace 可以是普通目录。Git worktree 是更窄的可选隔离实现。

## 2. 用户入口与面板

Workspace 主要在 Chat 旁边的 workspace panel 中，而 `/browser` 与 `/code-review` 是兼容入口，会导航回 Chat 并打开对应 panel。

`WorkspacePanelIntent` 支持：

- `files`
- `terminal`
- `browser`
- `review`
- `artifact`
- `audit`
- `agents`
- `subagent`
- `process`

面板实现：

- `src/components/file-preview/WorkspaceBrowserPanel.tsx`
- `WorkspaceReviewPanel.tsx`
- `WorkspaceGitPanel.tsx`
- `WorkspaceTerminalPanel.tsx`
- `WorkspaceWebPreviewPanel.tsx`
- `WorkspaceLiveBrowserPanel.tsx`
- `WorkspaceSubagentPanel.tsx`
- `WorkspaceProcessPanel.tsx`
- `ArtifactPanel.tsx`
- `WorkspaceAuditPanel.tsx`

终端可以放在底部或侧边；subagent/process 各自打开独立页签，允许并行查看。

## 3. Workspace preflight

选择目录前执行六项检查：

| 检查 | 行为 |
|---|---|
| exists | 必须存在且在 symlink/realpath 后是目录 |
| readable | 可读时必须能列目录 |
| writable | 不可写不阻断 Workspace，但强制 read-only fallback |
| git | 只作为信息/影响 undo hint，不是接受前提 |
| sensitivePath | drive root、home root、Windows/Unix system dir、credential dir 等阻断或警告 |
| diskSpace | 低于 1 GiB 警告 |

安全路径规则：

- 先解析 realpath，再做边界判断；
- 拒绝 device namespace、UNC/SMB、Windows ADS、保留设备名、NUL、过长路径；
- 写入必须校验 resolved path 位于 workspace root；
- 外部写入和 `.git` metadata 写入保持审批边界。

实现：

- `electron/services/workspace-preflight.ts`
- `electron/services/path-broker.ts`
- `electron/services/workspace-permissions.ts`

## 4. 权限模式

MCP 管理请求绑定到当前 Workspace 的 Assistant 会话。Main 从持久化绑定取得会话键和根目录，读取 Gateway 的当前 session generation，再把这三项交给会话 MCP runtime 核对。外部工作区会话、旧 generation 或已变更的根目录会在工具执行前被拒绝。

MCP 管理方法与 `tools.invoke` 共用当前会话的准入检查，核对有效工具策略、输入 schema 和工具审批钩子。Main 将当前工作区根作为工具调用的断言，目录预热不改变调用权限。只读模式保留目录及 SDK 心跳查询，写调用受既有权限审批约束。配置更新会刷新会话目录，携带旧目录 revision 的调用须先重新读取目录。

MCP 目录为空时显示已连接和 0 个工具；目录加载失败时显示错误及具体原因，工具数量显示为未知。心跳通过 SDK initialize 和 ping 返回连接结果。

### `readOnly`

- 允许白名单读命令；
- 拒绝文件写；
- 模型内置的 `write` / `edit` / `apply_patch` / `undo_write` 和 shell 工具同样被拒绝，未启用强沙箱时仍生效；模型可继续使用文件读取工具。
- 拒绝网络/破坏性/外部写命令；
- 仍允许读取 pending runtime approval 并回答 approval decision，否则 runtime 会永久等待。

### `plan`

- 只提供规划姿态；
- 拒绝直接命令/文件写；
- 同一拒绝策略覆盖模型内置工具；切回 `acceptEdits` 后保留用户显式配置的 tool deny。
- 请求权限不扩展写能力；
- 不承诺“严格零 diff”：系统 metadata 写入是明确例外。

### `acceptEdits`

- Workspace 内普通编辑可接受；
- 网络、破坏性、外部写等 high-risk 动作需要审批；
- `.git` metadata 与外部路径保持更严格边界。

### `fullAccess`

- 允许 Workspace 内普通写和更多命令；
- 不取消运行时自身 policy、审批与安全边界；
- 仍是受控预览设置，不是内核沙箱。

命令 risk 分为：

- `read`
- `write`
- `network`
- `destructive`
- `external-write`

`git worktree add` 会根据目标路径判断 write/external-write；worktree remove/prune 为 destructive。命令分类不能把所有 shell 绕过都证明为安全，因此审批系统、路径 broker 和运行时检查必须同时存在。

## 5. 文件与预览

Host `files.*` 支持：

- stage paths/buffer；
- read text/binary；
- write text；
- stat；
- listDir/listTree；
- register HTML preview。

文件预览包括：

- Monaco 文本/代码；
- Monaco diff；
- Markdown；
- HTML；
- 图片；
- PDF；
- Office；
- Sheet；
- generated artifacts；
- skill files。

预览是本地读取/=可视化，不代表对应文件已被模型执行或验证。Office 渲染能力与可编辑导出能力也应分开描述。

## 6. 终端

实现：`electron/services/terminal-session-manager.ts`、`terminal-api.ts`。

使用 `@lydell/node-pty` 创建真实 PTY，记录：

- workspaceId；
- sessionKey / expected session generation；
- cwd；
- pid；
- cols/rows；
- status；
- exitCode；
- scrollback seq；
- kind（interactive 或 webPreviewDevServer）；
- keepOnLeave；
- close reason；
- last output / interaction time。

支持：

- open/run/write/resize/interrupt/close；
- status/list；
- 同一 session 的受管终端；
- keepOnLeave，允许离开页面后继续运行；
- session stop/delete/reset、workspace switch/delete、permission change 时按 owner 清理。

Idle 分类：

- 最近 60 秒有 child output → `running-process`；
- 最近 30 分钟有用户输入 → `interactive`；
- 否则 `idle` 候选；
- 已退出 → `completed`。

Idle 不是自动杀死信号。ResourceTracker 另有 30 分钟无 session activity 的自动清理策略。

## 7. Web Preview

`WebPreviewManager` 支持三种模式：

- `static`；
- `devServer`；
- `externalUrl`。

Dev server 检测：

- pnpm/yarn/bun/npm lockfile；
- `dev/start/serve` 等脚本优先级；
- Vite 5173、Astro 4321、Next/Nuxt/CRA 3000 的默认端口提示；
- 从输出发现 localhost URL；
- 运行在受管 terminal session；
- workspace switch/delete 或替换 preview 时停止。

Security：

- 只接受 http/https；
- external URL 规范化；
- 不把 `0.0.0.0` 直接当可点击目标；
- preview 不授予 arbitrary shell/network 权限。

## 8. Git 与 Code Review

Host `git.*` 暴露较完整仓库操作：

- capabilities；
- status/diff/fileDiff/diffToBase；
- applyPatch；
- stage/unstage/revert/commit；
- branches/log/reflog/mergeBase；
- checkout/create branch；
- stash；
- worktrees add/remove/prune；
- fetch/pull/push/merge/rebase/reset；
- GitHub auth/repo/PR list/view/create/open。

能力存在不等于所有操作免审批。危险语义仍通过权限模式、approval、路径边界和运行时 policy 控制。

Code Review 的两个边界：

1. `Code Review route` 是 workspace review panel 的兼容入口；
2. AI review / PR view 是只读/评审表面，不等于自动写入或自动 merge authority。

Remote forge 有独立 Host API：

- capabilities；
- readPullRequest/readContents；
- mutatePullRequest；
- mergePullRequest。

远程写和 merge 必须依赖认证、审批与 forge 能力事实；页面可读不能推导为 token 有效或 PR 已合并。

## 9. Project Rules

`projectRules` Host API：

- `snapshot`
- `createAgentsTemplate`
- `explain`

用于读取项目 `AGENTS.md`、创建模板并解释规则如何影响当前路径。它不替代全局 instruction precedence，也不在运行时自动扩大工具权限。

## 10. 编码执行与写保护

相关实现：

- `openclaw_runtime/src/agents/agent-tools.ts`
- `openclaw_runtime/src/agents/tools/write-journal.ts`
- `openclaw_runtime/src/agents/tools/write-journal-core.ts`（同一 journal 的存储/恢复核心；原入口保留导出与路径校验）
- `openclaw_runtime/src/agents/apply-patch.ts`
- `openclaw_runtime/src/agents/coding-control-dispositions.ts`
- `shared/types/coding-run.ts`

当前控制面需要区分两层：普通 Agent 的受控工具/文件执行属于 baseline；首个 **DCS Coding Controlled Preview** 整体仍要求显式 opt-in，不能因为通用编码工具默认存在就宣称该闭环已自动开启。

| 控件 | 当前 disposition | 说明 |
|---|---|---|
| Coding write/recovery | default | write journal 默认启用，支持 undo/recovery 关联 |
| Stale-write guard | advanced | opt-in，防止基于过期文件内容覆盖 |
| Worktree isolation | advanced | opt-in；共享 in-process 默认仍是保守基线 |
| Patch flow | retired | 旧 patch preview 不是当前产品能力 |
| Symbol lease | retired | 不作为当前写锁或客户端能力 |
| Auto verify | default `auto` | 检测 runner 时执行；否则 skip；timeout 最大 90 秒 |

### Write journal

限域 write/edit 在读取 journal 原文件快照前验证工作区边界；可信来源也不能绕过
`workspaceOnly`。等待路径锁后通过现有 fs-safe 根读取快照，拒绝的外部文件内容不会
先进入可读的工作区 journal。

撤销和检查点恢复同样通过 fs-safe 重新验证目标与快照，等待实际 I/O 完成后才报告
成功。目标被换成越界目录联接或硬链接时拒绝恢复并保留 journal；异步恢复期间的新
写入不会被当作旧 journal 项消费。

- 是 supported coding writes 的恢复权威；
- 记录写操作与可撤销来源；
- journal failure 不应被宣称成“成功写入且可恢复”；
- apply-patch 的 effect receipt 可以引用 journal entry；
- 关闭 journal 时，依赖 journal 的 receipt/recovery 也应明确缺失。

### Stale-write guard

- 比较写入依据与磁盘当前内容；
- 检测到 stale 时拒绝或要求重试；
- 属于 advanced/opt-in，不能当作所有写路径的默认保证。

### Auto verify

- 默认 `auto`；
- 检测到项目测试 runner 才运行；
- 复用现有 exec 工具，不创建第二套 approval/sandbox/timeout；
- 无 runner 时 skip，不是“验证通过”；
- 验证失败要显式报告，不能静默修复。

### Worktree isolation

- 多 writer 的推荐隔离方式，但仍是 advanced；
- 需要真实 Git worktree 和已验证 checkout；
- “声明 worktree”不等于“已隔离”；
- in-process shared 写只允许有 write-set proof 或串行化。

编排请求的顶层 `isolation` 会被各 worker 继承，worker 显式 `shared`/`worktree` 可覆盖；未提供仍为 shared，未知值直接拒绝。Gateway 与 `team_orchestrate` 共用父会话解析器，从持久化目录及当前配置解析根目录与 session generation，客户端路径只作为待核对条件。工作树创建与每次 spawn 都受同一父会话身份约束；工具工作区与执行 cwd 一并指向实际 worker 根目录。原生 spawn 在异步准备完成后、下发子任务前再次校验；父会话被重置时回滚准备状态并清理临时子会话。

资源调度只接受 WorktreeService 登记且目录身份仍有效的独立 Git checkout；布尔声明、伪造记录与 inprocess 目录都不能提供这一证明。回执记录实际 backend、根目录和 verifiedCheckout，显式 Git 后端不可用时拒绝执行。目录模拟仍称 inprocess-worktree，不宣称 Git 隔离。

工作树回流以创建时的 parent/worker 文件摘要为基线，按实际内容变化识别新增、修改和删除；重命名保留旧路径删除与新路径新增。parent 已被并发修改、Git HEAD 已变化或目标目录身份不一致时返回 conflict，保留用户内容和 index。回流通过既有 Coding journal 和文件锁执行，返回前读回目标摘要；失败时恢复已写内容，若检测到不同的并发内容则保留恢复记录并报告 recoveryRequired。重复回流相同内容不重复写入或生成新 journal。完成回调通过工作树注册记录找到 parent 根，独立于 worker 执行 cwd。

`apply_patch` 区分文件效果与 journal 终态持久化：文件已写入但元数据写入失败时返回 `recovery_required` 错误，携带 `effectApplied=true`、`journalStatePersisted=false` 和 recoveryRef，不得直接重放。journal 内存状态只在持久化成功后推进；Effect Receipt 对该结果记录 unknown。文件回滚成功但 journal 终态仍不可持久化时，也保留对账引用，而不声称完整收口。

## 11. CodingRun、Task Loop 与 Task Ledger

`CodingRun` 是 association/projection view，不是第二任务状态机。

- Task Ledger 拥有用户可见任务事实；
- Task Loop 拥有 checkpoint/repair/blocked/evidence-gate；
- CodingRun 关联 code review、runs、files、evidence，但不夺走任务权威；
- 代码审查可读性成功不能自动把 Task Ledger node 改为 done。

CodingRun 的 `coding-run/v1` JSONL 由同一个合同解析：`run`/`loop` 的 `warning` 可省略，scope、runIds、completion 和事件字段逐层校验，事件的 codingRunId 必须与首行一致。错误版本、乱序和跨运行证据会使 `scripts/coding-run-summary.mjs` 非零退出。Task Loop 页面和导出共用完成状态映射；取消、错误、blocked 以及无 evidenceGate 的结果不会被提升为已完成任务，导出也不会更新 Task Ledger。

## 12. Workspace 与长会话资源

MCP 管理入口按当前工作区的持久化会话和代际读取目录、调用工具及执行 SDK ping。作用域或所有者变更后重新投影当前授权，保留助手的显式默认选择，并撤销旧作用域授权；管理调用与模型运行使用相同的沙箱工具策略。单个服务的超时或 HTTP 错误会保留为该服务的诊断，健康服务仍可调用。

Workspace coordinator 绑定会记录：

- workspace root / managed worktree；
- agent/session/generation；
- branch/detached；
- setup profile；
- binding revision；
- task refs。

Workspace 删除或 root 变化时：

- terminal manager 注销 workspace；
- web preview 停止；
- browser sessions 与 managed ports 回收；
- Workspace Context profile 可能随 root 变化重置；
- 旧 session generation 和旧 worktree 所有权不能被新 root 自动接管。

## 13. 安全与隐私边界

- 文件系统写入不等同于 sandbox；权限模式是合作式边界。
- 外部路径、UNC、device namespace、ADS、`.git` metadata 和破坏性命令保持 fail-closed/approval。
- Browser private network 默认 deny。
- 代码内容、终端输出、Git remote 信息可能包含敏感数据；不要提交原始日志或凭据。
- 预览、浏览器、远程 forge 会接触网络；本地 workspace 仍可能产生外发。
- 生成文件与 build artifact 不能仅凭存在就当成验证结果。

## 14. 当前限制

- Windows x64 是主验收平台；Linux/macOS 的文件、终端、浏览器与打包路径没有同等覆盖。
- Workspace panel 的多种预览不是“完整 IDE”；没有任意语言服务器/调试器的统一保证。
- Git API 存在完整操作集合，但并非所有危险操作都有默认自动执行许可。
- Code review 不是自动 merge authority。
- worktree isolation 是 advanced，不是普通路径默认。
- managed worktree 创建拒绝保留名、名称碰撞和已有目录，不在创建过程中删除旧目录。
  创建、锁和清理路径重新检查目录联接；锁等待超时会失败，不能无锁继续执行。
- stale-write guard 是 advanced，不能写成默认保护。
- patch flow 与 symbol lease 已退役。
- auto verify 可能 skip；skip 不是 pass。
- browser、remote forge、terminal 和 external tools 的真实效果需要各自运行证据。

## 15. 源码索引

- `src/App.tsx`
- `src/components/file-preview/`
- `src/pages/Chat/ComposerGitStrip.tsx`
- `src/stores/workspaces.ts`
- `electron/services/workspaces-api.ts`
- `electron/services/workspace-preflight.ts`
- `electron/services/workspace-permissions.ts`
- `electron/services/path-broker.ts`
- `electron/services/files-api.ts`
- `electron/services/terminal-api.ts`
- `electron/services/terminal-session-manager.ts`
- `electron/services/web-preview-manager.ts`
- `electron/services/git-api.ts`
- `electron/services/code-review-api.ts`
- `electron/services/remote-forge-api.ts`
- `electron/services/project-rules-api.ts`
- `openclaw_runtime/src/agents/agent-tools.ts`
- `openclaw_runtime/src/agents/tools/write-journal.ts`
- `openclaw_runtime/src/agents/coding-control-dispositions.ts`
- `shared/types/workspace.ts`
- `shared/types/coding-run.ts`

### Change Context 评论入口

Review Center 的本地审查视图提供折叠的「变更上下文（高级）」入口。
只有显式展开并加载后才读取 Change Context；关闭会清除当前投影和评论视图。
支持合并基线、上次提交、上次回合和检查点比较；源缺失、截断和过期保持可见。
评论展示原始路径、行范围及 live/stale/removed/unavailable 状态；刷新不会移动锚点。
重新锚定必须显式填写目标路径/行范围并提交，使用 updatedAt 乐观并发控制。
评论的解决和删除只修改审查证据；删除保留 tombstone，不改变代码或任务状态。
approve/comment-only 不写 Task Ledger；request changes 只创建或引用一个待办 review 节点。
审查结论仅保留在当前加载视图；任务关联由 Task Ledger 自己持久化。
Pull Changes 对完整 text patch 绑定实际字节摘要、目标完整 HEAD 和现有审批，
通过 Git preflight 与 Coding 的既有 journal/lease 执行；过期或冲突不修改目标。
若 apply 或 journal 的结果未知，会显示 recovery_required，不声称零写入，也不自动重试。
VG 卡片只读取现有 host binding/observation 和 receipt owner 已接收的结果；
既有 `CLAWX_VERSGIT_BINDING_ENABLED` 未开启时，不调用 VG 事实读取器。
卡片不运行 VG 或 verifier。缺失、过期、未与当前 immutable candidate 绑定的回执
保持 partial/unmeasured；stale-read 仅作提示，host verdict 始终 unchanged。

入口关闭和重新加载的回滚行为、评论保留及本次验收范围见
[受控启用与回滚](../dev/change-context-review-loop/rollout.md)。

延伸阅读：[Verse 系列组件](verse-tools.md)、[资源与可观测性](resources-and-observability.md)、[默认配置矩阵](../dev/default-config-matrix.md)。
