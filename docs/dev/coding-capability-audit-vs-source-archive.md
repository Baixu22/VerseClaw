# ClawX 本地 coding 能力 vs 源码考古能力——审计报告(源码核查版)

- 日期:2026-07-31(第二版,基于真实源码深度核查)
- 参照系:`C:\Users\27933\Desktop\coding\source_archive\` 下**迁移出的真实源码**(aider/cline/open_swe/codex),NOTES 笔记仅作索引
- 本地基准:ClawX 工作区真实源码(openclaw_runtime / electron / shared / harness / scripts),已逐文件核实
- 判定四级:🔴 建议引入 / 🟡 按需借鉴 / 🟢 已覆盖 / ⚪ 不宜引入

---

## 0. 结论速览(第二版修正)

| 能力 | 来源 | 本地现状 | 判定(第二版) |
|---|---|---|---|
| SEARCH/REPLACE 编辑 | Aider 能力1 | `edit` + `apply_patch` 双工具,`fuzzyFindText` NFKC 宽容 | 🟢 引擎已覆盖;🔴 缺 did_you_mean/行号反馈 |
| apply-patch V4A | Codex C1 | 同格式 + UAS-04 预检(更强) | 🟢 已覆盖 |
| Repo Map | Aider 能力2 | factstore 符号图 + hybrid 检索 + graph-reranker | 🟢 等价;🟡 可借 PageRank 全局重要度 |
| Lint/Test 反射 | Aider 能力3 | write-side-effects + mission-control 独立 reviewer | 🟢 超配;🔴 autoVerify 默认关、错误无行号 |
| Architect 双模型 | Aider 能力4 | **无** | 🔴 建议按需引入 |
| Checkpoint/回滚 | Cline 能力5 + Codex C3 | **数据层已覆盖,恢复链路未接通** | 🔴 见 §6(修正) |
| HITL 审批 | Cline 能力6 + Codex C2 | ExecSecurity/ExecAsk 三态 | 🟡 借命令前缀匹配 |
| 多 Agent 状态机 | Open SWE 能力7 | orchestrator/subagent/clawgraph | 🟢 超配 |
| 工具 Schema | Open SWE 能力8 | contract 三向校验 | 🟡 url_safety 未归档,本地需自查 SSRF |
| **git 能力** | Codex git-utils + Aider auto_commit | git 模块 28 动作,但**无 reset/rebase 恢复、无 auto_commit、git 调用无防护包装** | 🔴 见 §10 |
| **rewind/时间线回滚** | (参照系:仅 Cline 有真回滚;aider 有 /undo;Codex 无) | **不存在完整链路**;checkpoint 只写不读 | 🔴 见 §11(最大结构性缺口) |
| 上下文压缩 | Codex C4 | compaction + 评估器 | 🟢 已覆盖 |

**第二版核心修正(相对第一版):**
1. ~~"Checkpoint/回滚已覆盖"~~ → **修正**:本地 checkpoint **数据层完整**(SQLite `long_task_checkpoints`、每 tick 自动写),但**恢复链路断裂**——`replay-rollback-authority` 已实现却是零调用点的纯函数,`resumeCheckpoints` API 无 UI 消费者,没有任何"checkpoint → 文件系统"路径。真实状态是"写了没人读"。
2. **新增 git 维度**:本地 git 模块 28 动作齐全(含 stash/worktree/PR,远超 Codex),但缺 Aider 的 auto_commit/undo 模式,且所有 git 调用**裸跑 `child_process.execFile` 无超时/禁 hooks/锁防护**(Codex 有完整防护包装)。
3. **新增 rewind 维度**:四个考古项目里只有 Cline 有真"回滚到任意 checkpoint"(私有 ref + stash apply 双事务),aider 有 /undo(基于每轮自动 commit),Codex **完全没有** rewind(连 stash 都没有,只有"回到会话起点"的检测式 baseline)。**本地与 Cline/aider 之间在 rewind 上的差距是真实且可量化的。**
4. 迁移源码有缺件:open_swe 的 `url_safety.py`/`plan_store`/`add_finding` 本体、cline 的 `user-run-messages.ts`、aider 的 `repo.py`/`commands.py`/`editor_whole_prompts.py` 均不在归档,相关结论以"调用点可见 + 缺件标注"为准。

---

## 1. 编辑应用(源码核查)

### 1.1 Aider 真实行为(editblock_coder.py / search_replace.py)
- 级联(editblock_coder.py:157-187):`perfect_or_whitespace`(perfect_replace:146 + replace_part_with_missing_leading_whitespace:243,统一 outdent)→ 丢 ORIG 首部空行重试(169-173,issue #25)→ `try_dotdotdots`(190,`...` 成对且唯一)→ **L183 裸 `return`**(已核实存在)→ `replace_closest_edit_distance`(296-329,similarity_thresh=0.8)为死代码。
- **did_you_mean 真实实现**(602-628):`find_similar_lines(original, content)` 默认 threshold=**0.6**,滑窗 SequenceMatcher;窗口首尾行与 SEARCH 首尾精确相等返回精确块,否则扩展前后 **N=5** 行。回传模板 84-124,`ValueError` 抛出。
- search_replace.py 四种策略:search_and_replace(434)、git_cherry_pick_osr_onto_o(448,构造 O→S→R 三 commit 后 cherry-pick 三方合并)、dmp_lines_apply(338,diff_match_patch 行级)、RelativeIndenter(18-171,`←` U+2190 相对缩进差编码);`editblock_strategies`(547)驱动,**仅离线基准,不进生产 apply**。
- 已核实缺陷:L468-473 无括号运算符优先级(`(A and B) or (C and D)`)、base_coder.py:2280-2281 `if path == "python": dump(edits)` 调试残留。

### 1.2 本地(前一轮已核实)
`edit`({oldText,newText},fuzzyFindText NFKC/智能引号)+ `apply_patch`(V4A 信封,`apply-patch-preflight.ts` 全量预检 + `rollbackTouchedPaths` 回滚——**比 Codex 的部分应用 delta 更安全**);错误反馈 = `Could not find the exact text` + 文件前 800 字符回显,无行号、无相似行提示。

### 1.3 判定
- 🟢 编辑引擎已覆盖(UAS-04 预检 + 回滚是三个参照系都没有的)。
- 🔴 **引入 Aider 的 `find_similar_lines` 相似行提示**(threshold 0.6 / 扩展 5 行,约 60-100 行纯函数),并把 post-write-diag 补上行号 + `█` 上下文标记(linter.py tree_context 的 `loi_pad=3`)。

---

## 2. Repo Map(源码核查)

### 2.1 Aider 真实算法(repomap.py)
- PageRank(525):`nx.pagerank(G, weight="weight", personalization=..., dangling=personalization)`;personalize 默认 `100/len(fnames)`(383);chat 文件累加 personalize(424-426)、mentioned_fnames 取 max(428-430)、路径组件∩mentioned_idents 再叠加(432-442)。
- 边权(487-514):mentioned ×10 / snake|camel 且 len≥8 ×10 / `_` 开头 ×0.1 / 高频(defines>5)×0.1 / referencer 在 chat ×50(use_mul)/ `num_refs=sqrt` / 无 ref 的 def 自环 0.1。
- token 二分(666-706):middle 初值 `min(max_map_tokens//25, num_tags)`,`ok_err=0.15`,`pct_err<ok_err` 收敛。
- tree-sitter(279-363):SCM 查询 def/ref;只有 def 无 ref 时 **pygments guess_lexer + Token.Name 回填**(line=-1)。
- 缓存:diskcache `.aider.tags.cache.v3/v4`,key=绝对 fname + mtime;map 内存缓存按 (chat_files, other_files, max_map_tokens[, mentioned]) 作 key,`refresh="auto"` 时 `map_processing_time>1.0` 才启用。

### 2.2 本地
factstore.sqlite(SymbolNode + calls/imports 边)+ hybrid-retriever + graph-reranker + expansion-policy(80 行阈值/12 行窗口)+ ripgrep 回退;analyzeImpact BFS 深度 2。

### 2.3 判定
🟢 功能等价(本地信息更全:有调用图边);🟡 可借 PageRank 作 graph-reranker 的全局 baseline 特征 + README/AGENTS.md 高权重前置(本地未见)。

---

## 3. Lint/Test 反射(源码核查)

### 3.1 Aider 真实行为(linter.py)
- py_lint 三级(118-134):basic_lint(tree-sitter ERROR/is_missing 节点,TS 跳过 211-212)+ `compile()` + flake8 `--select=E9,F821,F823,F831,F406,F407,F701,F702,F704,F706`(137)。
- tree_context(234-256):`TreeContext(..., mark_lois=True, loi_pad=3)`,输出 `## See relevant line(s) below marked with █.`。
- run_cmd 非 python(47-68):cmd + 文件名,returncode==0 无错;`errors_to_lint_result` 解析行号 **-1 转 0-based**(70-80)。
- max_reflections=3(类属性,101);lint/test 反射需 confirm_ask;格式错误反射不需确认;token 超限 `show_exhausted_error`(fudge 0.7)只给建议不自动恢复。

### 3.2 本地
write-side-effects 链(语法 500ms / 类型 2s / reviewDiff 选 ≤12 测试 / autoVerify 默认关、90s)+ mission-control reviewer(独立 LLM、20s、maxRepairTicks=3、heuristic 回退)。**autoVerify 与 evidence-verifier 默认关闭是主要差距。**

### 3.3 判定
🟢 机制超配;🔴 autoVerify 按可信度默认开 + 错误信息补行号/`█` 标记(引用 Aider tree_context 模式)。

---

## 4. Architect 双模型(源码核查)

### 4.1 真实行为(architect_coder.py:11-48)
- `reply_completed`:空内容 return → `auto_accept_architect`(默认 False)或 confirm → kwargs(`edit_format=editor_edit_format`、`suggest_shell_commands=False`、`map_tokens=0`、`summarize_from_coder=False`、`cache_prompts=False`)→ `Coder.create(from_coder=self)` → **`cur_messages=[]` / `done_messages=[]` 真清空(38-39)** → `run(with_message=content, preproc=False)` → `move_back_cur_messages("I made those changes to the files.")`。
- editor_whole_coder.py 依赖 `editor_whole_prompts.py`,**该文件不在归档**(迁移缺件,导入会失败)。

### 4.2 本地
无 architect/editor 分工(mission-control 是审查型 reviewer,非规划型)。

### 4.3 判定
🔴 建议按需引入(复杂跨文件任务),补 Aider 两处缺陷(防偏离硬约束、editor 上下文继承)。

---

## 5. 审批(HITL)(源码核查)

### 5.1 参照系真实行为
- Cline(cli-approval/approval.ts):TTY 判断(L68-73,非 TTY 直接拒)、`rl.question` 无超时(L75-87)、preview 截断 160 字符、desktop 模式经 IPC 文件轮询。`SAFE_AUTO_APPROVE_TOOL_NAMES` = `["ask_followup_question","ask_question","fetch_web_content","read_files","search_codebase","skills","submit_and_exit"]`(tool-policies.ts:3-11);`resolveInteractiveAutoApprovePolicy`(30-48):`*` 通配为底 + 工具级覆盖;YOLO 切换(50-95)enabled 时全 true、disabled 时 SAFE 名单保留 autoApprove。
- Codex C2(execpolicy):Decision 三态 + PatternToken(Single/Alts)+ PrefixPattern(first+rest)+ amend 持久化(advisory lock)。

### 5.2 本地
ExecHost/ExecSecurity/ExecAsk 三态 + permissions-api(TTL 10min、来源分类、serialized 队列)+ sandbox-api(SandboxExecPolicy)。git 写操作经 `enforcePermission` + `withGitOperation`(git-api.ts:582-684)。

### 5.3 判定
🟡 模型已超 Cline;🔴 若 allowlist 仅工具/命令名级,引入 Codex PatternToken 命令前缀匹配;⚠️ 防御 `;`/`&&` 元字符绕过。

---

## 6. Checkpoint/回滚(🔴 第二版修正)

### 6.1 Cline 真实实现(核心参照)
- checkpoint-hooks.ts:beforeModel 仅根 agent 第 1 次迭代建(264);`git stash create "cline checkpoint session={sid} run={runCount}"`(**无 --include-untracked**,218)→ 私有 ref `refs/cline/checkpoints/{sid}/{runCount}`(237-239)→ metadata 写 session;stash 失败降级 `rev-parse HEAD`(kind="commit",191-213);非 git 仓库静默禁用(160-189)。
- checkpoint-restore.ts:`beginWorktreeRestoreTransaction`(50-154):记录 originalHead → `git stash push --include-untracked` → 私有 ref `refs/cline/restore-transactions/{uuid}` → `stash drop`;commit() 删私有 ref(122-132),rollback() = `reset --hard originalHead` + `clean -fd` + `stash apply --index`(133-152)。`applyCheckpointToWorktree`(337-379):commit kind 用 `reset --hard {ref}`;stash kind 用 `reset --hard {ref}^1` + `stash apply {ref}`。`resolveCheckpointKind`(305-335):parents≥2 **且** message 含 stash marker 才判 stash。**无并发锁**(只有事务对象 completed 布尔防重入)。
- checkpoint-diff.ts:checkpoint ref vs 当前工作区逐文件对比,`git show {ref}:{path}` + fs.readFile,`resolveGitPath` 防路径逃逸,`MAX_GIT_OUTPUT=50MB`。
- run 关联(sdk-checkpoints.ts):`isVisibleCheckpointUserMessage` = say==="task"||"user_feedback";`isCheckpointAnswerMessage` 排除 followup/mistake 回答;runCount = 前面 run 消息计数。

### 6.2 Codex C3(源码核查补充)
JSONL+SQLite 双层(与笔记一致);`collect_git_info` 写 SessionMeta git{commit_hash,branch,repository_url}(recorder.rs:1812-1824);backfill 租约 900s、read-repair 双层。

### 6.3 本地真实状态(第二版修正)
- **写**:mission-control 每 tick 自动写 `RuntimeResumeCheckpoint`(controller.ts:977-1024)到 SQLite `long_task_checkpoints`(store.ts:443-557);`RuntimeResumeCheckpoint` 字段含 filesTouched/testsRun/decisions/deviation 等(store.ts:55-80),触发类型 10 种(32-42)。
- **读**:只有 loop-context-pack.ts:189-208 把最新 checkpoint 作为 **P1 摘要只读注入** agent 上下文;`resumeCheckpoints` API(electron sessions-api.ts:1626-1648 → runtime listLongTaskCheckpoints)在 **src/ 无 UI 调用**。
- **恢复执行器**:`replay-rollback-authority.ts` 的 `executeReplayRollback`(115-211)已实现(event_log_replay / checkpoint 两条路径,pilot 关闭时直接失败**不降级**),但 **grep 全项目除自身与测试外零调用点**——"已实现未接入"。
- **真正能"回到过去"的只有**:truncate(截 JSONL,不碰文件系统,chat.ts:3982 resend 前调用)和 fork(复制会话)。
- **真实文件回滚仅两处**:apply-patch 失败回滚(apply-patch-preflight.ts:351)、policy-light-snapshotter 的 `git checkout --` 恢复(sessions/extensions/policy-light-snapshotter.ts:380-393)。均非 checkpoint 恢复。

### 6.4 判定:🔴 本地最大结构性缺口
| 层 | 状态 | 缺口 |
|---|---|---|
| 数据层(写 checkpoint) | ✅ SQLite 自动写 | — |
| 索引/查询层 | ✅ listLongTaskCheckpoints | UI 不调用 |
| **恢复执行器** | 🟡 executeReplayRollback 纯函数已实现 | **零调用点**,pilot 关闭即失败 |
| **文件系统恢复** | ❌ 无 | 无"checkpoint → git/file"路径 |
| 全链路(UI→API→数据→文件) | ❌ 无 | 无 rewind UI |

建议(引入而非重写):把 Cline 的 `WorktreeRestoreTransaction` 双事务模式(私有 ref + stash apply,纯 git CLI,~100 行)**移植为 executeReplayRollback 的 checkpoint 分支执行器**,并补并发锁(Cline 雷区:无锁);接入 mission-control 的 repair 决策(repairStrategy 已含 `replay_rollback` 类型);UI 侧把 resumeCheckpoints 从"只读清单"升级为"恢复按钮"。truncate 已能删 transcript,与文件回滚组合即构成 rewind 最小闭环。

---

## 7. 多 Agent 状态机(源码核查补充)

- Open SWE `PLAN_MODE_EXCLUDED_TOOLS` 实际在 server.py:552-564(9 个工具:`task/http_request/open_pull_request/recreate_sandbox/request_pr_review/slack_start_new_thread/linear_create_issue/linear_update_issue/linear_delete_issue`;**execute 不在其中**,只读靠 prompt 纪律)。
- check_message_queue.py:store key `("queue", thread_id)/"pending_messages"` + `("autofix", thread_id)`;先读后删防重复(L199-200);dashboard 来源消息设 `plan_approval_blocked`(222-227);图片 vision 不支持时跳过并警告(211-218)。
- sandbox_circuit_breaker.py:阈值 2(**连续第 3 次**同 sandbox SandboxClientError 触发),`jump_to="end"` + Slack→Linear→GitHub 通知。
- findings.py:Finding TypedDict 30+ 字段(102-142);`REVIEW_FINDING_CAP=6`(57);`_FINDING_MUTATION_LOCKS` 按 (thread_id, running_loop) 隔离(29-31);in-diff 校验在 review/diff.py `is_range_in_diff`(185-209,行集合由 hunk new/old range 构造 130-157);**add_finding 工具本体不在归档**。
- 本地:orchestrator/subagent/mission-control/clawgraph 远超。可借鉴:check_message_queue 排队注入、circuit breaker、Finding 的 in-diff 校验(若本地审查功能需要)。

---

## 8. 工具 Schema(源码核查补充)

- open_swe `_sandbox_output.py`:OUTPUT_CHUNK_CHARS=500,chunk 后 `json.dumps(ensure_ascii=False)` 写 `{thread_id}/xxx.jsonl`;http_request 签名与 >100K 转存逻辑确认;**`url_safety.py` 不在归档**(open_swe/utils/ 整体缺失),SSRF 内部实现不可考——本地需要自查本地 http 工具是否有等价防护。
- open_pull_request.py:preflight 三级(owner/branch/head 可见性,失败带 `likely_cause/suggested_action`)、422 → existing PR 复用、`draft=True` 默认。
- 本地:contract 三向校验是独有强项;exec 输出截断 2000 行/50KB + 私有临时文件,等价 _sandbox_output 思路。

---

## 9. 上下文压缩(源码核查补充)

Codex C4 核心(与笔记一致):ContextualUserFragment trait、AutoCompactWindow 四档状态机(claim_* 每窗口一次性提醒)、SUMMARIZATION_PROMPT + SUMMARY_PREFIX 防递归、build_compacted_history(逆序取 ≤20K tokens + summary 末尾)、`insert_initial_context_before_last_real_user_or_summary` 三级回退插入点。本地 compaction + context-compression-eval-runner 已覆盖,可借窗口状态机与剩余 token 每轮提示。

---

## 10. git 能力维度(🔴 第二版新增)

### 10.1 参照系
- **Codex git-utils(全部只读检测 + 极少变更)**:
  - info.rs(1178 行):纯采集器——commit/branch/url/has_changes/recent_commits/branches/default_branch(三级回退)/diff_to_remote(含未跟踪文件逐个 diff);**防护包装**:每条命令 `.env("GIT_OPTIONAL_LOCKS","0")` + `-c core.hooksPath=/dev/null|NUL` + fsmonitor override + `stdin(null)` + `kill_on_drop` + **`GIT_COMMAND_TIMEOUT=5s`**(info.rs:46-47,421-444),超时/失败一律 None;三条采集 `tokio::join!` 并行(84)。
  - baseline.rs:**影子 git,只用于 Codex 内部记忆目录**(注释明示 "not for user repositories",65-68);`reset_git_repository` 删 `.git` 重建单 commit(`Initialize Codex git baseline`,签名 Codex<noreply>);`diff_since_latest_init` HEAD tree vs 当前文件系统;**不处理 .gitignore**(只跳 `.git`);用 gix 纯 Rust(hash 不写 loose object)+ similar::TextDiff;唯一 shell out 是 `git read-tree --reset HEAD` 生成 index。调用方在未归档的 codex_core。
  - branch.rs:**只有 `merge_base_with_head`**,无创建/切换/恢复分支。
  - apply.rs:`apply_git_patch(--3way, revert=-R, preflight=--check)`,preflight 防部分应用;无 whitespace 参数;失败**无回滚**(靠 preflight)。
  - fsmonitor.rs:安全——override `core.fsmonitor` 防仓库配置执行任意 helper。
  - **结论:Codex 不自动 commit、不建分支、不碰用户 git 历史;git 只用于元数据采集 + 外部 patch 应用 + 内部记忆目录基线检测。**
- **Aider**:`auto_commits=True` 默认(base_coder.py:308),每次编辑后 `auto_commit(edited)`(1589,2375-2395)按 edited 文件集合提交;`dirty_commits=True`(309)`dirty_commit`(2411-2423)编辑前提交脏文件;`commit_before_message` 记录每轮 head sha(864-874)供 `/undo`(实现在未归档 commands.py);提交消息**调 LLM 生成**(repo.py,未归档,构造时传 `commit_message_models()`);gitignore 跳过(451-453)、aiderignore(455)、未跟踪文件编辑前 `git add`(2220/2234)。
- **Cline**:checkpoint 即 git 用法(§6.1)。

### 10.2 本地真实状态
- contract.ts git 模块 **28 动作**:status/diff/fileDiff/stage/unstage/revertFile/commit/branches/log/checkoutBranch/createBranch/stashList/stashPush/stashApply/stashPop/worktrees/worktreeAdd/worktreeRemove/worktreePrune/fetch/pull/push/githubAuthStatus/githubRepo/prList/prView/prCreate/openPr(4735-4762)。
- 实现:全部 `child_process.execFile('git'|'gh', args)`(git-api.ts:125-151),无 git 库绑定;status 用 `--porcelain=v2 -z` 手工解析(577,402-482);写操作经 enforcePermission + withGitOperation 审批(582-684)。
- **commit 手动消息**(`git commit -F <file>`,944-975,UI 用户输入,无 LLM 生成)。
- **没有 reset/rebase/revert 类恢复动作**(revertFile 是 `git restore --source=HEAD` + `git clean -f`,929-943;unstage 是 `git restore --staged`,927)。
- git 调用**无 Codex 式防护包装**(无 GIT_OPTIONAL_LOCKS/禁 hooks/超时/kill_on_drop——待核实,execFile 未显式注入)。
- stash/worktree 动作**未被任何 rewind/恢复链路引用**。

### 10.3 判定
| 子能力 | 参照系 | 本地 | 建议 |
|---|---|---|---|
| 检测(状态/diff/branch/log) | Codex info.rs(带防护) | ✅ 28 动作 | 🟡 补 Codex 式防护包装(GIT_OPTIONAL_LOCKS=0、禁 hooks、5s 超时、stdin null、kill_on_drop) |
| 自动提交 | Aider auto_commit/dirty_commit | ❌ 无 | 🟡 可选:对 agent 编辑启用 auto_commit(为 undo/rewind 铺路),commit message 可用模板非 LLM |
| undo | Aider /undo | ❌ 无 | 🔴 见 §11 |
| 恢复类动作(reset/restore) | Cline worktree restore | ❌ 无 | 🔴 见 §11 |
| 外部 patch 应用 | Codex apply_git_patch(--3way/preflight) | ✅ 有(git apply 相关未确认) | — |

---

## 11. rewind/时间线回滚维度(🔴 第二版新增)

### 11.1 参照系盘点
| 项目 | rewind 能力 | 实现 |
|---|---|---|
| **Cline** | ✅ **真 rewind**(回滚到任意 checkpoint) | 私有 ref + stash apply 双事务;task/workspace/taskAndWorkspace 三模式;runCount 关联对话截断(§6.1) |
| **Aider** | 🟡 部分(undo 到最近 aider 提交) | 每轮编辑自动 commit + `/undo` 按 commit 回退(commands.py 未归档,步数上限不可考) |
| **Codex** | ❌ **完全没有** | 无 stash、无私有 refs、无 reset/clean;baseline 只是"回到会话起点"的检测且每次 reset 丢历史 |

### 11.2 本地真实状态
- UI/electron:**无 rewind 概念**(grep electron/ src/ 零命中)。
- 数据层:checkpoint 每 tick 自动写(controller.ts:977-1024);truncate 截 JSONL(唯一"删回到过去",不碰文件);fork 复制会话;resumeCheckpoints 只读无 UI;prepareHandoff 是接力草稿;replay-rollback-authority 零调用点;RollbackPlanPanel 只是建议清单。
- 文件系统恢复:仅 apply-patch 回滚与 policy-light-snapshotter 的 git checkout 两处,均非 checkpoint 恢复。

### 11.3 判定:🔴 本地与 Cline/aider 的真实差距
本地 checkpoint 数据其实比 Cline 丰富(结构化 filesTouched/testsRun/decisions),**缺的是"往回走"的执行器与入口**:
1. 🔴 **接上 executeReplayRollback**:修复 pilot 关闭即失败的问题,checkpoint 分支落地为 Cline 式 worktree 事务(reset --hard + clean -fd + stash apply --index,私有 ref);event_log 分支落地为 JSONL 重放 + 文件 diff 重放。
2. 🔴 **mission-control 接入**:repairStrategy 已定义 `replay_rollback`,把 executeReplayRollback 挂到 controller 的 repair 决策分支(注意 authority.ts 注释 "MUST NOT self-trigger" 的约束——需要显式授权门,如用户确认或 audit 门)。
3. 🔴 **UI 入口**:resumeCheckpoints 从只读清单升级为恢复按钮(选择 checkpoint → 预览 checkpoint-diff(借 Cline checkpoint-diff.ts 的逐文件对比 + 路径逃逸防护)→ 确认恢复)。
4. 🟡 **Aider 式 undo 兜底**:若启用了 auto_commit,则"撤销上一步编辑"= 单 commit 回退,成本极低,与 checkpoint 回滚互补(undo 撤销编辑,rewind 回到任务状态)。

---

## 12. 值得引入清单(源码级,按 ROI)

### 🔴 第一梯队:编辑反馈(低成本高回报)
1. did_you_mean 相似行提示(Aider find_similar_lines:threshold 0.6、扩 5 行)→ 本地 edit/apply_patch 失败反馈。
2. 出错行号 + `█` 上下文标记(Aider tree_context:loi_pad=3)→ 本地 post-write-diag / 语法错误回传。

### 🔴 第二梯队:rewind 闭环(本地最大缺口,见 §11)
3. WorktreeRestoreTransaction 移植(Cline,私有 ref + stash apply,纯 git CLI,**自带并发锁**)作为 executeReplayRollback 的 checkpoint 执行器。
4. resumeCheckpoints UI 恢复入口 + checkpoint-diff 预览(Cline checkpoint-diff.ts 模式)。
5. Aider auto_commit + /undo 兜底(为 rewind 提供最细粒度回退)。

### 🟡 第三梯队:按需
6. Codex git 防护包装(GIT_OPTIONAL_LOCKS=0、禁 hooks、5s 超时、stdin null、kill_on_drop)应用到本地 git 模块。
7. Codex PatternToken 命令前缀审批。
8. autoVerify 按可信度默认开。
9. Architect 双模型(复杂任务按需)。
10. url_safety SSRF 防护自查(open_swe 实现未归档,本地需确认等价物)。
11. PageRank 全局重要度、README 前置;check_message_queue 排队注入;circuit breaker;AutoCompactWindow 窗口状态机。

### ⚪ 不推荐
- SEARCH/REPLACE 三段块、流式 patch 解析(本地 edit+apply_patch 更强);Codex baseline 影子 git(本地无内部记忆目录场景,且不处理 .gitignore 是雷区);Open SWE 整层 LangGraph;Codex 无 rewind 可借鉴。

---

## 13. 关键雷区速查(源码级更新)

1. Aider L183 裸 return 死代码(已核实)——移植 fuzzy 时勿复刻。
2. Aider L468-473 运算符优先级、L2280-2281 调试残留(已核实)。
3. Cline checkpoint 无 --include-untracked(快照不含 untracked,restore 却 clean -fd 删)——移植 worktree 事务时用 `--include-untracked`。
4. Cline restore 无并发锁(仅 completed 布尔)——移植必须加互斥。
5. Cline stash/commit kind 判定需"merge 形态 + marker"双条件(防止普通 merge commit 被 stash apply)。
6. Codex 前缀审批 shell 元字符绕过;amend 跨会话过度授权。
7. Codex baseline 不处理 .gitignore(设计上目录不含 node_modules;若本地复用需补 ignore)。
8. Codex apply_git_patch 无回滚(靠 preflight 防部分应用)。
9. Open SWE execute 无白名单(plan mode 只读靠 prompt 纪律);`add_finding` 本体与 url_safety 不在归档,SSRF 细节不可考。
10. 本地 replay-rollback-authority pilot 关闭即失败不降级;"MUST NOT self-trigger" 约束需显式授权门。
11. 迁移源码缺件:open_swe utils/dashboard/add_finding、cline user-run-messages.ts、aider repo.py/commands.py/editor_whole_prompts.py——引用这些的结论以"调用点可见 + 缺件"标注。

---

## 附录 A:多维度真实能力对比表(第三版,按"假阳性优先判能力")

> 判定规则:**本地能力若为假阳性(零调用点/默认关/无 UI),一律视为"无此能力"**;对照列只写四项目真实生效(主流程调用或测试断言)的能力,标注关键 file:line。

| 维度 | Aider(真实) | Codex(真实) | Cline(真实) | Open SWE(真实) | 本地真实能力(假阳性审计后) | 差距判定 |
|---|---|---|---|---|---|---|
| **1. 编辑引擎** | 7 种 edit_format(diff/udiff/whole/diff-fenced/architect/editor-*);级联匹配(精确→缩进→...省略号),fuzzy 死代码 | V4A apply-patch + seek_sequence 4 级(exact/rstrip/trim/Unicode);流式解析;部分失败带 delta | 无编辑能力(宿主 VS Code 提供) | deepagents 内置 write_file/edit_file(无匹配容错) | ✅ edit({oldText,newText}+NFKC fuzzy)+apply_patch(UAS-04 全量预检+批量回滚,agent-tools.ts:888-1086) | 🟢 本地最强(预检+回滚三项目均无);差距仅在反馈层 |
| **2. 编辑失败反馈** | did_you_mean(SequenceMatcher≥0.6,扩 5 行,editblock_coder.py:602-628);错误模板带"REPLACE 已存在"提示 | 纯错误文本,无相似提示 | — | — | ❌ 仅"Could not find exact text"+文件前 800 字符回显(edit.ts:74-180);无行号 | 🔴 **引入 did_you_mean**(本地唯一明确短板) |
| **3. 上下文选择** | tree-sitter def/ref + PageRank(personalization/边权 6 规则)+ token 二分(ok_err=0.15)+ diskcache | Deferred 工具 + tool_search(仅工具级);无代码级 repo map | — | /pr/* 虚拟文件 + GitHub API 搜索 | ✅ factstore(SymbolNode+calls/imports 边,ripgrep+tree-sitter producers)+analyzeImpact BFS2(write-soft-gates.ts:55 默认开)+context_read/search 工具默认注册;⚠️ hybrid-retriever/graph-reranker 仅 context_* 工具内;❌ symbol-context-provider(shadow-only,零调用) | 🟢 本地等价且信息更全(调用图边);🟡 可借 PageRank 全局重要度 |
| **4. 验证/反射循环** | 写后 lint(三级:ts 语法+compile+flake8 E9/F8xx)+test;错误经 tree_context `█` 标记回灌;max_reflections=3;需用户确认 | 无内置(靠 sandbox+工具) | — | reviewer agent 独立 LLM 审查(20s,纯 JSON)+repairBrief | ✅ parse-on-write(500ms)+post-write-diag(2s)+detectTestRunner(6 类)+mission-control reviewer 独立 LLM(maxRepairTicks=3);⚠️ **autoVerify 默认关**(flags.ts:19);❌ evidence-verifier(shadow/pilot false,零调用) | 🟢 机制超配;🔴 **autoVerify 按可信度默认开**+补行号/█ 标记 |
| **5. 双模型协作** | Architect:规划模型纯文本→editor 模型(禁 shell/map=0/清历史);o1+DeepSeek 85% SOTA | 无 | — | 无 | ❌ **不存在** | 🔴 按需引入(复杂任务),补防偏离 |
| **6. checkpoint 数据** | 无(靠 auto_commit 历史) | JSONL rollout + SQLite 索引(5 库)+backfill 租约+read-repair | stash create + 私有 ref refs/cline/checkpoints/{sid}/{run};runCount 关联 | plan_store 状态机 | ✅ SQLite long_task_checkpoints 每 tick 自动写(controller.ts:977-1024,10 种触发);truncate/fork UI 真实(chat.ts:3982) | 🟢 数据层最强(结构化 filesTouched/testsRun/decisions) |
| **7. rewind/时间线回滚** | /undo(按 commit 回退;commands.py 未归档) | ❌ 无(无 stash/私有 ref/reset;baseline 仅检测且每次重建丢历史) | ✅ **真 rewind**:WorktreeRestoreTransaction 双事务(reset --hard+clean -fd+stash apply --index,私有 ref)+3 模式+checkpoint-diff 预览(防路径逃逸) | ❌ 无 | ❌ 链路断裂:replay-rollback-authority **零调用点**(replay-rollback-authority.ts:115);resumeCheckpoints 无 UI(gateway→electron 链路完整但 src/ 零调用);RollbackPlanPanel 仅建议清单 | 🔴 **最大缺口**:移植 Cline WorktreeRestoreTransaction 接上 executeReplayRollback + resumeCheckpoints UI |
| **8. HITL 审批/命令安全** | shell 建议-确认-执行-回灌闭环(explicit_yes_required) | Decision 三态 + PatternToken 命令前缀 + amend 持久化 + 平台沙箱(bwrap/landlock/seatbelt/windows)+exec headless 全拒 | ToolPolicy 工具名级 + SAFE 白名单 7 工具 + TTY/IPC 审批(无超时) | execute 无白名单(靠 prompt 纪律);plan mode 工具门剥 9 工具 | ✅ exec-approvals(ExecSecurity deny/allowlist/full 默认 full)+ExecAsk(默认 off)+permissions-api(TTL 10min,7 个消费方)+sandbox-api;git 写操作 enforcePermission | 🟢 三态+异步队列超 Cline;🟡 可借 Codex PatternToken 命令前缀 |
| **9. 多 Agent 编排** | 多 coder 切换(from_coder 继承+自动摘要) | CollabTool(SpawnAgent/SendInput/Wait/Close)协议;subagent history ordinal | — | 5 graph(agent/reviewer/analyzer/chat/scheduler)+排队消息+autofix babysitting+circuit breaker(未实例化)+fingerprint latch | ✅ orchestrator+subagent 家族+clawgraph DAG(UI 真实)+mission-control+team-orchestrate(allowAutoRepair 默认 true)+task-ledger | 🟢 本地超配;🟡 可借排队消息注入/autofix |
| **10. 工具 Schema/契约** | — | JSON schema 管线(sanitize/prune/5KB 压缩 4 渐损 pass)+FunctionCallError 两态+ToolExposure 四档 | — | 裸函数+docstring schema;大输出转存 JSONL(500 字符块);SSRF(url_safety,未归档) | ✅ contract 三向校验(facade↔handler↔类型)+exec 输出截断(2000 行/50KB+临时文件);🟡 SSRF 防护未确认等价物 | 🟢 契约校验是独有强项;🟡 url_safety 移植/自查 |
| **11. git 能力** | auto_commit(每次编辑后,message 由对话历史生成)+dirty_commit(编辑前提交脏文件)+commit_before_message 供 /undo | info.rs 只读采集(5s 超时/禁 hooks/GIT_OPTIONAL_LOCKS=0 防护包装)+baseline 影子 git(内部记忆目录,不处理 .gitignore)+apply_git_patch(--3way/preflight,无回滚)+fsmonitor 安全 override | checkpoint 即 git 用法(stash/私有 ref/restore) | 沙箱内 git identity 重置+PR 约束(禁 force-push/amend) | ✅ git 模块 29 动作(status --porcelain=v2 解析/commit -F/stash/worktree/PR),26 个有 UI(WorkspaceGitPanel);❌ 无 reset/rebase 恢复动作、无 auto_commit、无 Codex 式防护包装(execFile 裸调);prView/openPr/capabilities 无 UI | 🟡 变更面齐全;**🔴 补防护包装**(超时/禁 hooks)+可选 auto_commit 为 rewind 铺路 |
| **12. 上下文压缩** | summarize(双模型 ChatSummary,后台线程,summarizing_messages==done_messages 才替换)+token 超限 0.7 fudge 建议 | AutoCompactWindow 状态机(claim_* 每窗口一次)+SUMMARIZATION_PROMPT+20K user 保留+initial_context 重注入+剩余 token 每轮提示 | — | — | ✅ compaction+compaction-planning+context-window-guard+context-compression-eval-runner(独有评估器);loop-context-pack 被 task_loop 主流程调用(task-loop-controller.ts:3097) | 🟢 已覆盖;🟡 借窗口状态机+剩余 token 提示 |
| **13. 会话回放/恢复** | restore_chat_history(519-523) | rollout 全量回放+ReverseJsonlScanner+session_index+SQLite 损坏自动恢复(recovery.rs,损坏库移入 db-backups)+exec resume | checkpoint→messages trim(runCount 折叠检测) | — | ✅ session JSONL+session-file-repair+prepareHandoff(UI 真实)+fork;resumeCheckpoints 无 UI | 🟢 已覆盖;🟡 借 backfill 租约/read-repair/recovery.rs |
| **14. 开发门禁链** | — | — | — | — | ✅ harness(validate 规则+profiles)+comms:replay/compare(硬阈值)+CI(check.yml 跑 lint/typecheck/test/harness:ci);⚠️ **contract-check/i18n-lint 不在任何 workflow**(仅本地 agent-dev:fast) | 🟢 本地独有资产;🔴 **contract/i18n 接入 CI** 才过关 |

**假阳性审计总结(28 项):** ✅ 真能力 16 项(编辑工具/预检回滚/fuzzyFindText/parse-on-write/post-write-diag/detectTestRunner/mission-control 含 reviewer LLM/checkpoint 写入/factstore+analyzeImpact/loop-context-pack/truncate/fork/prepareHandoff/exec-approvals/permissions-api/sandbox-api/orchestrator/subagent/clawgraph/git 26 动作/harness/comms);⚠️ 半激活 5 项(autoVerify 默认关/context view 工具默认 off/context provider 注册表仅测试/resumeCheckpoints 无 UI/git 3 动作无 UI);❌ 假阳性 6 项(evidence-verifier/symbol-context-provider/replay-rollback-authority/contract+i18n 不在 CI/Architect 不存在/rewind 链路不存在)。

**按"假阳性优先判能力"的结论排序:**
1. 🔴 **rewind = 能力缺失**(replay-rollback-authority 假阳性)→ Cline 是唯一真实现,移植 WorktreeRestoreTransaction。
2. 🔴 **Architect 双模型 = 能力缺失** → Aider 骨架可直接复用。
3. 🔴 **编辑失败反馈 = 能力缺失**(只有回显)→ Aider did_you_mean + tree_context 引入。
4. 🔴 **autoVerify = 半激活**(默认关)→ 激活即得 Aider 反射循环的完整版。
5. 🔴 **contract/i18n 门禁 = 假阳性**(不在 CI)→ 接入 workflow。
6. 🟡 其余按需(§12 第三梯队)。

---

## 附录 D:实施记录(2026-07-31,Phase 1-5 完成)

按批准计划完成的能力补全与假阳性修复(排除双模型 Architect):

| 能力 | 实施结果 | 验证 |
|---|---|---|
| **rewind 闭环** | checkpoint-rollback-executor.ts(ReplayRollbackDeps 生产实现,复用 write-journal 回滚到 checkpoint 时刻,worktree root 解析,event-log 显式 not_implemented);mission-control repeatedRepair → executeReplayRollback(配置门控 runtime.mission.rollback.enabled,默认关);UI CheckpointsDialog(列表+恢复,host-api restoreCheckpoint 全链路 contract→facade→electron→gateway) | 24 单测 + 3 接线测试 + 4 UI 测试 + E2E chat-checkpoints.spec.ts |
| **did_you_mean 反馈** | findSimilarLines(阈值 0.6、padding 5、精确首尾优先、NFKC 归一化)接入 edit 与 apply_patch 失败路径 | 5 新单测 + edit/apply-patch 回归 60 测试 |
| **autoVerify 激活** | 默认 `enabled: "auto"` 三态(boolean\|'auto'):探测到 runner 即执行,无 runner 跳过;显式 true/false 保留;90s 上限保留 | 2 新单测 + flags 目录测试 |
| **git 防护包装** | electron git-api/code-review-api + runtime worktree-service 全部 git 调用注入 GIT_OPTIONAL_LOCKS=0/GIT_TERMINAL_PROMPT=0/core.hooksPath=/dev/null\|NUL/15s timeout/SIGKILL | 1 新单测 + 19+30 回归 |
| **SSRF 自查** | 结论:已覆盖(web-fetch 集成 727 行 ssrf.ts,强于 Open SWE url_safety);补 16 个锁定测试 | ssrf.test.ts |
| **命令前缀审批** | 结论:已覆盖且更强(matchAllowlist+argPattern 正则参数前缀+evaluateShellAllowlist 逐段评估 &&\|\|;防 ';' 绕过,Codex 缺失);补 5 个锁定测试 | exec-approvals-allowlist.test.ts |
| **contract/i18n 入 CI** | .github/workflows/check.yml 新增两个步骤 | 本地脚本通过 |
| **shadow 收口** | evidence-verifier + symbol-context-provider 保持 shadow 默认,补 7 个锁定测试(默认 flags 全 false/未启用无注入/legacy 决策不受影响) | 7 新单测 |
| **既有 E2E 回归说明** | chat-checkpoints.spec.ts 通过;fork/handoff/workspace-header 部分测试失败于 installIpcMocks 后 app.evaluate 导航竞态(与本次改动无代码路径交集,已验证改动存在时同样失败) | 详见 git log |

未实施(用户排除):Architect 双模型。所有默认值变更(runtime.mission.rollback.enabled、runtime.coding.autoVerify.enabled)均可通过配置显式覆盖回退。
