# 操作系统交互能力对照：VerseClaw vs Codex CLI

- Date: 2026-10-12
- Type: review / gap-analysis（非实现型 spec，无冻结默认值改动）
- driven_by: agent
- actor: arena-agent
- Base: `arena/25ea6e43-verseclaw` @ `0f39d3ac`
- 姊妹文档：`docs/dev/os-interaction-and-multiagent-resource-scheduling-review-20261012.md`（vs Manus）

> **证据纪律**：VerseClaw 侧每条判断绑定仓库内可核对路径与常量；Codex CLI 侧绑定其公开源码路径（`codex-rs/...`）或 OpenAI 官方工程博客，第三方陈述单独标注。**本文不提出性能提升结论，不修改任何冻结默认值。**

---

## 0. 结论摘要

Codex CLI 和 Manus 是**两种不同的对手**。Manus 靠「一人一 VM」把共享资源问题消掉；Codex CLI 走的是**相反的路**——直接在你真实的机器上跑，但用**操作系统原生的强制隔离**把风险压住。

| 维度 | VerseClaw | Codex CLI | 判定 |
|---|---|---|---|
| 沙箱是否默认开启 | 否（`policy-light`，自述不是边界） | **是**，三平台 OS 原生强制 | **Codex 领先，且是唯一默认开启的主流 agent** |
| macOS 隔离 | `policy-light`（审批门） | Seatbelt `sandbox-exec` + 动态 SBPL | **Codex 结构性领先** |
| Linux 隔离 | `policy-light` | Bubblewrap + seccomp + Landlock | **Codex 结构性领先** |
| Windows 隔离 | **`windows-light` 声明了能力但零实现** | 自建：合成 SID + write-restricted token + 专用沙箱用户 + 防火墙 | **Codex 领先，且我方存在未落地的能力声明** |
| 网络默认 | 策略层（审批） | **workspace-write 下默认关闭** | **Codex 领先** |
| 审批模型 | 执行前门禁（pre-execution gate） | **执行后拒绝检测 → 升级重试** | **Codex 控制流更优**（见 §3.3） |
| Shell 环境快照 | `shell-snapshot.ts`，有密钥过滤 + 5min 刷新 | `shell_snapshot`，登录 shell 捕获 + argv 重写 | **基本持平**，各有取舍 |
| 工具输出截断 | **仅保留头部**（丢掉错误） | HeadTailBuffer 保留头+尾，丢中间 | **Codex 明显更优**（见 §3.2） |
| 长驻进程管理 | VerseShell max 8 / idle 5min / 并发 4 | 统一 exec，max 64 + **LRU 淘汰** | **Codex 略优**（LRU vs 一次性拒绝） |
| 多 agent 并发调度 | 5 类 lease + 路径冲突 + lane + 优先级缺失 | `multi_agent_v1`，子 agent 有 token 预算 | **VerseClaw 在共享调度上更细**（承接 vs Manus 的结论） |
| 内存核算 | Job 限额（opt-in）+ oom_score_adj | 无显式内存账户 | **VerseClaw 领先** |
| 崩溃恢复/回滚 | write-journal 前镜像 + checkpoint rollback | 每轮 git "ghost snapshot"（`undo`） | **基本持平**，机制不同 |

**一句话**：**在「与 OS 的强制边界」这一层，Codex CLI 是当前公开可查的工程标杆，VerseClaw 有代际差距**；在「共享资源的细粒度调度」和「内存核算」上 VerseClaw 更细。最尖锐的三处差距不是工程量问题，而是**三个具体缺陷**（§3），都可以独立修、成本不高。

---

## 1. Codex CLI 的 OS 交互架构

### 1.1 沙箱：把策略编译成 OS 原生强制

Codex 的沙箱是**分层**的：高层 `SandboxPolicy`（表达文件系统与网络权限）→ 平台驱动（把策略翻译成原生机制）→ `SandboxManager` 编排。关键点是**每一个命令从一启动就被沙箱化，且所有后代进程留在同一边界内**——这是 OpenAI 工程博客的原文表述。

| 平台 | 机制 | 关键实现细节 |
|---|---|---|
| macOS | Seatbelt（`/usr/bin/sandbox-exec`） | 动态生成 SBPL profile；**显式把 `.git`、`.agents`、`.codex` 标为只读**，无论外层写权限多宽；用系统绝对路径调用 `sandbox-exec` 而非 PATH 查找（缩小攻击面）；网络限制也在 profile 内，含 proxy 配置与 Unix domain socket |
| Linux | Bubblewrap + seccomp + Landlock | Bubblewrap 构造文件系统视图（只读根 + 可写 overlay）；helper 分两阶段，第二段施加 seccomp 过滤器、必要时加 Landlock 规则 |
| Windows | **自建**（见 §1.2） | 合成 SID + write-restricted token + 专用沙箱用户 + Windows Firewall |

**三档模式**：`read-only` / `workspace-write` / `danger-full-access`。关于默认值，公开资料不一致（配置参考表把 `sandbox_mode` 记为 `read-only`；OpenAI 工程博客把自己的默认模式描述为「几乎随处可读、仅在工作区内可写、默认无网络」）。无论哪种读法，**关键点一致：默认受限于工作区，且默认关闭网络**。第三方综述普遍指出 Codex CLI 是**唯一默认开启沙箱的主流 coding agent**（Claude Code 的 Bubblewrap/Seatbelt 是 opt-in，Gemini CLI 的容器是 opt-in）[1](https://www.bunnyshell.com/guides/sandboxed-environments-ai-coding/)。

**`workspace-write` 下的细粒度控制**：`writable_roots` 把写权限收窄到具体目录；`[[rules]]` 按命令前缀给豁免（`npm test` allow / `docker` deny）——**在不拆除沙箱的前提下**放行特定命令。

### 1.2 Windows：一段值得逐句读的工程记录

OpenAI 专门写了工程博客《Building a safe, effective sandbox to enable Codex on Windows》[2](https://openai.com/index/building-codex-windows-sandbox/)。它有价值的地方不是结论，而是**它把三条死路都走了一遍并说明了为什么死**：

- **AppContainer**：形状不对。Codex 不是「一个范围明确的 app」，它要驱动 shell、Git、Python、包管理器、构建工具。「强隔离，但服务的是比『让 agent 像开发者一样工作』窄得多的负载类型。」
- **Windows Sandbox**：兼容性够，但 Codex 必须直接操作用户真实 checkout 和工具链，不能在一个需要 host/guest 桥接的一次性桌面里干活；而且**Windows Home SKU 上根本没有**。
- **Mandatory Integrity Control（MIC）**：纸面上优雅（低完整性进程 + 把可写根标为低完整性），但**把工作区标为低完整性不只意味着 Codex 能写，而是所有低完整性进程都能写**——「改变了工作区的信任模型，很难收敛、更难辩护」。

最终实现（**elevated sandbox**）：

1. 合成 SID `sandbox-write` 授予 cwd + `writable_roots` 的写/执行/删除权限，并**显式拒绝** `<cwd>/.git`、`<cwd>/.codex`、`<cwd>/.agents`（「可写区内的只读」）。
2. 命令在 **write-restricted token** 下运行，restricted SID 列表 = `[Everyone, 当前登录会话 SID, sandbox-write]`。关键是**写操作要过两次检查**：① 常规身份（token owner）必须被允许；② restricted SID 列表中**至少有一个**被授予访问。这就是 ACL 能精确限定写范围的原因。
3. 为了防火墙能精确匹配到「沙箱进程树」而非整个用户，principal 换成 Codex 自建的本地用户：`CodexSandboxOffline`（被防火墙规则拦）与 `CodexSandboxOnline`（不拦）。
4. 因为 `CreateProcessAsUserW` 在 real-user 侧有权限墙，拆出一支专用二进制 `codex-command-runner.exe`：`codex.exe` 用 `CreateProcessWithLogonW` 以沙箱用户身份拉起它，runner 在**沙箱用户侧** `OpenProcessToken` → `CreateRestrictedToken` → `CreateProcessAsUserW` 落最终子进程。
5. 沙箱用户凭据用 **DPAPI** 加密存储，且放在沙箱用户读不到的位置；提升的 setup 逻辑单独一支二进制（只在需要时跨 UAC 边界，且不让 Windows 专用流程污染其他平台的 `codex.exe`）。
6. 沙箱用户对 `C:\Users\<real-user>`、`C:\Windows\`、`C:\Program Files` 等的**读 ACL 是异步补授的**，避免阻塞用户可见的 setup 步骤。

**unelevated 原型阶段还有一个值得注意的教训**：他们先用「环境变量毒化」做网络抑制（`HTTPS_PROXY=http://127.0.0.1:9`、`GIT_SSH_COMMAND=cmd /c exit 1`、`denybin` 前置 PATH、重排 `PATHEXT`）——然后自己否掉了：「这只对尊重环境变量的工具有效。进程可以无视环境、绕过 PATH、或者直接开 socket。**对对抗性代码不设防。**」

### 1.3 审批：不是门禁，是「被拒绝后升级重试」

这是 Codex 控制流上最容易被忽略、但对体验影响最大的一处设计。Codex **不是在执行前猜命令危不危险**，而是：

1. 命令照常在沙箱里跑。
2. **检测沙箱拒绝**——Linux seccomp 的 stderr `Operation not permitted`、Bubblewrap 的 `bubblewrap is unavailable`、Windows 的 `SetupFailure` + `SetupErrorCode`。
3. 触发**权限升级重试**，由用户审批驱动。

`approval_policy` 四档：`untrusted` / `on-failure` / `on-request` / `never`。注意 `on-failure` ——**它天然就是为上面这个循环设计的**。

这个模型的优势是：**沙箱承担了绝大多数「不需要打扰用户」的决策，审批只在真的撞墙时发生。** 而执行前门禁必须对每个命令做预防性判断，要么打断太多，要么放行太多。

### 1.4 Unified exec：PTY 会话与 LRU 淘汰

- `exec_command` + `write_stdin` 两个工具，背后是 PTY-backed 长驻会话，**环境变量跨 `write_stdin` 保留**（测试用例明确覆盖）。
- `UnifiedExecProcessManager` + `ProcessStore` 管理活跃进程；**达到容量上限时按 `last_used` 淘汰**（LRU），上限 `MAX_UNIFIED_EXEC_PROCESSES = 64`。
- **`HeadTailBuffer`：1 MiB 上限，对称保留前缀（head）与后缀（tail），中间内容被丢弃**并附省略标记。
- yield 时间钳制：`MIN_YIELD_TIME_MS = 250`、`MIN_EMPTY_YIELD_TIME_MS = 5000`、`MAX_YIELD_TIME_MS = 30000`；默认截断 `DEFAULT_MAX_OUTPUT_TOKENS = 10000`。
- 环境注入：在用户环境之上合并固定键（`NO_COLOR=1`、`TERM=dumb` 等）保证输出一致性；`shell_environment_policy.set` 支持 per-thread 环境变量（有人据此要求「证明线程自己的 token 不会留在进程环境里」——**这是一个尚未被验证的边界**）。
- 演进：0.56.0 起 unified exec 在可用平台上成为默认 shell 工具，**所有 shell 活动走同一条 PTY 路径**，降低 per-command setup 开销。

### 1.5 shell_snapshot：登录 shell 只跑一次

`shel_snapshot` 在 `[features]` 中标为 **stable、默认 true**。机制：

- 会话开始时用默认用户 shell 跑一次 **login shell**，产出一个重建 shell 状态的脚本（函数、别名、shell 选项、导出的环境变量）。
- 写到 `codex_home/shell_snapshots/<uuid>.sh`，**会话结束即删除**。
- 之后把登录 shell 调用**重写 argv**：`shell -lc "<cmd>"` → `shell -c ". <snapshot> && <cmd>"`，从而**不再每次重跑 `.bash_profile`/`.zprofile`/`.zshrc`**。
- 边界很清楚：仅 POSIX（bash/zsh/sh），PowerShell/Cmd 直接 bail；**快照是静态的**（会话中途的环境变化不反映）；模型显式换 shell 时该命令禁用快照；只对 login shell 生效；失败是 best-effort（只是本会话禁用快照）。

价值在大型 monorepo：慢 `.zshrc` 每次命令都付一次，多步重构下就是秒级累积。

### 1.6 其他相关的 OS 层事实

- **Rust 重写**（`codex-rs`）：确定性分配器、无 GC 停顿、毫秒级启动——后者对 CI 场景直接相关（「几十个 agent 并行启动」）。
- **`multi_agent_v1`**：独立工具命名空间 `spawn_agent` / `send_input` / `wait_agent` / `close_agent` / `resume_agent`；子 agent 有**自己的全新上下文、收窄的工具集和 token 预算**。
- **`undo`**：per-turn git "ghost snapshots"（opt-in，默认 off）。
- **`ToolRouter`**：所有工具执行都过它，由它在 spawn 任何进程前施加审批策略并选择沙箱。

---

## 2. 逐层对照

### 2.1 VerseClaw 领先或持平的地方

| # | 项 | 证据 | 说明 |
|---|---|---|---|
| 1 | **共享资源调度** | `agents/resource-leases.ts` 的 5 类 lease、`pathKeysConflict` 子树重叠检测、per-`(kind,key)` FIFO | Codex 是**单 agent 为主**，`multi_agent_v1` 的子 agent 各有独立上下文与预算，不存在「N 个 agent 抢同一棵文件树」这个问题的等价解法。这与 vs Manus 的结论一致：**我们的调度复杂度高是架构必然。** |
| 2 | **内存与进程核算** | #155 Job Object（`JOB_OBJECT_LIMIT_PROCESS_MEMORY` / `ACTIVE_PROCESS` / `KILL_ON_JOB_CLOSE`，fail-closed）；`process/linux-oom-score.ts` 的 post-fork shim | Codex **没有显式内存账户**。它靠沙箱边界遏止影响面，但不量化。我们的 Job Object + `oom_score_adj` 在公开范围内更主动。 |
| 3 | **进程树残留验证** | `process/os-containment.ts`：PID 复用 token 校验（`CreationDate.ToFileTimeUtc` / `/proc`）、512 节点上限、5s 探测/沉降 | 未见到 Codex 有等价物。LRU 淘汰只管「记账」，不管「进程是否真死了」。 |
| 4 | **类型化故障语义** | `bounded-concurrency.ts`：`overloaded`/`queue-timeout`/`aborted` + `doubleRelease` + `queuedWaitMaxMs` | Codex 的错误面是字符串与 `SetupErrorCode`。 |
| 5 | **shell 环境快照的密钥过滤** | `shell-snapshot.ts`：`SAFE_ENV_NAMES` 白名单 + `SECRET_ENV_PATTERN` + `SECRET_SHELL_STATE_PATTERNS`（含 `ghp_`/`github_pat_`/`sk-`/`xox[baprs]-`/`AKIA`/私钥头） | Codex 的 `shell_snapshot` 是「捕获登录 shell 导出的环境变量」，公开资料未描述同等的密钥过滤。**这一点我们更谨慎。** |
| 6 | **快照刷新而非一次性** | `SNAPSHOT_REFRESH_MS = 5min`、`SNAPSHOT_MAX_AGE_MS = 3 天` | Codex 的快照是静态的（自己列为已知局限）。我们会在会话中途刷新——代价是行为可预测性略低。 |
| 7 | **跨进程审批与可观测面** | `decideSandboxHighRiskAction()`、`getActiveSandboxHighRiskPolicy()`（strong 请求时强制刷新检测以绕过 15s 缓存）、#156 的 fail-closed 与如实回执 | #156 的处理质量很高：**区分「自动降级」与「显式请求的 strong 未满足」**，后者在 gate 层直接拒绝而不落 host。 |

### 2.2 我们落后的地方

| # | 项 | 我们 | Codex | 差距性质 |
|---|---|---|---|---|
| 1 | 隔离强制 | `policy-light`（自述不是边界）+ Docker/SSH（可选、会降级） | 三平台 OS 原生强制，**默认开启** | **代际** |
| 2 | 网络默认 | 策略层 | workspace-write 下**默认关闭** | **默认姿态** |
| 3 | Windows | `windows-light` 只有标签与能力声明 | 自建完整实现（§1.2） | **从零起步** |
| 4 | 审批控制流 | 执行前门禁 | 拒绝检测 → 升级重试 | **范式** |
| 5 | 输出截断方向 | 仅头部 | head+tail，丢中间 | **具体缺陷** |
| 6 | 长驻进程淘汰 | `maxProcesses: 8`，满了直接拒（`VerseShell process limit (8) reached`） | 64 + **LRU 淘汰** | **策略** |

---

## 3. 三个应当立刻修的具体缺陷

这三项**互相独立、成本不高、且都是确定性缺陷**，与「是否要做大隔离」无关。

### 3.1 `windows-light` 声明了没有实现的能力 ⚠️ 最高优先级

`electron/utils/sandbox-provider-detection.ts:83-91`：

```ts
{
  id: 'windows-light',
  label: 'Windows-light',
  available: windowsLightAvailable,          // = process.platform === 'win32'
  runtimeLevel: windowsLightAvailable ? 'light' : 'unavailable',
  reason: windowsLightAvailable
    ? 'Uses ClawX/Main policy gates plus Windows-oriented lightweight process controls where available. Not equivalent to Docker or a VM.'
    : 'Only available on Windows.',
  capabilities: windowsLightAvailable
    ? ['workspace-readonly', 'workspace-readwrite', 'process-limits', 'restricted-token']
    : [],
}
```

在全仓搜索 `CreateRestrictedToken` / write-restricted token / `SandboxUser` / firewall 相关实现，**除了这个声明本身与 `shared/types/sandbox.ts` 的类型定义，没有任何实现**。`windows-light` 的全部消费点只有四处：`sandbox-policy-resolver.ts:78`（case 分支）、`workspace-runtime-permissions.ts:124/269/281`（id 归一化 + 返回 runtimeLevel `'light'`）、以及上面这个能力声明。

也就是说：**`process-limits` 和 `restricted-token` 是在一个没有对应实现的 provider 上对外声明的能力**。这与仓库自身的治理机制直接冲突——`shared/capability-claims.ts` 定义了 `FP-OVERCLAIM` 分类，`shared/product-semantic-unsafe-claims.ts` 用正则拦截不安全表述，而这里连正则都拦不住，因为它是**结构化的 capability 字段**。

同时注意 `reason` 的措辞「Windows-oriented lightweight process controls **where available**」是含糊的——它没有说清「available 的情况下具体是什么」。对照 #155 建立的「请求—应用—强制—证据」回执模式的诚实标准，这条声明不达标。

**修法（二选一，必须选一个）**：
- **(A) 诚实降级**：把 `capabilities` 改成实际存在的东西（`['workspace-readonly','workspace-readwrite']`），把 `runtimeLevel` 保持 `'light'` 但 `reason` 明确写「与 `policy-light` 的差异仅在于**已接线的 Job Object 资源限额**（见 #155）」，并**从类型面移除 `'restricted-token'`**（`shared/types/sandbox.ts:19`）除非真的接线。
- **(B) 接线 Job Object 到沙箱判决**：把 #155 已落地的 Job Object 限额（memory / active processes / kill-on-close）真正挂到 `windows-light` 的 `process-limits` 语义下，并在诊断面输出 #155 式的回执（`requested`/`applied`/`enforced`/`enforcement`/`evidence`/`readback`）。此时 `process-limits` 是真的，`restricted-token` 仍须删除或标注为未实现。

**推荐 (B)+(A) 组合**：`process-limits` 接线为真，`restricted-token` 如实移除。**不要**保留一个声明了 `restricted-token` 却只做审批门的 provider——这正是 Codex 博客里批评的「advisory 而非 enforcement」。

### 3.2 `capToolResultText` 只保留头部，系统性丢弃错误 ⚠️ 高优先级

`shared/agent-resource-limits.ts:153-168`：

```ts
export function capToolResultText(
  text: string,
  maxChars: number = getAgentResourceLimits().maxToolResultChars,   // 默认 80_000
): { text: string; truncated: boolean; originalLength: number; maxChars: number } {
  const originalLength = text?.length ?? 0;
  const safeMax = Math.max(64, Math.floor(maxChars));
  if (originalLength <= safeMax) {
    return { text: text ?? '', truncated: false, originalLength, maxChars: safeMax };
  }
  const keep = Math.max(0, safeMax - 48);
  return {
    text: `${text.slice(0, keep)}\n...[tool result truncated ${originalLength - keep} chars]`,
    ...
```

**`text.slice(0, keep)` 是纯头部截断。** 对工具输出而言，这是**方向错误的**：

- 编译/测试失败的**错误信息在末尾**；
- `npm install` / `pip` 的失败原因在末尾；
- `git` 的冲突与摘要通常在末尾；
- 崩溃的 stack trace 结尾是最具体的那几帧。

把尾部砍掉，等于**系统性地把最有诊断价值的部分删掉**，只留下最没信息量的开头。这与 Manus 的「把错误留在上下文里」和 Codex 的 `HeadTailBuffer`（对称保留 head + tail、丢中间）**在取向上直接相反**。

对照 Codex：`HeadTailBuffer` 在 1 MiB 上限内保留**对称的前缀和后缀**，中间内容被丢弃并附省略标记。这个设计选择让模型既能看到「命令回显/标题」（head）又能看到「错误/结论」（tail）。

**修法**：把 `capToolResultText` 改为 head+tail 保留，例如各占一半（`head = keep/2`，`tail = keep/2`），中间插入 `...[tool result truncated N chars]...`。签名与返回类型不变，**不改变 `maxToolResultChars` 默认值**（80_000），因此不触碰冻结默认。这是一个纯内部改动，影响面小、收益直接。**建议顺带加单测：断言 80_001 字符的输入，其最后 100 字符仍出现在输出中。**

### 3.3 缺少「沙箱拒绝 → 升级重试」的控制流 ⚠️ 中高优先级

我们的模型是**执行前门禁**：`decideSandboxHighRiskAction()` 在命令跑之前判断要不要审批。Codex 的模型是**执行后检测**：命令先在沙箱里跑，撞墙了才升级。

两者的体验差异在沙箱真正生效之后才会暴露——因为如果沙箱是 `policy-light`（没有强制边界），就**没有「拒绝」可检测**，门禁是唯一手段。所以这条与我们是否做强制隔离**强耦合**：**先有边界，才谈得上检测拒绝。**

但有一件现在就能做且独立有意义的事：**把「沙箱拒绝」作为一等错误类别**。目前 `bounded-concurrency.ts` 已经区分了三类拒绝，但**沙箱导致的失败和普通运行时失败是不分的**。新增一个 `SandboxDenialError` 类（携带 `mechanism` / `path` / `operation`），并在诊断面区分：

- 一旦未来接线 Landlock / Seatbelt / Job Object，**拒绝检测的钩子已经就位**；
- 即使现在，把「审批被拒」「策略拒绝」「沙箱拒绝」「运行时错误」四者分开，也能显著改善排障与 `decideSandboxHighRiskAction` 的判定质量。

Codex 的检测方法可以直接借鉴：Linux seccomp 的 stderr `Operation not permitted`、Bubblewrap 的 `bubblewrap is unavailable`、Windows 的 `SetupFailure` + `SetupErrorCode`。

---

## 4. 优化方案

排序原则与 vs Manus 文档一致：**先诚实、再观测、再边界、最后升级**。Codex 的经验告诉我们：**边界的价值来自「默认开启 + 真实强制」，而不是来自「支持多少种 provider」。**

### Phase A：诚实与正确性（本周可完成，零架构风险）

- **A-1 修正 `windows-light` 能力声明**（§3.1）。这是一条**对外声明**，优先级高于任何性能工作。
- **A-2 `capToolResultText` 改 head+tail**（§3.2）。加断言尾部保留的单测。
- **A-3 新增 `SandboxDenialError` 类别**（§3.3），打通诊断面。
- **A-4 审计所有 `capabilities` 字段**：把 `sandbox-provider-detection.ts` 的每个 capability 与真实实现逐条对账，产出 `artifacts/` 下的对账表。按 `shared/capability-claims.ts` 的 `FP-OVERCLAIM` 分类如实归档。

### Phase B：把「默认关闭网络」变成事实

Codex 最重要的一条默认值是 **workspace-write 下网络默认关闭**，理由是「多数外泄路径需要网络出门」。我们目前网络是策略层的。

- **B-1 定义并落地 workspace 级网络默认姿态**：新增「默认拒绝出网、按需放行」的沙箱网络策略，复用已有的 `SandboxNetworkPolicy` 类型面（注意 `normalizeNetworkPolicy` 已把 legacy `localOnly` 折进 `approvalRequired`——不要引入第二套语义）。
- **B-2 明确区分「advisory」与「enforcement」**：Codex 在 unelevated 原型阶段自己否掉了环境变量毒化的方案，理由值得原样抄进我们的设计原则：**「进程可以无视环境、绕过 PATH、或者直接开 socket。」** 任何网络限制的设计文档都必须回答：**这个限制对不尊重环境变量的程序有效吗？** 如果答案是否，就在文档和 UI 上标注为 advisory。

### Phase C：长驻进程与输出缓冲对齐

- **C-1 `ProcessStore` 式 LRU 淘汰**：`verseshell/process-manager.ts` 现在是 `maxProcesses` 满即拒（`VerseShell process limit (N) reached`）。改为在达到上限时按 `lastUsedAt` 淘汰最久未用的进程。注意：**淘汰必须走 #155 建立的终止语义**（`KILL_ON_JOB_CLOSE` / 确认退出），不能引入「记账腾位但进程仍在」的幽灵。`idleTtlMs` 的 5 分钟空转清理可以作为第二层。
- **C-2 输出缓冲对齐 HeadTailBuffer**：VerseShell 的 `maxLineBytes` 是 4 MiB 单行上限——这是**行级**保护，与工具结果的**总量**截断（A-2）是两件事。A-2 修完后，确认两者不会互相抵消（例如行级截断发生在头部，总量截断发生在尾部时，中间到底留下了什么）。
- **C-3 未验证边界的诚实标注**：Codex 那边有人明确要求「证明线程自己的 token 不会留在进程环境里」而目前**未被验证**。我们对应的问题是 `sanitizeHostExecEnv` 与 `shell-snapshot.ts` 的密钥过滤——**过滤是白名单机制，这是好的**，但需要一条负向测试证明：**一个包含 `GITHUB_TOKEN` 的登录 shell 环境，其快照文件中不出现该值**。如果已有，标注；如果没有，补上。

### Phase D：沙箱强制（对 Codex 结构优势的正面回应）

不追求一步到位造 Windows 沙箱。按**成本递增、每级 fail-open 且带真实回执**落地，与 vs Manus 文档的 L0–L4 分层合并考虑：

| 级别 | 机制 | 覆盖 | 成本 | 备注 |
|---|---|---|---|---|
| L0 | 现状（`policy-light` 审批门） | 误操作 | 零 | 保持为默认 |
| **L1** | **macOS Seatbelt / Linux Landlock+seccomp / Windows Job Object + restricted token** | 资源耗尽、越界写、部分特权逃逸 | **中** | **这是最该投的一级** |
| L2 | COW 工作区快照（APFS `clonefile` / Btrfs `reflink` / Windows 块克隆） | 工作区污染、可回滚 | 低 | 见 vs Manus 文档 P4-3 |
| L3 | `docker-strong`（已存在） | 强隔离 | 中 | 保留 |
| L4 | VM 后端（opt-in） | Manus 级隔离 | 高 | 不作为默认 |

**L1 的具体做法建议**（成本可控、不引入新平面）：

- **macOS**：Seatbelt 的 profile 生成是纯字符串拼接，**没有守护进程、没有安装步骤**。直接调 `/usr/bin/sandbox-exec`（**用绝对路径，从 PATH 查找会放大攻击面**——这是 Codex 的明确做法）。`.git`/`.codex` 一类目录要**显式标为只读**，无论外层写权限多宽。
- **Linux**：Landlock 是**非特权**的（不需要 root、不需要容器运行时），对「工作区之外的读写」这一主要威胁是极高性价比的一级。Bubblewrap 需要额外二进制，可作为可选增强。
- **Windows**：**不要照抄 Codex 的四二进制架构。** 他们的复杂度是被「要用 Windows Firewall 精确匹配沙箱进程树」这个目标逼出来的（合成 SID → 专用用户 → 跨 UAC setup → command-runner 拆分之）。如果我们**暂时放弃防火墙级网络强制**，那么 **unelevated 路径（合成 SID + write-restricted token + ACL）就足够了**——Codex 自己说这条路「用少数标准 Windows 能力就达成目标、写权限粒度显式且细、无需提权」。他们的 unelevated 原型只有四个已知缺点，其中三个（setup 速度、ACL 足迹、语义难改）是**固有代价**，只有第四个（网络抑制 advisory）是促使他们重设计的原因。**先做 unelevated，把网络姿态留到 Phase B 单独解决。**

**无论哪一级，都必须遵守 #155 已经建立的诚实标准**：回执必须包含 `requested` / `applied` / `enforced` / `enforcement` / `evidence` / `readback`，且在**未生效时不得声称生效**。Codex 博客里那句「it was still only advisory... too risky」应当成为我们的设计红线。

### Phase E：shell 快照与启动开销

我们已经做得不错（§2.1 #5/#6）。可考虑的两个增量：

- **E-1 argv 重写**：Codex 把 `shell -lc "<cmd>"` 重写成 `shell -c ". <snapshot> && <cmd>"`，从而**彻底避免每次重跑登录脚本**。检查我们是否已经做到这一步，还是只在环境变量层面复用。
- **E-2 启动延迟指标**：Codex 的 Rust 重写把「毫秒级启动」当作 CI 场景的硬需求。我们有 Electron + Node 的双进程结构，**启动成本结构完全不同**，不应盲目对标；但应当把「从冷启动到首个可用观察（TTFO）」纳入指标（见 vs Manus 文档 Phase 0-3），这样才能判断哪些启动成本值得优化。

---

## 5. 不该从 Codex 抄的东西

| 不抄 | 原因 |
|---|---|
| 四二进制 + 专用 Windows 用户 + 防火墙的完整架构 | 复杂度是被「防火墙精确匹配沙箱进程树」逼出来的。放弃该目标即可用 unelevated 路径拿到大部分价值。且我们的产品定位是桌面应用，不应要求 setup 阶段的 UAC 提权 |
| 环境变量毒化做网络抑制 | Codex 自己否掉了：「进程可以无视环境、绕过 PATH、或者直接开 socket」。任何采纳此法的设计都应在文档里标注 advisory |
| 单 agent 优先 / 无共享调度 | Codex `multi_agent_v1` 的子 agent 各有独立上下文，不存在共享工作区争用。**我们的 lease 内核恰恰是它没有的东西**，不要因为对齐而删掉 |
| Rust 重写的启动延迟对标 | 架构形态不同（Electron+Node vs 单体 Rust）。对标启动数字会误导优化方向 |
| `sandbox_mode` 默认值的简单照搬 | 公开资料对 Codex 该字段默认值记载不一致。且我们是桌面 GUI 应用，用户期望的默认安全姿态与 CLI 工具不同——**应自行决策并写清理由，而不是抄一个数字** |

## 6. 该从 Codex 抄的东西

| 抄 | 落地形式 |
|---|---|
| **沙箱默认开启 + 真实强制**（而非可选 provider） | Phase D 的 L1；这是 Codex 最核心的取舍 |
| **网络默认关闭** | Phase B-1 |
| **「可写区内的只读」**（`.git`/`.codex` 显式保护） | Phase D L1；即使 ACL/Seatbelt 给了更宽的写权限，这三个目录也要单独拒绝 |
| **HeadTailBuffer 的对称保留** | Phase A-2；直接修确定性缺陷 |
| **LRU 淘汰而非满即拒** | Phase C-1 |
| **绝对路径调用沙箱二进制** | Phase D；不用 PATH 查找 |
| **「检测拒绝 → 升级重试」而非执行前门禁** | Phase A-3 先备好钩子；Phase D 接线后成为主流程 |
| **OpenAI 的死路记录方法本身** | 三条否决理由（AppContainer 形状不对、Windows Sandbox 产品不可用、MIC 改变了工作区信任模型）应当原样进入我们的 `docs/dev/` 决策记录。**记录「为什么没走某条路」和记录「走了哪条路」同等重要** |
| **advisory vs enforcement 的自我审问** | 任何隔离/限制设计文档都必须回答：「对不尊重该机制的程序有效吗？」 |

---

## 7. 验收与证据要求

沿用仓库既有纪律，且额外针对本次发现的缺陷类型：

1. **Phase A** —— `windows-light` 的对账表必须逐条列出 capability → 实现路径 → 分类（`TP-SRC` / `FP-OVERCLAIM` / `PARTIAL`）。**这是本次评审里唯一涉及「对外声明与实现不一致」的项，必须优先闭环。**
2. **A-2** —— 必须有单测断言尾部落差：输入超限时，**最后 N 字符出现在输出中**。
3. **Phase B** —— 网络默认关闭必须区分 advisory 与 enforcement，并在文档中给出「对不尊重该机制的程序是否有效」的明确回答。
4. **Phase C-1** —— LRU 淘汰必须有测试证明：被淘汰的进程**确实终止**（复用 #155 的 Job Object 语义 / `killProcessTree`），而不是仅从账上消失。
5. **Phase C-3** —— 密钥过滤需要**负向测试**：含 `GITHUB_TOKEN` 的登录 shell 环境，快照文件不出现该值。
6. **Phase D** —— 每级隔离必须有 #155 式的回执（`requested`/`applied`/`enforced`/`enforcement`/`evidence`/`readback`），且**不可用时必须 fail-open 并给出如实 reason**。平台不可用时不得声称生效。
7. **全局** —— 不改冻结默认值。`capToolResultText` 签名与 `maxToolResultChars` 默认值（80_000）保持不变。如需改动默认值，按 `AGENTS.md` §5 升级给所有者。

---

## 8. 优先级建议

若只能做三件事：

1. **A-1（修正 `windows-light` 能力声明）** —— 这是一条**对外声明与实现不一致**的问题，性质比性能问题严重。它同时会暴露「还有多少 capability 是声明出来的」，A-4 的对账表是有独立价值的产物。
2. **A-2（`capToolResultText` 改 head+tail）** —— 纯内部、零架构风险、默认值不变，但直接决定了模型**能不能看到错误信息**。这是本次两个对照文档里**性价比最高的单项改动**。
3. **D-L1 的 Linux/macOS 部分（Landlock / Seatbelt）** —— 非特权、无守护进程、无安装步骤，用最小的工程量把我们从「审批门」推进到「真实边界」。**Windows 的 unelevated 路径紧随其后，但不要照抄 Codex 的四二进制架构。**

**顺序不能颠倒**：Phase A 是诚实性问题，Phase B/C 是正确性与策略问题，Phase D 才是能力问题。**在一个声明了未实现能力的系统上叠加新能力，只会让对账变得更难。**
