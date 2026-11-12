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

工作空间的宽度控制与关闭分开：关闭只隐藏面板，保留已挂载页签、选中内容和展开状态，再次打开继续原来的阅读。子代理从会话环境进入独立页签，不占据工作空间启动菜单。

会话环境默认不因干净仓库、策略快照或普通答复而显示；实际变更、已观察到的来源调用、子代理或进程活动才触发入口。宽窗口按现有设置并排自动展开，手动打开则使用浮层卡片；收起后不会被后续事件反复打开。来源只投影结构化调用中的 MCP 身份及读取过的 Skill 名称，不解析自然语言或 shell 命令来推断使用情况，也不显示原始参数和环境变量值。各组先显示三项，再按需查看其余内容；运行中的子代理优先于完成记录。

会话状态面板使用单一平面分组，运行中与失败进程直接可见，已完成进程收进可展开历史。进程页复用对话的终端组件，状态、复制、日志字体和边框保持一致；回看早期日志时，新输出不会将阅读位置拉回底部。工具调用与对应结果共用一个展开入口，孤立结果仍保留，诊断数据放在处理详情末尾。

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

MCP 管理请求绑定到当前 Workspace 的 Assistant 会话。Main 从持久化绑定取得会话键和执行根目录；coordinator 绑定受管工作树时使用该工作树的 canonicalRoot。Main 读取 Gateway 的当前 session generation，再把这三项交给会话 MCP runtime 核对。外部工作区会话、暂停的 coordinator、旧 generation 或已变更的根目录会在工具执行前被拒绝。

MCP 管理方法与 `tools.invoke` 共用当前会话的准入检查，核对有效工具策略、输入 schema 和工具审批钩子。Main 将当前工作区根作为工具调用的断言，目录预热不改变调用权限。只读模式保留目录及 SDK 心跳查询，写调用受既有权限审批约束。配置更新会刷新会话目录，携带旧目录 revision 的调用须先重新读取目录。

MCP 目录为空时显示已连接和 0 个工具；目录加载失败时显示错误及具体原因，工具数量显示为未知。下次管理查询会重试失败服务，心跳通过 SDK initialize 和 ping 返回连接结果。工具执行成功后发送的目录变更通知只影响后续目录读取，已完成的结果仍正常返回。管理 RPC 使用 60 秒预算，Gateway 再按 Host 请求剩余期限收紧。

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

Patch Flow 的旧 `patchFlowExecution` 请求、配置默认值与 override 均不启用执行；
worker 保留普通工具和提示词。恢复中的旧标记也不会发起新的串行候选应用，
已经记录的历史 applied 状态与效果保留。Developer 将 Patch Flow 与 Symbol Lease
显示为退役条目；并发编码可显式选择工作树隔离，由现有 journal 与候选回流 owner 处理。

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

空会话输入框下方使用轻量“项目 / 分支”行。分支菜单支持搜索、切换和读取失败重试，沿用 Git 权限及工作区保护；项目切换先保存当前会话。三个快捷操作收进“快捷开始”，开始输入时收起且不移动输入框。已有对话仍保留完整 Git 操作条。

受管工作树回收沿既有执行域屏障和 checkout writer 执行，保留 Git 忽略文件。进程内工作树按创建时记录的实际文件摘要与权限基线核对；变化尚未在目标目录保留时拒绝删除。删除前重核路径实例、内容、权限和引用；预检明确拒绝时结算 `not-applied` 并恢复原生命周期。

回收会检查进程内工作树的全部现存内容及权限是否已有精确目标副本。Git 索引存在 `assume-unchanged` 或 `skip-worktree` 标记时明确拒绝回收并保留原标记。

受管工作树成果回流由 `WorktreeService.processMergeQueue()` 异步执行，调用方等待原 checkout writer 和 Coding journal 的终态。冻结准备、文件整合和完成回执发布在原目标队列中按序执行，重复或交叠回调读取已发布的终态。创建时的文件摘要与权限基线保存在原持久 registry。删除、重命名和二进制变更使用原 Coding journal；目标漂移或不支持的权限变化返回明确冲突，效果无法确认时保留日志引用和恢复状态。重复完成复用同一代次的成功回执。

批次后续失败时，已完成 worker 保留原终态、原因和回执；没有终态的 worker 保持可重试。准备阶段后续校验失败时，原 owner 继续处理已准入的前缀，回读它的持久结果；未知应用效果仍由原 writer 和 journal 核对。

Git 工作树的生产完成链沿既有 `freezeOrchestrationWorktreeCandidate()` 固定 commit、tree、输入摘要与验证目录。整合前使用候选快照记录的原始后像摘要核对实际 worker 字节；worker 元数据保存候选 manifest 与目录。Verifier 派发前重核候选身份和干净状态，并以该目录为执行目录。进程内工作树沿原 registry 的代次与内容基线整合，在记录的目标目录验证结果；后端由 registry 记录确定。Git 目标已有 shared 或外部写入时保留双方内容并返回 worker 冲突，待目标重新具备可冻结基线后整合。

合并 permit 在 journal 快照和引用准备时仍记录为目标文件效果未开始，首次目标移动、删除或写入前才标记效果准入。当前进程中的未准入异常按 `not-applied` 释放；旧进程退出后可回读同一准备期状态再重试。开始目标文件效果后的未知结果继续保留恢复引用。旧 Git 基线从原 `baseOid` 的 blob 补齐后续请求路径；旧进程内工作树仅采用保留目标能证明的原始内容。

候选快照记录完整变更路径及冻结时的原始后像 SHA，包括未跟踪的新文件和重命名目标；Git 过滤后的 blob 不代替原始字节摘要。整合前核对路径集合和每个后像，核验目录同时核对 commit、tree、干净状态与冻结字节。候选 manifest 还保存原工作树 owner 的目录实例和原生 Git 绑定身份；候选选择、排队派发和立即派发拒绝目录替换及符号链接重定向。混合成败时仅从成功工作树选择候选，完整失败记录仍传给 verifier；全失败保持原有失败决策。

候选目录中的 Git 忽略路径必须属于冻结时声明的运行产物允许列表；未声明的配置、脚本和依赖目录拒绝复用。旧候选重试同时回读目标中的变更路径与原始后像，额外脏写返回冲突或重新冻结。准备失败后继续处理的前缀直接消费原 owner 返回的终态，避免已移除队列的前置冲突丢失。

候选及整合目标拒绝 `assume-unchanged` 和 `skip-worktree` 隐藏索引标记，旧候选重试也核对 index 与工作树两种状态。候选父目录逐层建立并检查真实路径，符号链接或 junction 不能把验证目录重定向到仓库外。

候选中的受管 worker 快照携带原 generation。重试时，原 registry 已记录合并的 worker 必须在目标保有完整后像；恢复到旧基线或仅剩部分成果时返回冲突，历史合并回执保留为历史事实。未完成 worker 继续沿原候选恢复，不要求尚未应用的文件提前出现在目标中。

完成回执按 worktreeId 与 generation 二元身份发布；同名工作树的陈旧或被修改代次不能接收当前回执。worker 冻结前和实际整合前均复用原索引可见性检查，隐藏文件变更不会被当作无成果静默接受。

同批次同时包含 Git 与进程内后端时，仅 Git worker 参与 Git 候选冻结，进程内 worker 使用原内容基线整合。两者的整合回执和验证目录分别进入同一 verifier 任务，Git 检查在冻结候选目录执行，进程内结果按记录的目标目录及后像摘要核对。

当前整合接口只应用受控文件后像，不创建 Git 多父/octopus merge，也不提供自动 `git gc` 或 `worktree prune`。这些路径没有独立验收，属于明确不可用的能力，调用方不得宣称支持。

Electron Main 的 media-core 根入口和子路径通过既有源码 alias 解析；开发与 Vite 构建直接消费 `openclaw_runtime/packages/media-core/src`。

已有工作树记录中的 tuple baseline 和 `lastMerge` 回执由原 registry 读取时归一到当前结构；矛盾终态拒绝读取。整合前从父会话 owner 重核所属会话、代次及工作目录，原成功回执保持可读；目标后像漂移时返回冲突并保留当前字节。
