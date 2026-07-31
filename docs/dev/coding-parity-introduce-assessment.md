# 未引入能力引入合理性评估(避免过度设计)

> 评估对象:`docs/dev/coding-parity-gap-inventory.md` 盘点的全部未引入/部分对齐能力。
> 评估原则(用户要求):① 避免过度设计——本地已有等价/替代机制的不重复引入;② 功能全面——填补真实功能缺口;③ 可视化优先——用户可见/UI 可展示的能力权重更高;④ 不复杂化——引入成本与收益匹配。
> 新增核实事实(2026-07-31):本地 `code-review-api.ts` + `shared/types/code-review.ts` **已引入 findings 体系**(CodeReviewFinding: file/line/severity/reason/suggestedFix, `parseCodeReviewFindings(text, changedFiles)` 按 changedFiles 过滤);`write-side-effects.ts:293-381` 已有 `syntaxCheck/diagEnabled` 写后语法/诊断检查;`git-api.ts` 无 merge-base。

## 实施状态(2026-08-01,已落地 5 项)

| 项 | 状态 | 落地证据 |
|---|---|---|
| Codex fsmonitor 保护 | ✅ 已引入 | `git-api.ts` execBinary + `worktree-service.ts` hardenedGitEnv 注入 `core.fsmonitor=false`(GIT_CONFIG_COUNT=2);git-api.test.ts hardened 用例断言 |
| Codex git merge-base | ✅ 已引入 | `git-api.ts` mergeBase 公共方法(isSafeGitRef 校验)+ contract GitMergeBasePayload/Result + host-api facade;code-review collectBaseBranchDiff 既有接入;git-api.test.ts 2 用例 |
| Open SWE PR 422 复用 + preflight | ✅ 已引入 | `git-api.ts` prCreate base/head 分支存在性 preflight(likely_cause/suggested_action)+ `gh pr list` 重复 PR 复用(reused:true);contract GithubPrCreateResult.reused;git-api.test.ts 2 用例 |
| Cline checkpoint 内容 diff | ✅ 已引入(可视化 P0) | `openclaw_runtime/src/agents/checkpoint-diff.ts`(journal .pre 快照对比,非 git)+ gateway `sessions.checkpointDiff` + electron 转发 + contract + host-api;`CheckpointsDialog.tsx` 展开面板(文件状态 + unified diff);4 语言 i18n;数据层 5 + UI 2 用例 |
| findings in-diff 行区间校验 | ✅ 已引入(小增强) | `code-review-api.ts` `validateFindingsInDiff`(hunk 行集合校验,不在区间降级 info + [not in diff]);code-review-center.test.ts 3 用例 |
| Aider udiff 统一 diff 输入 | ⏸ 未引入(用户确认排除) | 保持条件性:等真实"用户粘贴 unified diff"场景出现再评估 |

---

---

## 结论速览

| 决策 | 能力 | 理由(一句话) |
|---|---|---|
| ✅ **建议引入(4)** | Codex fsmonitor 保护 | 纯安全加固,零功能面,一行配置防大仓库 git 挂起 |
| ✅ **建议引入(4)** | Codex git merge-base | 小工具,支撑 code-review 的 `baseBranch` 目标精确对比 |
| ✅ **建议引入(4)** | Open SWE PR 422 复用 + 三级 preflight | prCreate 健壮性增量,复用已有 `gh pr create`,不新建机制 |
| ✅ **建议引入(4)** | Cline checkpoint 内容 diff | 高可视化(回滚前看"这个 checkpoint 改了什么"),可基于 journal `.pre` 快照实现,无需 git |
| 🔶 **小增强(2)** | findings in-diff 行区间校验 | findings 体系已引入,仅补"行号必须落在 diff hunk 内"的严格校验 |
| 🔶 **小增强(2)** | udiff 统一 diff 输入 | 可选;作为 apply_patch 的第三种输入格式,复用现有 preflight/回滚链 |
| ⛔ **不引入(其余)** | 见 §3 | 机制替代/已对齐/过度设计 |

---

## 1. 建议引入(低成本、高价值、不复杂化)

### 1.1 Codex fsmonitor 保护(git-utils/info.rs 配套)
- 参照:`codex/git-utils/info.rs:433` `-c core.fsmonitor=false` 覆盖仓库配置。
- 本地现状:`git-api.ts:137-173` 已注入 GIT_OPTIONAL_LOCKS/hooksPath/15s timeout,未处理 fsmonitor;大仓库 `core.fsmonitor` 的第三方 helper 可能挂起或拖慢。
- 判断:**引入**。纯安全/健壮性加固,一行 env(`-c core.fsmonitor=false` 或 GIT_CONFIG_*)插入现有 execBinary/worktree git() 的 env 集,零功能面、零测试面新增(复用 hook 防护测试模式),直接降低真实挂起风险。

### 1.2 Codex git merge-base 工具
- 参照:`codex/git-utils/branch.rs`/`operations.rs`(merge_base 计算)。
- 本地现状:`git-api.ts` 无 merge-base;但 `shared/types/code-review.ts` 的 `CodeReviewTarget { kind: 'baseBranch' }` 需要"分支分叉点"做 diff 基线(当前大概率用 rev-parse+log 近似)。
- 判断:**引入**。低成本(execBinary 封装 `git merge-base`,复用全部防护),直接提升 code-review 的 baseBranch 对比精度,是 PR/分支可视化(用户诉求)的底层支撑。

### 1.3 Open SWE open_pull_request 422 复用 + 三级 preflight
- 参照:`open_swe/tools/open_pull_request.py:748-791`(owner/base/head preflight + 422→复用 existing PR + draft)。
- 本地现状:`git-api.ts:1264-1292` prCreate(`gh pr create`+draft+enforcePermission),无 preflight、重复开 PR 时直接报错。
- 判断:**引入**。复用现有 prCreate 内部,加 ① 重复 PR 检测(gh pr list 匹配→复用)② 错误信息带 likely_cause/suggested_action。不新建机制,纯健壮性+错误体验增量。

### 1.4 Cline checkpoint 内容 diff(最高可视化价值)
- 参照:`cline/core-session/checkpoint-diff.ts:121-140`(checkpoint vs 工作区逐文件左右对比)。
- 本地现状:checkpoint 对话框存在(`tests/unit/checkpoints-dialog.test.tsx`),但只有列表无内容 diff;checkpoint 无 git 快照;但 **write-journal 的 `.pre` 快照保存了每次写入前的内容**(write-journal.ts:370-382)。
- 判断:**引入(改造成本可控)**。实现路径:checkpoint 的 `metadata.journalSeq` 已能定位"该时刻之前的 journal 条目",用各条目 `.pre` 快照对比当前文件内容即可生成 diff(与 `applyCheckpointToJournal` 同源数据,不需要 git)。直接满足"可视化"——用户在回滚前看到该 checkpoint 将撤销哪些文件的具体改动。这是 4 项里唯一"用户直接可见"的能力,优先度最高。

---

## 2. 建议小增强(已有体系,补严格性,不引入全套)

### 2.1 findings in-diff 行区间校验
- 参照:`open_swe/review/findings.py:210-282`(`is_range_in_diff` 用 hunk 行集合校验 start_line..end_line 全在 diff 内,否则拒绝 add_finding)。
- 本地现状:`shared/types/code-review.ts:26-35` CodeReviewFinding 已有 `file/line?/severity/reason/suggestedFix`,`parseCodeReviewFindings(text, changedFiles)` 只按 changedFiles 粗过滤,**未校验 line 是否落在该文件实际改动行**。
- 判断:**小增强**。在 parseCodeReviewFindings 后补"line 必须在 diff hunk 行集合内,否则降级/标注",防 findings 指向未改动行的假阳性。**不引入** Open SWE 的 30+ 字段 TypedDict / fingerprint / REVIEW_FINDING_CAP 全套(过度设计,本地 severity+reason+suggestedFix 已够用)。

### 2.2 udiff 统一 diff 输入(可选)
- 参照:`aider/udiff_coder.py:209-337`(`@@ -a,b +c,d @@` hunk 解析+上下文部分应用)。
- 本地现状:`apply_patch` 仅 Codex 信封(`apply-patch.ts:43-51`);edit 精确替换 + fuzzy 4 级。
- 判断:**条件性小增强**。若产品面向"用户粘贴 unified diff / 与其他工具交换 diff",则值得;作为 apply_patch 的**输入格式补充**(解析 `@@` hunk → 复用现有 preflight/批量回滚链,不新建执行机制)。若 LLM 与用户都走结构化工具调用,则**不引入**(无消费场景)。默认:低优先,等真实场景出现再引入。

---

## 3. 不引入(避免过度设计)

| 能力 | 本地替代/已对齐证据 | 不引入理由 |
|---|---|---|
| Aider auto-commit(git) | undo 链 = write-journal 快照(write-journal.ts:478) | 双回滚机制(git commit + journal)并存会导致策略复杂化;git log 可视化收益可由 checkpoint diff 替代;若要,只能作可选配置,默认关 |
| Aider auto-lint 反射 | `write-side-effects.ts:293-381` syntaxCheck/diagEnabled 写后检查已存在,错误已作 tool_result 回喂 | 已对齐;缺的只是 ESLint 风格层,收益边际 |
| Aider repomap PageRank | `runtime-core/agent-map.ts:973-1213` 加权打分(活动文件+60/提及符号+90) | 等价语义已实现;PageRank 是精度增强、用户不可见,引入 networkx/多语言 tree-sitter 是复杂化 |
| Aider editblock/shell 块文本解析 | 结构化 edit/bash 工具 | 机制替代;无文本协议消费场景 |
| Aider `...` 省略号/相对缩进弹性 | fuzzy 4 级已覆盖主要场景(apply-patch-update.ts:132-176) | 边际增益 |
| Aider editor-whole/editor-diff 格式 | 无 editor model 概念 | 架构差异 |
| Codex amend 规则文件持久化 | 配置走 JSON(exec-approvals.types.ts) | 引入文本规则格式+advisory-lock 是复杂化,JSON 已覆盖 |
| Codex rollout_budget/token_budget 注入 | 预算守卫已存在(context-engine compaction) | 注入式预算是 prompt 工程增强,守卫已满足 |
| Codex exec ThreadEvent 生命周期协议 | trajectory JSONL + talk-events(tool.call/result) | 无 UI/审计消费方;补 file_change/collab/todo item 需协议设计,收益未证实 |
| Codex baseline 影子 git | journal/观察面替代 | 有意排除(内部目录自建 git 基线成本高) |
| Codex landlock/bwrap | docker/policy-light/verseshell | Windows 不可移植 |
| Codex invocation heredoc 拦截 | 工具调用不经 shell | 机制替代 |
| Cline sdk-checkpoints | 无 VS Code 扩展面 | 无对应形态 |
| Open SWE plan_mode 门控体系 | HITL 审批(ExecSecurity/ExecAsk)+ update_plan 展示 | 产品级(UI+审批流+发布页);现有执行审批已覆盖安全,计划门控需产品决策 |
| Open SWE analyzer 评审风格挖掘 | 无 | 单用户场景收益低,多模型编排成本高 |
| Open SWE GitHub 远端检索(search/read_repo_file) | context-search 本地检索 | 依赖 GitHub API+PR 工作流,本地无该场景;若未来引入 PR 工作流再配套 |
| Open SWE scheduler/chat(PR 虚拟文件) | cron-tool + orchestrator-run | 已对齐/无 PR 场景 |

---

## 4. 实施建议(若排期)

1. **P0(可视化优先)**:Cline checkpoint 内容 diff——基于 journal `.pre` 快照,回滚前展示将撤销的文件改动(直接满足"功能全面+可视化")。
2. **P1(健壮性,均小改)**:Codex fsmonitor 保护 + git merge-base;Open SWE PR 422 复用/preflight。
3. **P2(严格性)**:findings in-diff 行区间校验;udiff 输入(等真实场景)。
4. **不排期**:§3 全部。

> 总原则:这 4+2 项都是"在现有机制上做增量"(复用 journal/preflight/execBinary/code-review 链),不引入任何新的并行机制;其余能力要么已被本地替代机制覆盖,要么是精度/协议增强且无消费场景——引入即过度设计。
