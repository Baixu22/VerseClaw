# 源码对抗验证提示词(自包含,可直接粘贴给新会话)

> 用途:对 ClawX 已实施的 8 项能力补全做"源码级对抗验证",判定每项是**真实还原了参照系能力**,还是**照虎画猫**(形似神不似)。
> 本文件自包含:新会话不需要任何前置对话上下文。

---

## 0. 你的任务

逐能力完成以下四步,输出一份对照报告:

1. **读透参照源码**:理解其核心算法/数据结构/边界处理,不只读注释。
2. **读透本地实现**:定位对应函数,梳理实际行为。
3. **构造对抗用例**:对每个能力设计 5-10 个**针对性输入**(含边界/异常/退化场景),分别按"参照系语义"和"本地实现语义"推演预期输出,再实际执行本地实现验证。凡参照源码可运行处,优先直接运行参照实现做真值对比。
4. **判定**:给每项能力打等级(见 §4),并列出"本地实现与参照系的**行为差异清单**"(逐条:差异点 / 谁更优 / 影响)。

不得基于注释或文档做判断,一切以代码行为为准。报告要写清每个结论对应的 file:line 证据。

---

## 1. 背景(仅作索引,勿照抄结论)

ClawX 是 Electron + React + TypeScript 项目(工作区 `%USERPROFILE%\Desktop\clawx\ClawX`),内含 `openclaw_runtime/`(TS runtime)。此前基于 `%USERPROFILE%\Desktop\coding\source_archive\` 下迁移出的四个开源项目源码(Aider/Cline/Open SWE/Codex)做了能力补全。**本会话的任务是独立验证这些补全的真实性,不预设任何结论。**

---

## 2. 参照源码位置(只读基准)

```
%USERPROFILE%\Desktop\coding\source_archive\
├── aider\
│   ├── coders\editblock_coder.py     # did_you_mean:find_similar_lines ~L602-628;错误模板 ~L84-124
│   ├── coders\base_coder.py          # 反射循环 max_reflections=3;auto_commit 链
│   ├── linter.py                     # tree_context █ 标记;py_lint 三级
│   └── repomap.py                    # PageRank 上下文选择
├── cline\
│   ├── core-session\checkpoint-restore.ts   # WorktreeRestoreTransaction:私有 ref+stash apply
│   ├── core-session\checkpoint-hooks.ts     # git stash create + refs/cline/checkpoints/{sid}/{run}
│   └── core-session\checkpoint-diff.ts      # checkpoint vs 工作区逐文件对比
├── codex\
│   ├── git-utils\info.rs             # git 防护包装:GIT_OPTIONAL_LOCKS=0/hooksPath=/dev/null/5s timeout ~L421-444
│   ├── git-utils\baseline.rs         # 影子 git 基线(内部记忆目录)
│   ├── execpolicy\rule.rs            # PatternToken/PrefixPattern 命令前缀匹配
│   ├── execpolicy\policy.rs          # Decision 三态 Allow/Prompt/Forbidden
│   └── apply-patch\seek_sequence.rs  # 4 级匹配 exact/rstrip/trim/Unicode
└── open_swe\
    ├── tools\http_request.py         # 大输出转存;SSRF 调用方(见下方⚠️)
    ├── middleware\check_message_queue.py
    └── review\findings.py            # in-diff 校验
```

⚠️ **归档缺口(必须标注,不得臆测)**:
- `open_swe/utils/url_safety.py` **不在归档**(`open_swe/utils/` 目录整体缺失)。SSRF 的参照只能通过 `open_swe/tools/http_request.py` 等**调用方**间接推断,无法逐行对照。报告中 SSRF 一项的对照基准改为"本地 `openclaw_runtime/src/infra/net/ssrf.ts` 自证 + 与 Open SWE 调用方语义比对"。
- `aider/repo.py`、`aider/commands.py`(undo/commit message LLM 生成)不在归档。
- `cline/session/user-run-messages.ts` 不在归档。

---

## 3. 本地实现位置(待验证对象)

全部在 `%USERPROFILE%\Desktop\clawx\ClawX\`:

| # | 能力 | 参照源码 | 本地实现(必读) | 已知薄弱点(自查坦白,需重点验证) |
|---|---|---|---|---|
| 1 | did_you_mean 编辑反馈 | aider `editblock_coder.py` `find_similar_lines`(SequenceMatcher.ratio,阈值 0.6,扩 5 行) | `openclaw_runtime/src/agents/sessions/tools/edit-diff.ts` → `findSimilarLines` + `lineWindowRatio`;接入点 `sessions/tools/edit.ts` `appendMismatchHint`、`agents/apply-patch-update.ts` | ⚠️ 算法是**简化版**:用"整行共享率 shared/maxLen"替代 SequenceMatcher 行内字符相似度。`retrun` vs `return` 这类**单字符差异行**可能漏报(测试用 3 行 pattern 掩盖了这点)。需验证:单字符错行是否真的漏;与 Aider 原版在相同输入上的召回率差异 |
| 2 | rewind/checkpoint 回滚 | cline `checkpoint-restore.ts`(git stash 私有 ref + reset/clean/stash apply 精确快照恢复) | `openclaw_runtime/src/agents/checkpoint-rollback-executor.ts` → `applyCheckpointToJournal`(**基于 write-journal 时间戳过滤回滚,未用 git**) | ⚠️ 语义不同:本地是"journal 条目 `createdAtMs >= checkpoint.createdAt` 全部撤销",Cline 是"git 快照精确恢复"。需验证:a) 同毫秒写入歧义(测试用 sleepMs(5) 规避);b) 未跟踪文件/权限位/软链等 git 快照能恢复而 journal 不能的差异;c) 多会话共享文件时 journal 过滤的越界风险 |
| 3 | mission-control 自动触发 | (参照系无直接对应;概念上对应 Cline restore 自动化的缺失) | `openclaw_runtime/src/agents/mission-control/controller.ts` `repeatedRepair` 分支;`mission-control/rollback-wiring.test.ts` | 配置门控 `runtime.mission.rollback.enabled` 默认关。需验证:决策构造/预算边界/pilot 降级是否符合 `replay-rollback-authority.ts` 契约 |
| 4 | git 防护包装 | codex `git-utils/info.rs`(GIT_OPTIONAL_LOCKS=0、core.hooksPath=/dev/null|NUL、5s timeout、stdin null) | `electron/services/git-api.ts` + `electron/services/code-review-api.ts`(execFile 注入,15s timeout)+ `openclaw_runtime/src/agents/worktree-service.ts`(execFileSync 同款 env) | ⚠️ 本地 timeout 是 15s(Codex 5s);stdin 用 GIT_TERMINAL_PROMPT=0 而非 Codex 的 Stdio null。需验证:超时行为、hook 禁用是否真的生效(构造含 post-commit hook 的仓库实测) |
| 5 | autoVerify 激活 | aider 反射循环(概念参照,机制不同) | `openclaw_runtime/src/context-engine/coding-runtime-flags.ts`(enabled 三态 boolean\|"auto")+ `agents/write-side-effects.ts` | 需验证:"auto" 语义(探测到 runner 才执行)是否真在写后链路生效,而非仅改默认值 |
| 6 | SSRF 自查(未改生产代码) | open_swe `url_safety.py`(⚠️ 不在归档,只能看调用方) | `openclaw_runtime/src/infra/net/ssrf.ts`(727 行,已存在)+ `infra/net/ssrf.test.ts`(16 个锁定测试) | 需验证:本地实现是否真的覆盖 Open SWE 调用方所依赖的语义(DNS pinning、私有 IP 拦截、重定向重评估) |
| 7 | 命令前缀审批(未改生产代码) | codex `execpolicy/rule.rs`(PatternToken/PrefixPattern)+ `policy.rs`(三态) | `openclaw_runtime/src/infra/exec-approvals-allowlist.ts`(`matchAllowlist`/`argPattern`/`evaluateShellAllowlist`)+ `infra/exec-approvals-allowlist.test.ts`(5 测试) | 需验证:Windows 上 pattern 需含 .exe 扩展名(node 需 'node.exe')这一行为是否是设计缺陷;与 Codex 前缀语义的差异(正则 vs token 序列) |
| 8 | shadow 收口 + CI 门禁 | (参照系无) | `.github/workflows/check.yml`(contract:check/i18n:lint 步骤);`runtime-core/evidence-verifier.test.ts`、`context-engine/symbol-context-provider.test.ts` | 无需对抗验证,仅确认门禁真实执行 |

---

## 4. 判定等级

对第 1-7 项各打一个等级:

- **S — 真实还原**:行为与参照系在核心语义上等价,差异仅为实现语言/边界优化,对抗用例全部通过。
- **A — 语义等价**:核心语义一致,但存在可列举的简化(如算法精度下降),对抗用例中简化点被如实暴露并有明确说明。
- **B — 简化 MVP**:只复刻了接口/流程形状,核心算法或关键边界被简化,且简化影响真实场景。
- **C — 照虎画猫**:名义上有对应能力,实际行为与参照系显著不符或仅在特定构造输入下成立。

**判定规则**:等级由对抗用例结果决定,不由实现者自述决定。凡本地实现测试未覆盖而参照系能处理的输入,必须构造并执行;无法执行参照实现的,标注"参照行为为推断"。

---

## 5. 对抗用例设计要求(每能力至少覆盖)

1. **正常路径**:参照系文档/代码明示的典型输入。
2. **边界**:空输入、单行/超大输入、Unicode/空白变体、同毫秒时间戳、并发。
3. **异常**:匹配失败、损坏数据、权限/钩子存在、非 git 仓库、未知命令。
4. **退化**:参照系已知缺陷(如 Aider fuzzy 死代码)在本地是否被正确规避或复刻。
5. **等价性**:能运行的参照实现,直接跑同一输入对比输出;不能运行的,至少构造"预期语义"断言。

---

## 6. 输出格式

按能力 1-8 分节,每节包含:

```
### 能力 N:名称
- 参照语义(源码依据 file:line)
- 本地实现行为(函数/行号)
- 对抗用例结果(表格:输入 | 参照预期 | 本地实际 | 一致?)
- 行为差异清单(差异点 | 谁更优 | 影响)
- 判定等级(S/A/B/C + 一句话理由)
```

末尾附**总表**(8 项 × 等级)与**最严重风险 TOP3**(若存在 C 级或影响真实使用的 B 级项)。

---

## 7. 硬约束

- 只读验证:不得修改 ClawX 生产代码(测试代码可新建到 `openclaw_runtime/src/**/*.parity.test.ts` 或临时目录)。
- 一切结论需 file:line 证据;不得引用本文件 §3"已知薄弱点"作为结论本身(它们只是待验证假设)。
- 参照源码路径以 §2 为准;发现归档缺口(如 url_safety.py)必须显式标注"无法对照",不得臆造其实现。
- 若本地实现存在明显缺陷,报告缺陷的**精确触发条件与最小复现**,不做修复建议展开。
