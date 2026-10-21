---
id: versegit-cross-agent-concurrency-research
title: Cross-agent concurrency and snapshot research
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# 跨代理并发与版本快照处理调研

> 调研日期：2026-10-21（Asia/Shanghai）。
> 方法：VerseSearch 路由。AnySearch 用于候选来源发现；Exa 用于官方文档、语义检索与页面摘录。
> 范围：Claude Code、OpenAI Codex、Pi、Jujutsu、Git worktree，以及近期的多代理协调研究。
> 说明：版本与产品行为会变化；本文只对 2026-10-21 可读取的公开资料负责，不把第三方插件能力写成核心产品能力。

## 1. 结论先行

这些系统解决的是同一类问题，但快照层级不同：

| 层级 | 典型实现 | 回答的问题 |
| --- | --- | --- |
| 工作树隔离 | Git worktree | 两个 Agent 是否写同一目录 |
| 会话绑定 | chat/session -> worktree | 恢复会话时回到哪里 |
| 会话快照 | checkpoint / snapshot | 能否撤销当前会话中的修改 |
| 仓库操作快照 | Jujutsu operation log | 某个 repo 在执行某操作前后是什么状态 |
| 语义快照 | VG derived tracking | 这个会话读过什么、写过什么、依据是否过期 |
| 集成候选 | VG candidate / next tree | 多个改动组合后是否仍然成立 |
| 验收证据 | harness | 谁在什么输入上执行了什么，结论是否可复查 |

**worktree 只隔离文件，不协调语义；checkpoint 只恢复某一会话观察到的文件，不是全仓快照；合并成功不等于行为正确。** 这是 VerseGit 在 harness 中存在的根本理由。

## 2. Claude Code

### 2.1 Worktree

官方文档把 worktree 作为并行会话的隔离边界：

- 支持 `--worktree` 启动独立会话；
- 子代理可通过 `isolation: worktree` 使用临时 Git worktree；
- 会话恢复时会检查并重新进入原先绑定的 worktree；
- 运行中的代理会持有 Git worktree lock，清理器不会并发删除；
- 清理 sweep 只处理带 Claude Code marker 的 worktree，手工 worktree 默认更保守；
- worktree 默认分支、`.worktreeinclude`、PR/MR 起步等工作流均可配置。

这说明 Claude Code 的主要并发单元是 **session / subagent**，隔离单元是 **Git worktree**，绑定关系会随会话持久化。

### 2.2 Checkpoint

Claude Code 的另一套机制是 session-local checkpoint：

- 每个开始新 turn 的 prompt 会创建一个 checkpoint；
- 保留最近约 100 个 checkpoint；
- 默认约 30 天后清理 session snapshot；
- `/rewind` 可恢复代码、对话或两者；
- 追踪范围主要是 `Write` / `Edit` / `NotebookEdit` 等文件编辑工具。

官方限制非常关键：

- Bash 命令造成的文件变化不被 checkpoint 捕获；
- 子代理的编辑通常不被主会话 checkpoint 捕获；
- 外部会话和手工修改通常不可见；
- checkpoint 是同一会话内、文件内容级别的恢复，不是全仓快照；
- 目录创建/移动/删除等结构变化不保证被撤销。

**推论：** Claude Code 的 checkpoint 适合“当前会话回退”，不适合作为跨会话候选或 harness 证据。

## 3. OpenAI Codex

官方 Codex worktree 文档描述：

- Worktree 用于让多个独立 chat 在同一项目中并行工作；
- 默认进入 detached HEAD；
- 可从 main、feature branch 或带未提交改动的当前分支开始；
- 可通过 Handoff 在 Local 与 Worktree 之间移动 chat 和代码；
- .worktreeinclude 用于复制被 Git 忽略、但工作树运行所需的本地文件；
- Codex 默认保留最近 15 个 managed worktree；
- pinned chat、in-progress chat、permanent worktree 不会被自动清理；
- 删除 managed worktree 前会保存 snapshot，重新打开 chat 时可恢复；
- managed worktree 与 permanent worktree 的生命周期不同。

这套模型的强项是：

1. 一个 chat 与一个 worktree 建立稳定关联；
2. 把后台工作、前台查看和 handoff 分开；
3. 把清理与恢复纳入产品生命周期；
4. 不污染普通 branch 命名空间，因为默认是 detached HEAD。

边界同样明显：

- 仍然是 Git 分支/提交模型之上的隔离；
- 同一个 branch 不能被两个 worktree 同时 checkout；
- snapshot 主要解决 worktree 被清理后的恢复，不是跨会话语义依赖图；
- 最终集成仍是 commit、branch、PR 或宿主 Git 操作。

## 4. Pi

Pi 的核心是本地 coding-agent 会话与扩展运行时。公开生态中的 worktree 支持主要是 package/extension，而不是本文可确认的“所有 Pi 版本内建能力”：

- `pi-worktree-extension`：把 task、branch、files 与可恢复 Pi session 绑定，支持 `/worktree`、list、exit、remove；
- `pi-worktree`：用一个命令生成 worktree、branch、环境文件、依赖、数据库和端口，并强调完整开发环境隔离；
- 第三方扩展通常在 clean/inactive 时才移除 checkout，分支默认保留，避免强制删除；
- Pi 的扩展拥有用户权限，安装第三方包本身需要供应链接管和审查。

Pi 的架构启示：

- **task/session identity 比目录路径更重要**；
- 恢复时应按任务或会话回到对应 worktree；
- worktree 只解决文件，数据库、端口、环境、依赖需要单独的生命周期；
- 扩展生态能快速补齐并发工作流，但能力边界和版本必须由宿主显式声明。

**边界：** 不应把某个 Pi package 的行为写成 Pi core 的保证。ClawX 若支持 Pi，应把 “Pi core version + worktree extension identity” 作为联合身份。

## 5. Jujutsu（VG 内部图语义引擎）

Jujutsu 与 Git worktree 的关键差异：

- **working-copy auto snapshot**：大多数 `jj` 命令会先把工作副本变化记为 commit/operation；
- **operation log**：每个 operation 含一个 view snapshot，记录 refs、heads、各 workspace 的 working-copy commit；
- **多个 workspace**：同一 repo 可以存在多个 working copy，每个 workspace 可检出不同 commit；
- **stale workspace**：一个 workspace 的 working-copy commit 被另一个 workspace 改写后，旧 workspace 可被识别为 stale；
- **lock-free concurrency**：命令从最新 operation 载入，看不到并发写入的未合并变化，后续通过 operation divergence 或冲突显现；
- **`--at-op`**：可以载入历史 operation 读取旧状态。

官方文档明确说 operation log 支持“无锁并发”，但这不等于语义安全：并发 operation 可以分叉，working copy 可以 stale，后续需要观察、重放和解决冲突。

VG 的 `vg-jj` 适配层把 jj-lib 当作内部图语义引擎；VG 产品仍拥有身份、权限、预算、候选、验证、准入、报告和恢复。这与上游 `jj` CLI parity 无关。

## 6. Git worktree 本身

Git 官方语义：

- 多个 working tree 共享同一 object database，但拥有各自的 HEAD、index 等 per-worktree 文件；
- 可以创建 detached worktree，避免为一次性实验创建 branch；
- 同一 branch 在任一时刻只能在一个 worktree 中 checkout；
- worktree lock 可以阻止 prune/清理误删；
- 底层仍是文本合并模型，不提供语义依赖图或跨会话依据。

所以 worktree 是“车道”，不是“交通规则”。

## 7. 近期多代理协调研究

### 7.1 `Passes Alone, Fails Together`

论文研究“单独通过、组合失败”的语义协调问题：一个补丁改名接口、增加必填参数或改变规则，另一个补丁仍依赖旧假设时，各自测试可能都通过，组合却失败。

对本设计的直接含义：

- isolated worktree 无法消除 producer-consumer 耦合；
- 必须比较组合后的 candidate tree，而不只是每个 side 的绿色测试；
- 需要记录“谁读过哪个符号、基于哪个版本”；
- 需要把并发变化告知相关 Agent，但消息送达不等于模型采纳。

### 7.2 NP-Bench / Nerveplane

该研究把协调部分建模为调度问题：提前按 scope 分区，并按 producer -> consumer 依赖排序；同时用被动 sensing loop 观察各 Agent 的真实 worktree 变化，而不是依赖 Agent 自报。

它给出的重要边界：

- 主动调度在声明 scope 准确、Agent 遵守约束时有明显收益；
- 反应式检测通常在浪费已经发生后才能报警；
- 调度解决“避免写入冲突”，但并不能替代组合候选验证；
- 声明 scopes 不准确或 Agent 越界时，仍需要观察与验证兜底。

**对 ClawX 的映射：** 调度属于 ClawX orchestrator；VG 不抢调度权，只提供真实观察、候选集成和证据。

### 7.3 共享协调状态与 lease

近期研究/实现（如 grite、agent-semaphore、Stitch 等）反复出现相似原语：

- content-addressed draft checkpoint；
- path/symbol scope claim；
- TTL lease、renewal、fencing；
- append-only coordination log；
- serialized landing queue；
- proof-carrying attestation；
- 对 dirty worktree 做只读快照。

这些原语值得吸收，但不应在 ClawX 里再建一套与 VG 竞争的实现。正确的分配是：

- ClawX：调度、权限、用户可见生命周期；
- VerseShell：执行与进程/文件效果；
- VG：仓库会话事实、候选、风险、证据；
- harness：验收契约与最终报告。

## 8. 横向比较

| 能力 | Claude Code | Codex | Pi 生态 | Jujutsu | VerseGit 目标 |
| --- | --- | --- | --- | --- | --- |
| 隔离单元 | session/subagent | chat/managed worktree | task/extension worktree | workspace | worktree + session |
| 默认 branch | 新 branch 或配置 | detached HEAD | 扩展决定 | change/workspace | candidate / detached 临时树 |
| 会话恢复 | worktree binding | handoff + restore | package-defined | working-copy commit/op | session + snapshot identity |
| 会话内撤销 | checkpoint | host/product | package-defined | operation restore | basis/operation/backup |
| 跨会话语义读集 | 无 | 无 | 无（扩展可补） | 无 | derived read/write facts |
| 组合候选 | Git/PR | Git/PR | Git/PR | graph/rebase | next tree + candidate |
| 语义冲突提示 | 无 | 无 | 无 | conflict object | SSI/rw/syntactic/textual |
| 可复查证据 | transcript/checkpoints | chat artifacts | package-defined | op log | ledger/receipt/report |
| 清理恢复 | sweep + lock | snapshot + restore | package-defined | operation/backup | retention plan + backup |
| 第二执行器 | 无 | 无 | package-defined | 无 | host mode 禁止 |

## 9. 七个可复用模式

1. **Worktree 是默认隔离原语。** 不要用“复制目录”替代可用时的 Git/JJ worktree。
2. **Session 必须绑定 worktree 身份。** 仅存路径会在移动、删除、重建后漂移。
3. **Snapshot 必须命名其边界。** 文件、会话、operation、候选和验证证据不能混用同一个词。
4. **清理必须先有恢复证据。** 临时目录删除前应封存 tree/commit/evidence 或明确不可恢复。
5. **并发控制不只有锁。** 需要 TTL lease、fencing/epoch、排序和 stale 检测。
6. **语义协调需要组合验证。** 每个 side 通过不能替代 candidate tree 通过。
7. **观察必须声明覆盖。** 不能把“没看到事件”写成“没有读取/没有冲突”。

## 10. 对 VerseGit 模块的含义

### 保留

- `vg-worktree`：仓库/worktree 身份发现，不重写宿主 worktree manager；
- `vg-kernel`：append-only ledger、session FSM、projection；
- `vg-schema`：事件与 verdict 事实；
- `vg-basis`：版本回执；
- `vg-jj`：内部 graph/operation seam；
- detect/index/verify/admit/report 作为 VG 域内能力。

### 宿主模式新增的约束

- 不自动 `vg init` 用户仓库；
- 不自动创建/删除用户 worktree；
- 不自行执行外部命令；
- 不把 `declare_intent` 当作只读 MCP；
- 不把 `vg land` / `vg admit` 接入默认宿主路径；
- 不把 `single_green_light=false` 的六维 verdict 压成一个绿灯；
- 不把未观测的 read surface 写成空读集。

### 最合适的集成 seam

1. `vg capabilities --json`：组件与工作流能力；
2. `vg doctor --json`：账本链、插件、worktree 诊断；
3. `vg conflicts --json`：符号级事实；
4. `vg verdict --facts <json>`：纯决定函数，输入事实由宿主或 VG 投影产生；
5. `vg report` / `basis`：证据回读；
6. `vg mcp`：只暴露筛选后的只读工具体验。

这意味着 VG 可以先作为 **pure fact + pure decision adapter** 接入，而不需要把整个 daemon 或 verifier 搬进 ClawX。

## 11. 证据限制

- 本文不证明 VG 在 ClawX 上有净收益；这需要真实并发 replay。
- Claude Code checkpoint、Codex snapshot、Pi extension 行为和 jj operation 语义不可互相替代。
- 官方文档描述产品行为，不代表任何特定版本的二进制已经在本机验证。
- 第三方 Pi package 的作者、版本、权限和供应链需要单独审查。
- 任何“覆盖完整”的说法必须带语言、读面和工具面声明。

## 12. 来源

- Git worktree: https://git-scm.com/docs/git-worktree
- Claude Code worktrees: https://code.claude.com/docs/en/worktrees
- Claude Code checkpointing: https://code.claude.com/docs/en/checkpointing
- Claude Code SDK file checkpointing: https://code.claude.com/docs/en/agent-sdk/file-checkpointing
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Codex worktrees: https://developers.openai.com/codex/app/worktrees
- Pi worktree extension: https://pi.dev/packages/pi-worktree-extension
- Pi worktree package: https://pi.dev/packages/pi-worktree
- Pi core repository: https://github.com/badlogic/pi-mono
- Jujutsu working copy: https://docs.jj-vcs.dev/latest/working-copy/
- Jujutsu operation log: https://docs.jj-vcs.dev/latest/operation-log/
- Jujutsu architecture: https://docs.jj-vcs.dev/latest/technical/architecture/
- Passes Alone, Fails Together: https://arxiv.org/abs/2609.25396
- NP-Bench / scheduling planner: https://arxiv.org/html/2610.07261
- Before the Pull Request / shared coordination research: https://arxiv.org/html/2606.19616