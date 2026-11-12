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

## 11. CodingRun、Task Loop 与 Task Ledger

`CodingRun` 是 association/projection view，不是第二任务状态机。

- Task Ledger 拥有用户可见任务事实；
- Task Loop 拥有 checkpoint/repair/blocked/evidence-gate；
- CodingRun 关联 code review、runs、files、evidence，但不夺走任务权威；
- 代码审查可读性成功不能自动把 Task Ledger node 改为 done。

## 12. Workspace 与长会话资源

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
