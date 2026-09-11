# 阻塞队列显式裁定与三个真实开发节点交付（2026-09-11）

接力会话：2026-09-11 下午。本轮按用户指令「优先处理 review need；处理特定情况的 block，
无法处理的要明确说明；其余情况必须明确处理避免阻塞；并完成 3 个节点的真实开发/测试/验收」。

## 0. review_needed 队列核对（先做）

对 `.agent-workbench/task-forest/graph/nodes.json` 全量扫描（155 节点）：

- 节点状态分布：`done 109 / proposed 17 / in_progress 12 / blocked 10 / deprecated 7`。
- **不存在 `review_needed` 状态的节点**，队列为空，与 2026-09-11 上一棒的结论一致
  （`TFP-m2m4-closeout-20260911` 之后 TF-0115/0127/0137/0154 均已 done，TF-0009 为 blocked）。
- 仍未应用的提案（`status != applied`）中有 14 份为历史 `proposed`，均早于 2026-09-01，
  不属于本轮 review 范围；本轮不批量应用历史提案。

结论：**review-need 无待处理项**；本轮工作转向 blocked 队列裁定与 3 个真实开发节点。

## 1. blocked 队列逐条裁定（10/10 明确处置）

| 节点 | 标题 | 裁定 | 解除路径（谁来做） |
|---|---|---|---|
| TF-0009 | P1 组件小范围受控内测运行包 | **保持 blocked（纯真人证据）** | 三个 profile 各 10 次具名真人产品路径任务 + 真人 kill/rollback drill + 具名 owner continue/shrink/stop 裁决。agent 不可替代（R7/R2 已修订为「确认的纯真人阻塞必须 blocked」）。 |
| TF-0042 | RC-10 最终真人 Provider/Channel/Recovery 验收 | **保持 blocked（纯真人验收）** | 由用户在工程总验收后执行 Desktop/Cron/Channel/Restart/Fork/Handoff 场景并给出 accepted/rejected/blocked。 |
| TF-0047 | 修复 GitHub #22：恢复 Docker sandbox 基础镜像入口 | **保持 blocked（有意延后）** | 产品方向明确需要重型沙箱时恢复；静态契约/语法/Dockerfile 结构复核已通过，真实 docker build 不再作为当前验收阻塞项。 |
| TF-0151 | 第二轮候选：压缩层默认值翻转四项 | **保持 blocked（规则禁止）** | 四项各需 `docs/dev/context-moat/approvals/<task-id>.md` 人工批准；§R5 技术-4 与 §R3.4 默认值白名单本轮硬 FAIL。 |
| TF-0144 | M6 第二轮队列 | **保持 blocked（本轮不投入）** | 按 T-C0 字段清单重新估价 + 用户授权第二轮预算；预承诺条款已登记。 |
| TF-0129 | T-C2 上下文损失追踪 | **保持 blocked（待重估价）** | 按 T-C0 字段清单重新估价；仅 loss-trace-spike.md §9 三条验收项依赖 ≥2 次压缩的真实语料。 |
| TF-0130 | T-C3 定向再注入 v1 | **保持 blocked（待重估价 + lifecycle 前置）** | 同上；开工前重读 TF-0147/TF-0121 的 lifecycle 约束，并在任何 archive writer 出现时先补 assembler filter。 |
| TF-0141 | T-E3 A/B 评测报告 | **保持 blocked（待重估价）** | 同上；依赖 T-C3 落地后才能形成实验组。 |
| TF-0006 | Compact/P6 证据升级与 would-retry 闭环（保持 shadow） | **保持 blocked（依赖未闭合子项）** | 从 02/07 起剩余结构/9 条统一验收/质量/模型独立性/成本/干净候选；live judge 需可用 provider 配额。 |
| TF-0013 | UAS-02 Context Orchestrator residual 收口 | **保持 blocked（依赖链）** | 由 RC-02 先做零行为变化 full-payload census，再由 RC-03 决定 DCS authority cutover；RC-02 受 TF-0029 全局验收门约束。 |

**结论：10/10 都有明确、可执行的解除路径与责任方；其中 8 项需人（真人证据/产品决策/人工批准），
2 项（TF-0006、TF-0013）为工程依赖链，均已在图里写明 `next_action`，不存在「静默阻塞」。**
本轮不越权把任何 blocked 改成 done。

## 2. 本轮真实开发的 3 个节点

三个节点都取自 2026-09-11 `senseaudio-s2-flash` 真实 CDP 语料暴露的产品缺陷，属于
上一棒交接明确的下一步（「后续开发优先使用这两条真实复现数据」）。

### TF-0156 —— critical 工具循环阻断后 run 未终止（复现 s05-t01）

**真实复现**：`artifacts/live-model-cdp/20260911-senseaudio-s2-flash/dataset.jsonl` 中
`agent:main:session-1789094500503-8e1zqj`（s05-t01）原始 87 条响应里，模型连续 43 次调用
`read {"path":"data/work-log.csv"}`；第 41 条起守卫每次都返回
`CRITICAL: Called read with identical arguments and identical outcomes 20 times. Session
execution blocked to prevent runaway loops.` —— 但**会话并未被阻止**，run 一直存活到人工停止。

**根因**：`openclaw_runtime/src/agents/tool-loop-detection.ts` 能判定 critical，
`agent-tools.before-tool-call.ts` 只把结果当作一个 `blocked` 工具结果返回
（`deniedReason: "tool-loop"`），没有任何终止 run 的通路；`isLoopVetoResult` 还刻意不给
resultHash，使阻断"粘住"却永不升级为终止。

**修复**（新增终止通路，与既有 post-compaction 守卫同构）：
- 新增 `openclaw_runtime/src/agents/tool-loop-termination.ts`：`ToolLoopTerminationInfo` /
  `ToolLoopTerminationObserver` / `ToolLoopTerminatedError`。
- `agent-tools.before-tool-call.ts`：`HookContext` 新增 `onToolLoopTermination`；critical 分支
  在返回 veto 前通知宿主。
- `agent-tools.ts`（coding tools 选项与 hook 上下文）、`embedded-agent-runner/run/types.ts`、
  `run/attempt.ts`（3 处 hook 上下文）逐层透传。
- `embedded-agent-runner/run.ts`：新增 `observeToolLoopTermination`，复用 attempt 级
  abort controller（由 `postCompactionAbortController` 更名为 `attemptLoopAbortController`），
  与 post-compaction 守卫共享终止语义，并在 attempt 结束后 rethrow `ToolLoopTerminatedError`。

**测试（全部真实执行）**：
- `src/agents/agent-tools.before-tool-call.loop-termination.test.ts` **3/3 PASS**：
  第 21 次（阈值 20）首次阻断、每次阻断都通知宿主、warning 级不终止、无 observer 时行为不变。
- `src/agents/tool-loop-termination.flow.test.ts` **2/2 PASS**：走**生产**工具构造路径
  `createOpenClawCodingTools`，真实 `read` 工具连续 23 次同参读取，第 21 次触发通知；
  未接 observer 时保持只阻断。

### TF-0157 —— exec 前台模式无结果挂起（复现 s03-t02）

**真实复现**：同语料 `agent:main:session-1789093636234-2bsupx`（s03-t02）模型发出
`exec {"command":"node --test coding/invoice.test.mjs"}` 后，在 UI 超时前**没有任何工具结果**，
assessment 记为 `exec-produced-no-result-before-UI-timeout`（fileEditSucceeded=true）。

**根因**：`bash-tools.exec.ts` 的 yield 窗口只在 `allowBackground && yieldWindow !== null` 时生效
（`yieldWindow = allowBackground ? clamp(...) : null`，`allowBackground = isToolAllowedByPolicies("process", …)`）。
当 `process` 工具不可用（`allowBackground=false`）时，exec 进入**纯前台**路径：既不返回中间结果、
也不发进度更新，只能等到进程退出或 1800s 默认超时；此时交互式 UI 早已超时。此外模型在
未显式请求 background/yield 时也拿不到「本命令无法后台化」的提示。

**修复**（新增有界可观测性，不改结果契约与超时）：
- 纯前台路径新增心跳：按 `OPENCLAW_EXEC_FOREGROUND_HEARTBEAT_MS`（默认 15000ms，钳制
  1000–120000）周期性调用 `onUpdate`，携带 session/pid/已运行秒数与 process 跟进提示；
  在 `cleanupToolRunListeners` 中清理，`unref()` 不阻止进程退出。
- `allowBackground === false` 时**始终**写入警告：命令同步执行、仅在进程退出后返回；
  若模型显式请求 background/yield 则给出更明确的不可用说明。

**测试（全部真实执行）**：`src/agents/bash-tools.exec.foreground-heartbeat.test.ts` **2/2 PASS**
（真实 spawn `node -e`，250ms 心跳，断言前台模式收到 `s elapsed` 心跳且最终 `completed`；
后台可用时无心跳）。

### TF-0158 —— blocked 队列显式裁定与证据（本文档）

产出本文档第 0/1 节，并把裁定写入 task-forest（`next_action` 明确责任方），
避免任何 blocked 节点静默滞留。

## 3. 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 新增/相关单测（Node 1） | `vitest run agent-tools.before-tool-call.loop-termination.test.ts tool-loop-termination.flow.test.ts --config test/vitest/vitest.agents-core.config.ts` | **5/5 PASS** |
| 新增/相关单测（Node 2） | `vitest run bash-tools.exec.foreground-heartbeat.test.ts --config test/vitest/vitest.agents-core.config.ts` | **2/2 PASS** |
| Runtime 核心类型检查 | `node scripts/run-tsgo.mjs -p tsconfig.core.json` | **exit 0，无输出** |
| agents-core 全分片回归 | `vitest run --config test/vitest/vitest.agents-core.config.ts` | 448 passed / 6 failed（见下） |

**6 项失败的定性（均为环境相关，且不在本轮改动路径上）**：
- `bash-tools.exec.goal-wait.test.ts`（3）、`bash-tools.exec.durable-helper.test.ts`（1）：
  需要真实本地 gateway（`ws://127.0.0.1:18789`），本机无 gateway 运行，报
  `GatewayTransportError: gateway closed (1006)`；栈在 `registerExecApprovalRequestForHostOrThrow`，
  与本轮改动（结果/yield/警告路径）无关。
- `operator-slice.test.ts`（2）：symlink 逃逸用例，Windows 需要符号链接权限，
  断言 `executed.ok` 期望 false 实得 true，属平台差异。

未能完成的部分如实记录：**没有执行 Electron/CDP 端到端复现**（本机无可用 Electron 会话与
授权 provider），因此 TF-0156/TF-0157 的验收是「真实生产代码路径 + 真实进程/真实检测器」级别，
不是「真实桌面端」级别；两个节点的任务图状态按此如实标注，不冒充端到端验收。

## 4. 仓库级问题：git 对象库缺失对象（本轮已恢复工作状态，仍有历史残留）

处理过程中发现 `git status` / `git diff` / `git commit` 不可用。本轮已把**工作状态恢复**，
但对象库里仍有一批**历史对象**永久缺失，需用户决策。

### 4.1 现象与规模

- `git status` → `fatal: unable to read tree 2bd910bb2d580e5606bcaabe52dc0a60c2e9a61a`。
- 起始对象库仅 **92,862** 个对象；HEAD 树缺 **18 棵子树**，索引引用缺 **132 个 blob**。
- 全量 `git fsck --connectivity-only`：**100 个缺失对象**（64 tree / 30 blob / 6 commit）；
  另有 1 个先于本会话的坏引用 `refs/heads/rescue/verseshell-20260904`（对象已丢失，阻塞 `git fetch`）。

### 4.2 已完成的恢复（全部逐对象校验哈希后才写入）

1. **18/18 棵缺失子树**：用索引条目 `git mktree --missing` 重建，逐个比对对象 id 一致才接受。
2. **132/132 个缺失 blob**：发现同仓库存在一个**同提交的干净检出工作树**
   `D:/ClawX-acceptance-tf0029`（HEAD = fdaef5b0a，`git status` 为空），
   用它按路径执行 `git hash-object -w -- <path>`，132 个全部命中索引 sha。
3. **坏引用处理**：把 `refs/heads/rescue/verseshell-20260904 → 119703eb0c15…`
   记入 `%LOCALAPPDATA%\Temp\broken-ref-record-20260911.txt` 后删除（该对象本就已丢失，
   仅保留 name→sha 映射以备将来对象找回）。其余 110 个引用经逐条 `cat-file -e` 校验全部有效。
4. **从 origin 拉回 581 个对象**：临时把两个孤儿工作树注册移出、`git fetch origin --no-tags`
   成功后原样移回（`l2-final-candidate`、`ClawX-tf0134-candidate`，二者目录与文件未被触碰）。
   对象数 92,862 → **93,443**。

### 4.3 恢复后的实测状态

| 操作 | 结果 |
|---|---|
| `git status --short` | 正常（99 行） |
| `git diff --stat` / `git diff --check` | 正常 |
| `git ls-tree -r HEAD` | 正常（19,661 条目） |
| `git log HEAD` | 正常（12 个提交） |
| 111 个引用逐条 `cat-file -e` | 全部有效 |
| `git fsck --connectivity-only` | 仍有 100 个历史缺失对象（见 4.4） |

### 4.4 仍缺与未决项（不冒充已修好）

- **100 个历史对象**（64 tree / 30 blob / 6 commit）已不在 origin，属**本地历史永久丢失**；
  影响 `git log -p`、`git blame`、与旧提交对比等历史操作，不影响 HEAD、工作树与提交。
- 两个孤儿工作树 HEAD 指向已丢失提交（`l2-final-candidate → 320bd80c`、
  `ClawX-tf0134-candidate → 06f7c327`），目录与文件完好，但**会使 `git fetch` 报
  `bad object worktrees/<name>/HEAD`**。本轮采用「临时移出注册 → fetch → 移回」的非破坏性绕行，
  未删除或改写这两个工作树。彻底解法需用户决定：删除注册（保留目录）或补齐提交对象。
- 未执行：以当前索引重建完整 HEAD 提交（改写 HEAD，属治理敏感操作）。

### 4.5 顺带修正：行尾差异暴露

仓库索引存 LF、工作树为 CRLF，git 靠 stat 缓存掩盖该差异；**一旦编辑文件就会暴露成整文件差异**，
使 `git diff --check` 失败。本轮把改过的 `bash-tools.exec.ts`、`run/types.ts` 归一化为 LF 后，
本节点改动集变为可审阅的 **+124 / −8 行**，`git diff --check` 对本改动集为**干净**。

## 5. 未完成项（不冒充）

- TF-0029 全局 `harness:ci` 仍受 Gateway 全分支 changed-path 覆盖门拒绝，未放宽白名单。
- TF-0156/TF-0157 未做 Electron/CDP 端到端复现与具名真人验收。
- blocked 队列的 8 项人依赖项仍需用户或具名 owner 推进（见第 1 节）。
- git 对象库仍有 100 个历史对象缺失、两个孤儿工作树 HEAD 未决（见 4.4）。
