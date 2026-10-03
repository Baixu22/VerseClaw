---
id: verseshell-patch-preview-journal-bridge-boundary
title: VerseShell Patch Preview 与 ClawX Journal 桥接边界
type: ai-coding-rule
appliesTo:
  - verseshell-p3-patch-preview-journal-bridge
severity: error
---

# VerseShell Patch Preview 与 ClawX Journal 桥接边界

- **diff 由 host 侧渲染，运行时的 diff 只作为并发检查。** 运行时 `file.diff` 实测把自己的
  渲染截到 200 项并置 `truncated: true`——对任何真实源文件都不足以让人看清改动，而 preview
  的全部价值就是让人在提交前看见改动。因此 unified diff 由 host 侧从**已被哈希证明的
  baseline** 与**提交闸门将要绑定的 post-image** 渲染，复用写入侧既有的
  `generateUnifiedPatch`（`sessions/tools/edit-diff.ts`，`diff@9.0.0`，上限 1 MiB /
  120,000 行），不新增依赖也不重实现算法。
  仍然请求 `file.diff`，但只取它能独家提供的那一件事：它回报的 `content_hash` 严格晚于
  baseline 证明所用的 `file.hash`，两者不一致即目标**在 preview 期间**被改动，该 preview
  描述的状态已不存在——记 `torn-stitch` 并置为不可提交。**不得比对两侧 diff 文本**：
  两个实现的 context 行数与 hunk 切分启发式不同，文本不可能逐字相同，比对只会产生噪音；
  同一性由 `changeSummaryDigest` 承担。
- **AC-3 的关联不依赖运行时 artifact handle。** 实测 `file.diff` 在任何规模下都不返回
  `handle`/`artifacts`，故关联由 `previewId` + `changeSummaryDigest` 承担：digest 已绑定每个
  目标的 pre/post 身份，强于一个"指向某处渲染结果"的 handle——handle 只证明有人渲染过，
  digest 证明渲染的正是这份内容。`artifact_ref` 留 `null` 而非空串，"无归档"与"空归档"仍可分辨。
  该关联之所以可事后重放，是因为 write journal 对**已提交**批次保留 pre-image 快照
  （`discardWriteJournalEntries` 只在 rollback/undo 后调用），post-image 即工作树，
  算法即 `generateUnifiedPatch`。**若将来改为提交后也清理快照，本条论证即失效**，
  故它由测试锁定而非口头约定。
- **审计写入失败必须可观测，且不得永久静默。** effect receipt 的 sink 构造失败**不得**被缓存：
  `EffectReceiptStore` 的构造函数非惰性（直接触碰 SQLite），失败可以是瞬态的，
  缓存失败态会把一次瞬态故障升级为该进程"此后永不写收据"。失败须记一条限流告警。
  依据 OWASP Logging Cheat Sheet 的两条并存要求：
  "failures in the logging processes/systems do not prevent the application from otherwise
  running"（保持 fail-open）与 "enable processes to detect whether logging has stopped"
  （不得静默）。二者不冲突：吞掉对业务的影响，但不吞掉这件事本身。
- **运行时响应契约以实测为准，不得由实现侧假定。** 以下形状由 pinned 的
  `resources/bin/win32-x64/ae.exe`（`ops.list` 返回 31）实测确立：
  - `file.read_range` 返回 `lines: [{line, text}]` 对象数组，`line` 为绝对行号，
    正文**不含行尾符**；`total_lines` 为整份文件的内容行数（尾随换行不额外计一行）；
    `content_hash` 为**整份文件**的哈希且每个窗口都返回；`truncated` 由运行时自报。
    请求超出上限**不报错**，静默返回前缀并置 `truncated: true` —— 该旗标必须读。
  - `file.diff` 返回 `diff: string[]`（每项一行），大 diff **被截到 200 项**并置
    `truncated: true`，**且在任何规模下都不返回 artifact handle**；同时回报该目标当时的
    `content_hash`。
  - `file.hash` 为整份文件**原始字节**的 sha256。
  因此 **baseline 不得由 `lines` 直接拼接**：行记录无法区分"有无尾随换行"，
  且 CRLF 文件的 `\r` 已被剥离。唯一合法读法是构造有界候选（`{LF, CRLF}` ×
  `{无尾随, 有尾随}`）并逐一与该目标的 `content_hash` 比对，命中即字节级等价方可使用；
  全不中（混合行尾等）必须 fail-closed。分页时还须比对各窗口的 `content_hash`，
  不一致即读取期间落了写，立即 `torn-stitch` 并停止。
- **新增到 preview profile 的 operation 必须同时进入 transport 的只读幂等集合**
  （`process-manager.ts` 的 `READ_ONLY_IDEMPOTENT_OPS`），否则 adapter 以
  `retryable: true` 发出的请求会被 `E_ACI_RETRY_FORBIDDEN` 拒绝——profile 允许而
  transport 不允许，是一种只有真实运行时才会暴露的静默失效。
- **每个 op 的解码必须有真实二进制用例背书**，不得只由 fake responder 覆盖：
  照着实现自身假设编写的替身会与实现互相印证，形成一整套绿灯却完全不对应运行时的闭环
  （本片的实际判例）。
- **唯一 journal authority**：ClawX 的 `write-journal.ts` 与 `apply-patch-preflight.ts`
  是 commit / undo / stale-write guard / recovery 的唯一所有者。桥接面不得建立第二个
  journal、第二个 undo 栈或第二套 batch 状态机。
- **`tx.*` 的最终处置：永久拒绝，不是"暂缓启用"。** 前两片把它记作"待后续片裁定"，现给出结论
  与理由，避免它作为一个开放回路无限期悬着：
  - AC-2 要求"仅 ClawX journal 可提交"。一个会提交的 VerseShell 事务，定义上就是第二个提交
    权威；不存在"两者同时是唯一权威"的配置。
  - `tx.*` 自带 journal 目录与 `.aetrash` restore token，即第二个 undo 栈，直接命中
    non_goals 的"第二 journal"。
  - 两者无法组合而只能择一：ClawX 侧是"路径租约 + prepared → committed / rolled_back /
    recovery_required"的批次状态机，`tx.*` 是同一个文件系统上的第二套。同一资源上两套状态机
    必然存在一个双方都认为自己负责回滚的窗口 —— 那正是 success metric「静默 partial
    mutation 0」要防的东西。
  - 唯一可能证成启用的场景是"VerseShell 写到 ClawX 到不了的文件系统"，而 requirement-3 已
    声明不宣称跨文件系统真实原子事务，non_goals-2 也已排除 external command write
    transaction。
  - **重开条件（写明以免变成默认拒绝的空条款）**：只有当 ClawX 的 write journal 被整体退役、
    由 VerseShell 接任唯一 owner 时才需要重新裁定 —— 那是一次**所有权更替**，须另立任务并
    重做 undo / stale guard / recovery 的验收，不是给本桥加一个旗标。在此之前
    `tx.begin / tx.commit / tx.rollback / tx.savepoint / tx.restore / tx.status` 全部留在
    denied 集合内，且该集合与 reviewed policy profile 同源。
- pinned catalog 自带一整套写入与事务面（`file.apply_patch`、`file.write`、
  `file.edit_range`、`file.replace_exact`、`file.remove` 以及 `tx.begin/commit/rollback/
  savepoint/restore` 和 trash restore token）。preview adapter 必须在**请求发出之前**
  机械拒绝其中每一个 operation；拒绝集合与 reviewed policy profile 同源，不得由调用方传入。
- preview 只允许请求 reviewed profile 列出的只读 operation，且必须标记
  `effectful: false`。不得调用 `child_process`、MCP、Gateway HTTP 或 native shell。
- 路径只能是 canonical workspace 下的相对路径；绝对路径、`..` escape、NUL、超过上限的
  patch 文本与超过路径数上限的批次一律 fail-closed。
- **不得用部分 baseline 伪造完整 diff**：ranged read 有硬上限。超出上限的 baseline 只有一条
  合法读法 —— 按窗口分页读满整份文件，窗口数与累计字节各有上限，且**重建结果必须先与该目标的
  `content_hash` 对齐**才可使用。一次读是原子观测，多次读不是：两个窗口之间落下的写入会拼出一份
  磁盘上从未存在过的 baseline，而它看起来完全正常，所以这条校验是分页的准入条件而非优化。
  越界、任一窗口读不到、或哈希对不上时���必须以 `baselineTruncated` 加具名 `baselineReason`
  如实上报并放弃该 diff，不得读前缀充当整份文件，也不得截断后当成完整 diff 输出。
- `file.hash` 失败只有 `E_NOT_FOUND` 可以读作「目标不存在」；其余错误码必须上抛，
  不得降级为「不存在」从而把越权或策略拒绝伪装成新增文件。
- preview 必须产出可机械核对的 change summary digest，绑定每个目标的 pre/post 身份；
  写入侧在 mutation 之前重算该 digest，不一致即视为 stale preview 并拒绝提交，
  不得就地和解。
- **期望值不得由调用方提供**：模型/调用方只能给不透明 `previewId`；期望 digest 只能来自
  host 侧 preview 落盘的记录。让调用方传 digest 等于让它自证，闸门即失效。
- 闸门必须在**第一次写入之前**执行，且被拒绝时必须释放全部 target lease 并丢弃 prepared
  快照——否则会留下悬挂锁，下一次对同路径的 patch 永久阻塞。
- **通用 apply-patch 写入路径不得 import 任何 verseshell 模块**：digest 算法、preview 存储
  与闸门放在中立模块，由两侧共同 import；否则 commit authority 会被 VerseShell 的存在耦合。
- 不带 preview 绑定的 patch 行为必须与既有完全一致；本机制只增加拒绝，不改变既有语义。
- 旗标默认关闭且独立 fail-closed（依赖 `verifiedRuntime`、`typedAci`、`facade`、
  `governedExec`、`artifactResults` 与 kill switch）；不得改动 `liveReady`、
  `productApproved`、`defaultOn` 或任何 rollout 锁。
- 新增配置叶必须同步 type / zod schema / labels / help 四面与 `runtime-feature-leaves.ts`
  锚点；只补其中一部分即视为违规（FP-P0-02 缺陷类）。
