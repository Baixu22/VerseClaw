# ClawX coding 能力对齐缺口盘点(四开源项目)

> 盘点范围:参照 `%USERPROFILE%\Desktop\coding\source_archive\` 下 aider / codex / cline / open_swe 的 coding 能力面,
> 对照本地 `openclaw_runtime/src/` + `electron/services/`。
> 状态:✅ 已对齐 | 🟡 部分对应(语义对齐/机制不同,列缺什么) | ❌ 无对应(未引入)。
> 已审计并修复的 8 项(edit-did_you_mean、checkpoint 回滚、mission-control、git 防护、autoVerify、SSRF、execpolicy 前缀、CI 门禁)不重复列入。

---

## 一、Aider(coders/ + linter.py + repomap.py)

| 能力 | 参照证据 | 语义 | 状态 | 本地现状 |
|---|---|---|---|---|
| auto-test 写后自动测试 | `base_coder.py:1616-1623` | 编辑后自动跑测试命令回喂 | ✅ | `write-side-effects.ts:417-452` autoVerify(探测 runner 自动执行,已对齐) |
| editblock SEARCH/REPLACE 块解析 | `editblock_coder.py:439` `find_original_update_blocks` | 解析 `<<<<<<< SEARCH` 围栏文本块 | 🟡 | 结构化 `edit` 工具(`edit.ts:374`,`edit-diff.ts:348`)替代;缺围栏块文本语法与跨文件块回退 |
| fuzzy 匹配链 | `editblock_coder.py:134-296` | 完美→空白弹性→`...`展开→编辑距离 | 🟡 | `apply-patch-update.ts:132-176` + `edit-diff.ts:235-282` 已对齐 4 级;缺 `...` 省略号块展开、相对缩进弹性 |
| 反射循环 | `base_coder.py:924-939` | 失败错误文本反射回模型重试(上限 3) | 🟡 | 工具错误作 tool_result 回喂 + `mission-control/controller.ts:1051-1102` repeatedRepair;无显式反射计数循环 |
| repomap PageRank | `repomap.py:365-703` | 符号引用图 PageRank + token 预算注入 | 🟡 | `runtime-core/agent-map.ts:973-1213` 加权打分(活动文件/提及符号);缺 networkx pagerank、tags 磁盘缓存、多语言支持 |
| architect/editor 模式 | `architect_coder.py:11-47` | 架构师模型写方案→editor 模型落地 | 🟡 | `role-contract.ts:276-307` architect/implementer 角色化编排 |
| shell 块建议 | `base_coder.py:2434` + `editblock_coder.py:33` | 解析 ` ```bash ` 围栏请求确认 | 🟡 | `bash-tools.exec.ts` + 审批链(工具调用,非文本块) |
| 文件提及自动入 chat | `base_coder.py:1761` | 回复提及新文件自动加入上下文 | 🟡 | `agent-map.ts:1035,1191` mentionedFiles 个性化;无自动入会话机制 |
| **udiff 统一 diff 编辑** | `udiff_coder.py:209-337` | 解析 ` ```diff ` + `@@ -a,b +c,d @@` hunk 带上下文部分应用 | ❌ | `apply-patch.ts:43-51` 仅 Codex 信封;`edit-diff.ts:415` 只生成展示 diff 不反向应用 |
| **search_replace 容错策略链** | `search_replace.py:18-565` | dmp 行级 diff + RelativeIndenter 相对缩进 + git 临时仓 cherry-pick | ❌ | 无 dmp 实现,本地为自研 LCS+归一化 |
| **auto-commit** | `base_coder.py:2375-2411` | 编辑后自动 git commit(undo 基线) | ❌ | `infra/git-commit.ts` 仅构建元数据;undo 链用 journal 无 commit 基线 |
| **auto-lint 反射** | `linter.py:21-201` + `base_coder.py:1599-1607` | 编辑后自动 lint,错误带 tree_context 回喂 | ❌ | 无 auto-lint 集成(lint 由外部 ESLint 流程承担,非模型反馈链) |
| editor-whole/editor-diff 格式 | `editor_whole_coder.py`、`editor_editblock_coder.py` | editor 模型专用格式变体 | ❌ | 无 "editor model" 概念(架构差异,可不引入) |

## 二、Codex(apply-patch/exec/execpolicy/git-utils/core-context/linux-sandbox)

| 能力 | 参照证据 | 语义 | 状态 | 本地现状 |
|---|---|---|---|---|
| apply-patch 信封解析/执行 | `apply-patch/parser.rs`、`lib.rs` | V4A 信封 add/update/delete/move | ✅ | `apply-patch.ts:430-578` + preflight 批量回滚(更强,UAS-04) |
| seek_sequence 4 级匹配 | `apply-patch/seek_sequence.rs:12-110` | exact→rstrip→trim→Unicode | ✅ | `apply-patch-update.ts:132-176`(含 EOF 哨兵与 did-you-mean) |
| execpolicy 前缀三态 | `rule.rs`、`policy.rs`、`decision.rs` | PrefixPattern + Allow/Prompt/Forbidden | ✅ | `exec-command-resolution.ts:395` + `exec-approvals-allowlist.ts:1131`(含链式拆段,更强) |
| git 防护包装 | `git-utils/info.rs:421-444` | env 注入禁用 hooks/locks/prompt | ✅ | `git-api.ts:137-173` + `worktree-service.ts`(已补齐 timeout/stdin) |
| git info 采集 | `git-utils/info.rs` | 仓库元数据读取 | ✅ | `git-api.ts` |
| core-context compaction | `core-context/compact.rs` | 上下文压缩 | ✅ | `context-engine/` compaction 体系 |
| exec ThreadEvent 事件流 | `exec/exec_events.rs:11-37` | thread/turn/item 生命周期 JSONL + file_change/collab/todo item | 🟡 | `trajectory/runtime.ts:157-222` JSONL + talk-events.ts;缺统一生命周期协议与 file_change/collab/todo item 类型 |
| event_processor | `event_processor.rs:13-29` | 通知/警告处理 | 🟡 | `cli-output.ts`/`status-message.ts` 承担,形态不同 |
| network_rule | `rule.rs:117-212` | host/protocol/decision 网络规则 | 🟡 | 本地无 network 级审批规则(仅命令级) |
| 规则文本解析 | `execpolicy/parser.rs` | allowlist 文本格式解析 | 🟡 | `exec-approvals.types.ts` 结构化 JSON 配置,非文本规则文件 |
| auto_compact 窗口状态机 | `core-state/auto_compact_window.rs` | 自动压缩窗口推进 | 🟡 | `context-engine/` compaction 有预算守卫,无窗口状态机 |
| git operations(merge-base/fsmonitor) | `git-utils/operations.rs`、`fsmonitor.rs` | merge-base 计算、fsmonitor 保护 | 🟡 | `git-api.ts` 无 merge-base 工具;git 调用未防 fsmonitor 挂起 |
| **amend 规则文件持久化** | `execpolicy/amend.rs` | 规则文件追加/去重(advisory-lock) | ❌ | 无规则文件持久化(配置走 JSON) |
| **rollout_budget 注入** | `core-context/rollout_budget.rs` | 滚动预算上下文注入 | ❌ | 无注入式预算 |
| **token_budget `<context_window>` 注入** | `core-context/token_budget_context.rs` | 剩余 token 预算注入 | ❌ | 预算为守卫非注入 |
| **git merge-base 工具** | `git-utils/branch.rs`、`operations.rs` | merge-base 查询(PR 场景) | ❌ | 无 |
| baseline 影子 git | `git-utils/baseline.rs` | 内部目录变更检测基线 | ❌ | 有意不引入(journal/观察面替代) |
| invocation heredoc 拦截 | `apply-patch/invocation.rs:27-80` | 从 shell heredoc 提取 patch | ❌ | 工具调用不经 shell,机制替代,不需引入 |
| landlock/bwrap 沙箱 | `linux-sandbox/` | OS 级文件系统/网络隔离 | ❌ | Windows 不可移植;以 docker/policy-light/verseshell 替代 |

## 三、Cline(core-session/ + cli-approval/ + vscode-checkpoints/)

| 能力 | 参照证据 | 语义 | 状态 | 本地现状 |
|---|---|---|---|---|
| checkpoint 创建 | `checkpoint-hooks.ts:154-298` | git stash create + 私有 ref 索引 | 🟡 | `long-task-control/store.ts:55-97` SQLite checkpoint(task-loop tick 触发,非 user-run 计数) |
| checkpoint 恢复 | `checkpoint-restore.ts:50-379` | reset+clean+stash apply + 消息裁剪 | 🟡 | `checkpoint-rollback-executor.ts:88-222` journal 回滚(已修复 seq 边界);缺消息裁剪到 run |
| cli-approval 审批流 | `cli-approval/approval.ts:102-160` | 桌面 IPC/终端 TTY 同步审批 | 🟡 | 异步通道化审批(socket/JSONL),无 TTY readline |
| tool-policies 工具策略 | `cli-approval/tool-policies.ts:3-95` | per-tool autoApprove 布尔 + 通配 | 🟡 | `exec-approvals.ts:26-136` exec-mode ask/security + `sandbox/tool-policy.ts:38-60` 工具 allow/deny(粒度不同) |
| **checkpoint 内容 diff** | `checkpoint-diff.ts:121-140` | checkpoint vs 工作区逐文件左右内容对比 | ✅ 已引入 | `openclaw_runtime/src/agents/checkpoint-diff.ts`(journal .pre 快照)+ CheckpointsDialog 展开面板(2026-08-01) |
| sdk-checkpoints | `vscode-checkpoints/sdk-checkpoints.ts` | VS Code 消息级 run 识别 | ❌ | 无 VS Code 扩展面(本地无此形态,可不引入) |

## 四、Open SWE(top/ + graphs/ + tools/ + middleware/ + review/ + runtime/)

| 能力 | 参照证据 | 语义 | 状态 | 本地现状 |
|---|---|---|---|---|
| SSRF(fetch_url/http_request) | `tools/fetch_url.py:38-49`、`http_request.py:58-66` | 私有 IP 拦截+重定向重评估 | ✅ | `infra/net/ssrf.ts` + `fetch-guard.ts`(强于缺失的 url_safety.py) |
| web_search | `tools/web_search.py:13-99` | Exa 搜索写沙箱 | ✅(更强) | `agents/tools/web-search.ts:78-121` 多 provider 插件化 |
| scheduler | `top/scheduler.py:23-40` | cron tick fan-out + reconcile | ✅ | `agents/tools/cron-tool.ts` + `tasks/task-registry.ts` |
| runtime/sandbox | `runtime/sandbox.py:6-37` | 沙箱转发 | ✅(超配) | `agents/sandbox/` docker/SSH/fs-bridge 完整实现 |
| search_repo_code | `tools/search_repo_code.py:30-84` | GitHub code-search API | 🟡 | `context-engine/tools/context-search-tool.ts:50` 本地检索;无远端仓库检索 |
| read_repo_file | `tools/read_repo_file.py:39-105` | GitHub contents API 读 ref | 🟡 | `agent-tools.read.ts` 读本地文件;无 GitHub API 远端读 |
| open_pull_request | `tools/open_pull_request.py:748-791` | 三级 preflight + 422 复用 + draft | ✅ 已引入 | `git-api.ts` prCreate base/head preflight + `gh pr list` 重复 PR 复用(2026-08-01) |
| check_message_queue | `middleware/check_message_queue.py:148-247` | 外部消息 FIFO 注入 before_model | 🟡 | `embedded-agent-runner/run/attempt.queue-message.ts:96-108` steering 队列(作用域不同) |
| prepare_run | `middleware/prepare_run.py:41-93` | fingerprint 幂等 run 准备 | 🟡 | `attempt-bootstrap-*` 启动链;无 fingerprint-latch 中间件 |
| sandbox_circuit_breaker | `middleware/sandbox_circuit_breaker.py:240-293` | 沙箱连接连续失败熔断 | 🟡 | `tool-loop-detection.ts:594-601` no-progress 熔断(语义不同) |
| chat(PR 答疑) | `top/chat.py:214-261` | 无沙箱只读 PR 答疑 + `/pr/*` 虚拟文件 | 🟡 | `orchestrator-run.ts:221` 只读 subagent;无 PR 虚拟文件上下文 |
| **review/findings in-diff 校验** | `review/findings.py:102-710` + `review/diff.py:139-209` | finding 30+ 字段、行锚点 in-diff 校验、fingerprint、cap=6 | ✅ 已引入(行锚点校验) | `code-review-api.ts` validateFindingsInDiff(hunk 行集合校验,降级 info)(2026-08-01) |
| **plan_mode 门控** | `tools/enter_plan_mode.py`、`approve_plan.py`、`save_plan.py` + `middleware/plan_mode.py:40-81` | 只读计划模式 + 剥工具门控 + 计划审批/发布 | ❌ | `update-plan-tool.ts:83` 仅进度展示;无只读门控 |
| analyzer 评审风格挖掘 | `top/analyzer.py:165-207` | 学习团队评审风格 | ❌ | 无 |
| reviewer(PR 评审 agent) | `top/reviewer.py:128-180` | 独立 in-diff 纪律评审 agent | 🟡 | `mission-control/reviewer.ts:64-119` 写后自查,非 PR 评审 |

---

## 汇总:未引入能力清单(按 ROI 分级)

### 高 ROI(小改动、纯增量、无架构决策)
1. **[Codex] git merge-base 工具 + fsmonitor 保护**:`git-api.ts` 加 `merge-base` 封装;git 调用统一加 `core.fsmonitor=false` 防挂起
2. **[Open SWE] open_pull_request 三级 preflight**:`git-api.ts` prCreate 补 owner/base/head 校验 + 422 复用
3. **[Aider] auto-commit(git)**:编辑后自动提交,为 undo 提供 git 基线(需与 journal 并存策略)

### 中 ROI(模块级新增)
4. **[Aider] udiff 统一 diff 编辑**:`apply-patch` 信封之外加 `@@ hunk` 解析与应用
5. **[Aider] auto-lint 反射**:写后语法/lint 检查回喂(与 autoVerify 同链路扩展)
6. **[Open SWE] review/findings in-diff 校验**:finding 持久化 + diff 行锚点校验
7. **[Codex] exec ThreadEvent 生命周期事件**:trajectory JSONL 底座上补 file_change/collab/todo item 类型

### 低 ROI / 架构决策
8. **[Open SWE] plan_mode 门控体系**:需产品决策(计划模式 UI/审批流)
9. **[Codex] amend 规则文件持久化 / rollout_budget / token_budget 注入**:配置面与预算哲学变更
10. **[Aider] repomap PageRank / 多语言 tags**:本地 agent-map 已有等价语义,增强需 tree-sitter 多语言面
11. ~~[Cline] checkpoint 内容 diff~~(**已引入**,journal .pre 快照方案,见上表)
12. **不引入**:Codex baseline 影子 git(有意排除)、landlock/bwrap(Windows 不可移植)、invocation heredoc(机制替代)、Cline sdk-checkpoints(无 VS Code 扩展面)、Aider editor 模型格式(架构差异)
