# ClawX 源码级对抗验证审计报告(8 项能力补全)

> 依据 `docs/dev/source-parity-verification-prompt.md` 执行。所有结论均以**代码行为**为准,每个结论附 file:line 证据。
> 方法:读透参照源码 → 读透本地实现 → 构造对抗用例(参照可运行处直接运行参照实现做真值对比,参照不可运行处标注"推断")→ 实际执行本地实现。
> 审计日期:2026-07-31 本地环境:Windows / vitest 4.1.7。

## 0. 执行摘要

| # | 能力 | 等级 | 一句话结论 |
|---|---|---|---|
| 1 | did_you_mean 编辑反馈 | **A** | 核心算法与 Aider 原函数实测一致(单字符错行双方都漏报);差异仅乱序行误报、归一化增强 |
| 2 | rewind/checkpoint 回滚 | **B** | journal 时间戳过滤 ≠ git 快照精确恢复;且 mission 接线存在"回滚报告成功但 0 撤销"的时序缺陷 |
| 3 | mission-control 自动触发 | **B** | 触发/决策/出口大体符合契约,但回滚目标取错 checkpoint 使回滚无实际效果,异常路径破坏契约 |
| 4 | git 防护包装 | **A** | hooks/锁/prompt 禁用经对抗实测真实生效;差异仅 timeout(15s vs 5s)与个别调用点缺防护 |
| 5 | autoVerify 激活 | **A** | "auto" 三态语义真实生效(集成测试实测),写后链路完整;与 aider 反射循环为概念参照 |
| 6 | SSRF 自查 | **A** | 覆盖 Open SWE 调用方可推断的全部语义且更强;参照物 url_safety.py 不在归档,无法逐行对照 |
| 7 | 命令前缀审批 | **A** | 前缀约束+链式绕过防护达成;正则 RegExp.test 非锚定可子串绕过、Windows 需 .exe 全名 |
| 8 | shadow 收口 + CI 门禁 | ✅ | check.yml 确认 contract:check / i18n:lint 门禁真实执行 |

**总体结论:不是"照虎画猫"。** 7 项中无 C 级;2、3 两项为 B 级(真实实现了接口/流程,但核心机制与参照系有实质差异,存在影响真实场景的缺陷),其余 5 项 A 级(核心语义等价,差异均为可列举的简化/增强)。对抗验证发现的最严重问题集中在**能力 2/3 的回滚时序缺陷**。

---

## 能力 1:did_you_mean 编辑反馈 —— **A(语义等价)**

### 参照语义(源码依据)
- `aider/coders/editblock_coder.py` L602-628 `find_similar_lines`:滑窗(窗口=search 行数)对行列表做 `SequenceMatcher(None, search_lines, chunk).ratio()`;`best_ratio < threshold(0.6)` 返回 `""`;首末行精确相等则不扩行直接返回,否则前后各扩 5 行。
- L84-124 错误模板:失败块回显 + `did_you_mean` 非空时附加"Did you mean to match some of these actual lines?"。
- 已知缺陷(实测):L620 空 `search_lines` 时 `best_match[0]` 抛 IndexError;`replace_most_similar_chunk` 后 fuzzy 匹配为死代码(L183-187)。

### 本地实现行为
- `openclaw_runtime/src/agents/sessions/tools/edit-diff.ts` L74-115 `findSimilarLines`:归一化(`normalizeForFuzzyMatch` L42-63:NFKC+trimEnd+智能引号转 ASCII)→ 分支 A 首末行精确匹配(扩 padding=5 行)→ 分支 B 滑窗 `lineWindowRatio`(L117-126:`shared/maxLen`,shared=window 中整行相等计数,pattern 经 Set 去重)。
- 接入:`edit.ts` L171-192 `appendMismatchHint`(仅单编辑 not-found 错误附加,多编辑错误消息不含触发子串,edit-diff.ts L283-285);`apply-patch-update.ts` L63-65/L98-100。
- 空输入防御(L83-85):任一为空返回 `""`。

### 对抗用例结果(参照=Aider 原函数经 Python 直接提取执行,零转录误差)

| 用例 | 输入 | Aider 真值 | 本地实际 | 一致? |
|---|---|---|---|---|
| C1 | 单字符错行单行 `retrun` vs `return` | `""`(ratio=0) | `""` | ✅ 一致(双方都漏报) |
| C2 | 3 行 2 对 1 错 | 命中 | 命中 | ✅ |
| C3 | 乱序 2 行 `b a` vs `a b` | `""`(LCS=1,ratio=0.5) | **命中**(2/2=1.0) | ❌ 本地误报 |
| C4 | 乱序 3 行 | `""`(ratio=1/3) | **命中**(3/3=1.0) | ❌ 本地误报 |
| C5 | 重复行 `aab` vs `aba` | 命中(0.667) | 命中(1.0) | ✅(分不同) |
| C6 | 首末行精确匹配 | 命中不扩行(8 字符) | 命中扩 5 行 | ⚠️ 本地更多上下文 |
| C7 | 空 oldText | **IndexError 崩溃** | `""` | ✅ 本地防御更优 |
| C8 | 智能引号 | `""` | **命中**(NFKC) | ✅ 本地更强 |
| C9 | 阈值恰好 0.6(3 对 2 错) | 命中(0.6 非 <0.6) | 命中 | ✅ |
| C10 | pattern 长于 content | `""` | `""` | ✅ |
| C11 | 正常精确块 | 命中 | 命中 | ✅ |

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| 相似度:整行相等 Set 计数 vs SequenceMatcher(LCS) | Aider 更精确 | 乱序/重复行场景本地高估 → did_you_mean 提示可能含无关内容(仅提示文本,影响低) |
| 首末行精确命中时本地扩 5 行 vs Aider 不扩 | 本地(上下文更丰富) | 提示更长,无实质影响 |
| NFKC/智能引号归一化 | 本地独有 | 本地能匹配 Aider 漏掉的智能引号变体 |
| 空输入防御 | 本地独有 | 本地不崩溃 |
| 单字符错行漏报 | 平局 | **"已知薄弱点"假设不成立:经实测 Aider 原版同样漏报**,非本地简化缺陷 |

**判定理由**:核心语义(整行相等为基础的相似度 + 0.6 阈值 + 滑窗 + 扩行)与参照原函数实测一致;差异为可列举的算法精度变化与增强,且已在对抗用例中如实暴露。

---

## 能力 2:rewind/checkpoint 回滚 —— **B(简化 MVP)**

### 参照语义(源码依据)
- `cline/core-session/checkpoint-hooks.ts` L176-254:`git stash create`(消息 `cline checkpoint session=...`)→ `update-ref refs/cline/checkpoints/{sid}/{run}`;无改动/失败降级 HEAD commit checkpoint。stash create **不含未跟踪文件**。
- `checkpoint-restore.ts` L50-154 WorktreeRestoreTransaction:`git stash push --include-untracked` → 私有 ref → 恢复时 `reset --hard originalHead` → `clean -fd` → `stash apply --index`(精确快照,含索引与未跟踪文件);L337-379 applyCheckpointToWorktree 同型。
- 语义:git 快照精确恢复,能恢复已跟踪文件内容、未跟踪文件(clean 语义)、索引、权限位(经 git 对象);非 git 仓库直接抛错。

### 本地实现行为
- `openclaw_runtime/src/agents/checkpoint-rollback-executor.ts` L88-123 `applyCheckpointToJournal`:**按 write-journal 条目 `createdAtMs >= Date.parse(checkpoint.createdAt)` 过滤**(L95/L106),`undoLastWrites` 逆序恢复(write-journal.ts L478-530:hadPrior=true 复制 .pre 快照重写文件 / hadPrior=false 删除文件;快照丢失抛错硬锁 L497-500)。
- checkpoint 快照本身**不含文件内容**(long-task-control/store.ts:状态描述+createdAt;文件 pre-image 在 journal `.pre` 里)。
- 无 git 仓库要求(host-agnostic,注释 L84-86)。

### 对抗用例结果(本地实测)

| 用例 | 输入 | Cline 语义预期 | 本地实际 | 一致? |
|---|---|---|---|---|
| J1 | checkpoint 与写入同一毫秒 | git 快照无歧义,精确恢复 | `>=` 过滤**误伤撤销 checkpoint 前同毫秒的写入** | ❌ 本地缺陷 |
| J2 | .pre 快照丢失 | stash 对象丢失报错 | errors=["journal snapshot missing"],文件保持,条目保留(硬锁) | ✅ 防御相当 |
| J3 | applyCheckpoint 抛异常 | 恢复失败 → 错误上抛 | `executeReplayRollback` **直接 reject**,recordOutcome 未被调用 | ❌ 契约缺口 |
| J5 | mission tick 时序:写入 T0 → checkpoint 落库 T1 → 回滚取"最新"checkpoint | 应回滚 T0 后的写入 | **ok=true 但 restored=[],文件纹丝不动** | ❌ 重大缺陷 |
| 未跟踪文件 | checkpoint 后新建、未被工具写过的文件 | git 能恢复(clean/stash) | journal 无条目 → **无法恢复** | ❌ 能力缺失 |
| 权限位/软链 | 非内容属性 | git 快照可恢复 | journal 快照(copyFileSync)不保证 | ❌ 能力缺失 |
| 多会话共享文件 | 其他 session 改写同一文件 | git 恢复以快照为准(仍会覆盖他人改动,但快照完整) | 按 session 键控,本会话回滚覆盖他人写入,无跨会话协调 | ⚠️ 风险 |

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| 回滚机制:git 精确快照 vs journal 时间戳过滤 | Cline | 本地无法恢复未跟踪文件/权限位/软链/非工具写入;多会话共享文件越界风险 |
| 同毫秒 `>=` 过滤误伤 | Cline | 同毫秒写入被误撤销(概率低,测试用 sleepMs(5) 规避掩盖了它) |
| **J5:mission 回滚取"最新 checkpoint"(当前 tick 末尾刚落库,createdAt≈now)→ 过滤后无条目可撤,回滚报告成功但 0 撤销** | Cline | 自动回滚形同虚设,还产生假阳性 "rollback ok" 事件(见能力 3) |
| 不依赖 git 仓库 | 本地 | 非 git 工作区可用(参照系直接抛错) |
| 快照丢失硬锁 | 平局 | 都 fail-stop 不部分恢复 |

**判定理由**:复刻了"恢复到 checkpoint 时刻"的流程形状与接口,但核心机制从"git 快照精确恢复"简化为"journal 时间戳过滤",且该简化直接造成未跟踪/权限/越界/时序四类真实场景差异;J5 使 mission 自动回滚实际无效。非 C 级因为 journal 恢复对"工具写过的文件"确实工作(现有测试+J1/J2 实测),且不依赖 git 是真实优势。

---

## 能力 3:mission-control 自动触发 —— **B(简化 MVP)**

### 参照语义
参照系无直接对应;对照基准为本地契约 `replay-rollback-authority.ts`(决策形状、仅显式调用、pilot 路由、legacy 流程、recordOutcome 全出口)。

### 本地实现行为
- `controller.ts` L1038-1101 `repeatedRepair` 分支:触发条件 `decision==="repair" && noProgressHash 重复`(L963-964,hash=决策+brief+证据 sha256,L385-393);门控 `cfg.runtime.mission.rollback.enabled===true && deps.rollback`(L1039-1040);决策构造 L1046-1051 符合契约;pilot 恒 `enabled:false`(L1055,注释"event-log replay not implemented");成功 → sleeping+清 latch(L1060-1077),失败/无 checkpoint → blocked(L1078-1094)。
- `getLatestLongTaskCheckpoint`(long-task-control/store.ts L822-837)按 `created_at desc` 取最新。

### 对抗用例结果
- 现有 `rollback-wiring.test.ts` 3 用例全绿(未接线 blocked / 启用+checkpoint sleeping / 校验失败 blocked 含细节)。
- 契约逐条核对:决策形状 ✅、不自触发 ✅、pilot 恒 legacy ✅、recordOutcome 全出口 ✅;**异常路径 ❌**:authority.ts L200 `await deps.applyCheckpoint` 无 try/catch,生产 deps 抛错时 `executeReplayRollback` reject(J3 实测),controller L1052 无本地捕获 → 外层 catch(controller.ts L1176-1188)置 `status="error"`,丢失 "rollback failed" 细节。
- **J5 实测**:回滚目标为"最新 checkpoint"= 当前 tick 末尾刚落库的 checkpoint(controller.ts L1017/L1019-1036 落库在先,L1045 取用在后)→ `createdAtMs >= at` 过滤后本 tick 写入全部早于 checkpoint → **toUndo 为空,回滚 0 撤销但返回 ok**。
- 预算边界:repeatedRepair 分支(L1038)不经过 repairTicks 递增(L1120),只要 hash 重复可每 tick 反复触发,无回滚重试预算。

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| 回滚目标应为"上一个 tick 的 checkpoint",实际取"当前 tick 刚写的" | 参照(Cline 恢复事务取明确快照) | 回滚无实际效果 + 假阳性 ok 事件;打开 rollback.enabled 的用户得不到回滚 |
| applyCheckpoint 抛错不经 recordOutcome、reject 上抛 | 契约要求失败映射为 ok:false | status=error 而非 blocked+细节;测试未覆盖该路径 |
| 回滚分支无重试预算 | — | hash 重复可持续每 tick 触发回滚尝试(受 maxTicks 总闸限制) |
| 默认配置关闭 | — | 默认无风险,仅显式开启者受影响 |

**判定理由**:触发条件/决策构造/双门控/出口映射大体符合契约(测试实证),但回滚目标时序缺陷使回滚无实际效果,J3 异常路径破坏契约。B 级(接口与流程真实,关键语义缺陷影响真实场景)。

---

## 能力 4:git 防护包装 —— **A(语义等价)**

### 参照语义(源码依据)
- `codex/git-utils/info.rs` L421-444 `run_git_command_with_timeout_from`:`GIT_OPTIONAL_LOCKS=0`(L429)、`core.hooksPath={DISABLED_HOOKS_PATH}`(L432,Windows=NUL)、`GIT_COMMAND_TIMEOUT=5s`(L46/L438,超时返回 None)、`.stdin(Stdio::null())`(L436)、`kill_on_drop`(L437);唯一底层入口,全部调用点统一受防护。

### 本地实现行为
- `electron/services/git-api.ts` L137-173 `execBinary`:GIT_OPTIONAL_LOCKS=0、GIT_TERMINAL_PROMPT=0、hooksPath 经 `GIT_CONFIG_COUNT=1` 注入 NUL(L149)、**timeout 15s**(L134/L152)、windowsHide、maxBuffer 8MB;注释声明 "stdin: null" 但**代码未显式设 stdin**,由 GIT_TERMINAL_PROMPT=0 承担。
- `code-review-api.ts` L116-145 同款;`worktree-service.ts` L130-145 `git()`(execFileSync 同款 env,**无 timeout**)、L117-127 `isGitRepo` **无任何防护**。

### 对抗用例结果(本地实测)

| 用例 | 输入 | 预期 | 本地实际 | 一致? |
|---|---|---|---|---|
| H1 | 含 post-commit hook 的仓库,默认 env 提交 | hook 触发 | 触发 | ✅(实验有效) |
| H2 | 同仓库,本地同款 env(GIT_OPTIONAL_LOCKS/GIT_TERMINAL_PROMPT/hooksPath=NUL)提交 | hook 不触发 | **不触发** | ✅ 防护真实生效 |
| H3 | hooksPath 指向空目录 | hook 不触发 | 不触发 | ✅ |

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| timeout 15s vs 5s | Codex | 本地挂起容忍更长(UI 卡顿风险略高,15s 可接受) |
| stdin:GIT_TERMINAL_PROMPT=0 vs Stdio null | Codex 更严格 | 语义相近(都防交互提示);本地无 ssh 场景实测 |
| worktree-service.ts `isGitRepo`/`git()` 缺 timeout 与 hooksPath 缺失(仅 isGitRepo) | Codex 全调用点统一 | 个别调用点可无限挂起(execFileSync 同步);rev-parse 无 hook 风险 |
| hooks 禁用本身 | 平局 | 实测两者等效 |

**判定理由**:核心防护(env 注入禁用 hooks/locks/prompt)经对抗实测真实生效,与参照语义等价;差异仅为 timeout 常量与个别调用点遗漏,均为可列举简化。

---

## 能力 5:autoVerify 激活 —— **A(语义等价)**

### 参照语义
aider `base_coder.py` 反射循环(概念参照,机制不同):编辑后 lint/测试失败(经用户确认)→ 错误原文作为下一条 user 消息重跑,硬上限 max_reflections=3。

### 本地实现行为
- `context-engine/coding-runtime-flags.ts` L128-149 `resolveCodingAutoVerifyConfig`:默认 `"auto"`(L19),非法值回退 auto,timeout 1-90 校验。
- 数据流:agent-tools.ts L767 解析 → L838-841 注入 `wrapToolWithWriteSideEffects` → write-side-effects.ts L421-424 `detectTestRunner`(test-runner-detect.ts:manifest/lockfile 探测,跳过原因可解释)→ **仅 `detection.detected` 才执行**(L425-427)→ L185-187 `enabled===true||"auto"` 才经 exec 桥执行(L204-211)→ verdict 进 `details.verify_tests` + `appendCodingEvidenceToContent` 进 content(L459-511);全程 fail-open(L449-451),永不回滚写。

### 对抗用例结果(集成测试实测)
| 用例 | 输入 | 本地实际 | 结论 |
|---|---|---|---|
| 默认 auto + package.json 有 vitest 脚本 | 写文件 | **确实执行测试**(execution.status≠disabled) | ✅ "auto" 语义真实生效 |
| 显式 false + runner 存在 | 写文件 | disabled,不执行 | ✅ |
| exec deny | 写文件 | 写成功不回滚,status=denied | ✅ fail-open |
| 策略移除 exec | 写文件 | unavailable,不绕过策略 | ✅ |

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| 机制:一次性写后自动验证 vs 用户确认的反射循环(最多 3 次) | 参照系(设计意图不同) | 概念对齐,机制不同(提示词已注明"概念参照") |
| "auto" 未探测到 runner 时不执行 | 本地设计 | 与默认值语义一致(探测启发式可能漏测,如 monorepo 跨包 fail-closed) |
| 无"auto 未探测到时不调用桥"的直接断言测试 | — | 测试缺口(代码 L425-427 已明确) |

**判定理由**:三态语义经集成测试实测真实生效,写后链路完整;与参照为概念等价、机制差异如实标注。A 级。

---

## 能力 6:SSRF 自查 —— **A(语义等价,本地自证)**

### 参照语义
⚠️ **`open_swe/utils/url_safety.py` 不在归档**(`open_swe/utils/` 整体缺失),无法逐行对照。仅能从调用方推断:
- `open_swe/tools/fetch_url.py` L38-49、`http_request.py` L58-66:调 `request_with_safe_redirects`,拦截走 **blocked dict 返回**(含 content/status_code/url),不抛异常;逐跳重评估(函数名 + httpx follow_redirects=False 推断);无 allowlist 参数(推断默认严格)。

### 本地实现行为
- `infra/net/ssrf.ts`(727 行)+ `fetch-guard.ts` + `net-policy/ip.ts`:
  - DNS pinning 两阶段:`resolveHostnamePolicyChecks`(L374-399, DNS 前 fail-fast)→ 解析后 `assertAllowedResolvedAddressesOrThrow`(L401-411,每个解析结果复用同一分类器防策略漂移)→ `createPinnedLookup` 固定地址(L430-490)。
  - 网段:IPv4 含 RFC1918/loopback/link-local/CGNAT(100.64/10)/multicast/RFC2544;IPv6 含 ULA/link-local/site-local/embedded-IPv4(::ffff:/NAT64/6to4/Teredo/ISATAP);畸形字面量 fail-closed(L324-334)。
  - 重定向:fetch-guard.ts 每跳重新解析+重新 pinning(L491-562),上限 3(L444-447),环检测(L636-640),跨源敏感头剥离(L624-635)。

### 对抗用例结果
- `ssrf.test.ts` 16 个测试**全部通过**(私有 IP 5/link-local/ULA/embedded/fail-closed、hostname 3、allowlist 5、DNS pinning 3)。
- 测试缺口:fetch-guard.ts 重定向循环/跨源剥离/上限无直接测试文件(实测确认,仅 ssrf.test.ts 注释提及)。

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| url_safety.py 缺失 → DNS pinning/网段表/端口限制**无法对照** | — | 显式标注"无法对照",不臆测 |
| 拦截契约:本地 SsrFBlockedError 异常 vs Open SWE blocked dict 返回 | Open SWE(呈现层) | 本地集成层(web-fetch)需自行转换;语义一致 |
| 端口白名单:本地无(仅协议 http/https 校验) | — | Open SWE 是否有端口限制无证据,不能臆断 |
| 重定向重评估/上限/环检测/敏感头剥离 | 本地更强 | 推断语义一致且本地更完备 |
| 默认策略严格 + 可配置豁免 | 本地更多能力 | 默认行为一致 |

**判定理由**:本地实现覆盖 Open SWE 调用方可推断的全部语义且更强;参照物缺失下以"本地自证 + 调用方语义比对"判定,差异(契约呈现、端口、测试缺口)如实标注。A 级。

---

## 能力 7:命令前缀审批 —— **A(语义等价)**

### 参照语义(源码依据)
- `codex/execpolicy/rule.rs`:`PatternToken`(Single/Alts 逐字符精确比较)、`PrefixPattern` 命令前缀 token 序列匹配(命令+参数前缀,天然在命令边界截断)。
- `policy.rs`:Decision 三态 Allow/Prompt/Forbidden。

### 本地实现行为
- `infra/exec-approvals-allowlist.ts` + `exec-command-resolution.ts`:`matchAllowlist`(L383-430,裸 `*` 提前放行、路径 glob、裸名 basename 匹配 L363-381)、`matchArgPattern`(L304-340:拼接 argv.slice(1) 后 `new RegExp(argPattern).test`)、`evaluateShellAllowlist`(链式命令拆段逐段评估,拒绝行续接)。
- 三态对应:本地 exec-approvals 体系(deny/allow/approval)。

### 对抗用例结果
| 用例 | 输入 | Codex 前缀语义预期 | 本地实际 | 一致? |
|---|---|---|---|---|
| W1 | allowlist `node` + Windows 解析出 node.exe | 匹配命令名 | **不匹配,必须写 node.exe**(matchesExecutableBasenamePattern 不剥后缀,exec-command-resolution.ts L373-379;测试 34-36 行注释锁定该设计) | ❌ 平台差异 |
| W2 | argPattern=`server` + `node server.js` | 前缀 `server` 才匹配 | **子串 'server' 即放行**(RegExp.test) | ❌ 依赖作者锚定 |
| W3 | `node -e x; rm -rf /` | 拒绝 | **拒绝**(逐段评估) | ✅ |
| W4 | `git status; rm -rf /` 型 | 拒绝 | 拒绝(同 W3 机制) | ✅ |

### 行为差异清单
| 差异点 | 谁更优 | 影响 |
|---|---|---|
| 匹配机制:正则 RegExp.test vs token 序列前缀 | Codex | 非锚定正则可被参数子串绕过;本地靠 `^` 锚定惯例与测试锁定(现有 5 测试均锚定) |
| Windows .exe 扩展名 | Codex(无此问题) | 用户必须写 `node.exe` 而非 `node`,已文档化+测试锁定;与 normalizeExecutableToken(剥后缀)不一致是潜在坑 |
| 链式命令逐段评估 | 本地(覆盖更广) | 与 Codex 防 `git status; rm -rf /` 目标等价 |

**判定理由**:核心目标(allowlist 前缀约束 + 链式绕过防护)达成并有测试锁定;差异为机制(正则 vs token)与平台扩展名,均已如实暴露。A 级。

---

## 能力 8:shadow 收口 + CI 门禁 —— **确认通过**

- `.github/workflows/check.yml`:PR→main 触发,步骤链含 `pnpm run lint`、`pnpm run typecheck`、`pnpm run contract:check`、`pnpm run i18n:lint`、`pnpm run test`、`pnpm run harness:ci`、`pnpm run release:supply-chain-policy`。**contract:check 与 i18n:lint 门禁真实存在并执行**。
- 无需对抗验证。

---

## 总表

| # | 能力 | 等级 | 关键证据 |
|---|---|---|---|
| 1 | did_you_mean 编辑反馈 | **A** | Aider 原函数实测真值对比 11 用例(2 处行为差异:乱序误报/扩行) |
| 2 | rewind/checkpoint 回滚 | **B** | J1 同毫秒误伤、J5 回滚 0 撤销、未跟踪/权限不可恢复 |
| 3 | mission-control 自动触发 | **B** | J3 reject 契约缺口、J5 目标错 checkpoint、无重试预算 |
| 4 | git 防护包装 | **A** | hook 仓库对抗实测防护生效;15s/个别调用点差异 |
| 5 | autoVerify 激活 | **A** | 4 个集成用例实测 "auto" 语义真实生效 |
| 6 | SSRF 自查 | **A** | 16 测试全绿;参照 url_safety.py 缺失标注"无法对照" |
| 7 | 命令前缀审批 | **A** | 5+3 测试;W1 .exe/W2 子串差异锁定 |
| 8 | shadow 收口 + CI 门禁 | ✅ | check.yml 步骤确认 |

## 最严重风险 TOP3

1. **[能力 2+3] mission 自动回滚时序缺陷(J5)**:controller 每 tick 末尾落库 checkpoint 后立即用 `getLatestLongTaskCheckpoint` 取"最新"作为回滚目标,其 createdAt≈now,`createdAtMs >= at` 过滤后无条目可撤 —— **回滚报告 ok 但 0 撤销**,且产生假阳性 "mission.rollback ok" 事件。开启 `runtime.mission.rollback.enabled=true` 的用户得不到任何回滚保护。精确触发条件:任意 repeatedRepair 命中且 rollback 启用。修复方向(不做展开):应取上一个 tick 的 checkpoint。
2. **[能力 2] journal 时间戳过滤 vs git 快照的根本能力缺口**:未跟踪文件、权限位、软链、非工具写入(手动编辑/其他进程)均无法恢复;多会话共享文件时本会话回滚会覆盖他人写入且无跨会话协调;同毫秒写入被 `>=` 误伤。触发条件:回滚目标文件在 checkpoint 后未被本 session 工具写过的任何场景。
3. **[能力 7] 非锚定 argPattern 子串放行 + Windows .exe 命名坑**:allowlist 作者写 `argPattern: "server"` 这类未锚定正则时,`node server.js` 及任意含 "server" 子串的参数均放行(Codex 前缀语义不会);Windows 上 `node` 条目静默失效必须写 `node.exe`。触发条件:配置层书写质量 + Windows 平台,属配置风险而非默认路径风险。

## 附:验证产物
- 对抗用例(本地执行):`openclaw_runtime/src/agents/parity-audit/parity-audit.test.ts`(17 用例,全绿,含能力 1/2/7)
- Aider 参照真值运行器:`openclaw_runtime/../.parity-audit/aider_find_similar_lines_truth.py`(直接 exec 归档源函数)
- git hook 防护实测脚本:`openclaw_runtime/../.parity-audit/git-hook-parity.sh`
- 基线测试全绿:edit-diff 29 / edit 16 / rollback-wiring 3 / auto-verify 4 / ssrf 16 / exec-approvals 5

---

# 缺口修复实施记录(2026-07-31,修复后复评)

> 依据本报告 TOP3 风险与差异清单,经用户确认(全面补齐 / 修复 journal 方案缺陷 / allowlist 对齐 Codex 语义)实施。
> **修复后总判定:8 项能力中 6 项 A、2 项确认通过,无 B/C 级。**

## 修复后总表

| # | 能力 | 修复前 | 修复后 | 修复内容 |
|---|---|---|---|---|
| 1 | did_you_mean 编辑反馈 | A | **A(差异消除)** | LCS 替换 Set 计数,乱序行误报消除 |
| 2 | rewind/checkpoint 回滚 | B | **A** | seq 边界替代时间戳 + 回滚目标修正 + 异常契约 |
| 3 | mission-control 自动触发 | B | **A** | 回滚目标取上一个 checkpoint + applyCheckpoint 异常映射 |
| 4 | git 防护包装 | A | **A(补漏完成)** | worktree-service 补 timeout/env + git-api stdin 显式 null |
| 5 | autoVerify 激活 | A | **A(测试补齐)** | auto 无 runner 不调用桥的直接断言 |
| 6 | SSRF 自查 | A | **A(测试补齐)** | fetch-guard 重定向 5 用例(每跳重评估/上限/环/跨源) |
| 7 | 命令前缀审批 | A | **A(行为对齐)** | 裸名匹配 .exe + argPattern 前缀锚定 |
| 8 | shadow 收口 + CI 门禁 | ✅ | ✅ | 不变 |

## 逐项修复记录

### 能力 1:did_you_mean(乱序误报)
- **修复**:`openclaw_runtime/src/agents/sessions/tools/edit-diff.ts` L117-146 `lineWindowRatio` 由"整行相等 Set 计数"替换为 LCS DP(`2*M/(len1+len2)`,与 Aider SequenceMatcher.ratio 语义一致,对行顺序敏感)。
- **效果**:parity C3/C4 反转(乱序行 `""`,与 Aider 真值一致);C5 重复行 0.667(原 1.0)对齐;现有 45 个测试无需改动全绿。

### 能力 2 + 3:回滚链路(seq 边界 + 回滚目标 + 契约)
- **修复 A(seq 边界)**:`mission-control/controller.ts` `MissionControllerDeps` 新增 `journalSeqBoundary?: () => number|undefined`;tick 末尾落库处将 journal 尾部 seq 写入 checkpoint `metadata.journalSeq`;`openclaw-tools.ts` 用 `options?.sessionId` 注入(与 rollback deps 同源)。`checkpoint-rollback-executor.ts` `applyCheckpointToJournal` seq 优先过滤(`entry.seq > boundary`),无 stamp 时时间戳 fallback(兼容旧 checkpoint)。
- **修复 B(回滚目标)**:`controller.ts` repeatedRepair 分支改用 `listLongTaskCheckpoints(sessionKey, 2)[1]`(上一个 tick 的 checkpoint);仅一条时 blocked "no checkpoint available"。
- **修复 C(契约)**:`replay-rollback-authority.ts` `applyCheckpoint` 包 try/catch,异常映射 `ok:false` + reason `rollback_apply_failed` + recordOutcome 全出口,不再 reject。
- **效果**:parity J1 反转(同毫秒不误伤)、J5 反转(回滚真实撤销)、J3 反转(ok:false 契约);rollback-wiring 新增"单 checkpoint → blocked"用例;checkpoint-rollback-executor 新增 seq 边界/非数字 fallback 用例。35 个相关测试全绿。
- **遗留限制(用户确认不引入 git 快照)**:未跟踪文件/权限位/非工具写入仍不可恢复;多会话共享文件越界风险仍存在——已文档化。

### 能力 4:git 防护补漏
- `worktree-service.ts`:提取 `hardenedGitEnv()` 共用;`isGitRepo` 补 env+timeout 15s+windowsHide;`git()` 补 timeout 15s。
- `electron/services/git-api.ts`:`execBinary` 创建后 `child.stdin?.destroy()`(execFile 无 stdio 选项,此即 stdin null 语义,与 Codex Stdio::null 对齐)。
- **效果**:worktree-service.test.ts 新增 hook 防护用例(对照触发/硬化不触发),16 个测试全绿。

### 能力 5:autoVerify 测试缺口
- `write-side-effects.verify-tests.test.ts` 新增"auto 模式无 runner 时 exec 桥不被调用"断言(executeTestCommand spy 0 次调用、execution undefined、rendered 含 skip),15 个测试全绿。

### 能力 6:SSRF 测试缺口
- 新增 `infra/net/fetch-guard.redirect.test.ts` 5 用例:R1 单跳重定向、R2 重定向到私有 IP 每跳拦截(SsrFBlockedError)、R3 上限 3(Too many redirects)、R4 环检测、R5 跨源剥离 Authorization/Cookie 且保留 user-agent。与 ssrf 16 个测试合计 21 个全绿。

### 能力 7:allowlist 对齐 Codex 语义
- `exec-command-resolution.ts`:`matchesExecutableBasenamePattern` 候选集加入 `normalizeExecutableToken` 归一化(裸名 `node` 匹配 Windows `node.exe`);`matchArgPattern` 非 `^` pattern 自动锚定参数串开头(前缀语义,中段子串不再放行;`\x00` 自动 pattern 已锚定不受影响)。
- **效果**:exec-approvals-allowlist.test.ts 常量改回裸名 `node`(跨平台);parity W1/W2 反转。22 个相关测试全绿。

## 修复后验收证据(2026-07-31)

| 验证 | 结果 |
|---|---|
| agents-support 回归(mission-control/parity/sessions-tools/executor/worktree/write-side-effects 等 12 文件) | 171/171 通过 |
| infra 回归(net/ + exec-approvals 3 文件) | 26/26 通过 |
| agents-core auto-verify | 4/4 通过 |
| `pnpm run typecheck`(node + web) | 0 错误 |
| `pnpm run contract:check` | passed |
| `pnpm run i18n:lint` | passed |
| parity 对抗用例(反转断言后) | 17/17 通过 |
