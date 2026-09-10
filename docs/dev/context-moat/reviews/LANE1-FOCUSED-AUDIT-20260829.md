# lane-1 专注审计报告：替代 lane-2 收口判断

- 审计者：lane-1（Codex desktop）
- 审计日期：2026-08-29
- 审计目的：独立复核 lane-2 回交，不把 lane-2 的自述直接升级为收口事实；为 `AUDIT-BOARD.html` 提供当前唯一的 lane-1 专注审计口径。
- 权威状态源：`.agent-workbench/task-forest/graph/nodes.json`；审核论证源：`docs/dev/context-moat/reviews/*.md`；本报告和看板只是审计镜像。
- 写入范围：本报告与 `AUDIT-BOARD.html`。本轮不直接修改 Task Forest node、默认旗标、kill switch、approval、rollback 或敏感数据边界。

## 最终裁决

| 对象 | 当前 canonical 状态 | lane-1 裁决 | 可继续动作 |
|---|---|---|---|
| `TF-0119` | `review_needed / 90` | **接受证据，暂不收口**。四类事实源和生成链门禁可复核，但较新的 canonical node 仍要求可认证 `Task: TF-0119` 归属或协议裁决；历史 closeout proposal 不能覆盖该状态。 | 补齐 R3 归属/协议裁决后再由 lane-1 复核；本轮不绕过 CLI 改 node。 |
| `TF-0122` | `done / 100` | **接受，范围性接受**。迁出裁决成立，但含义是“默认生产路径未通电，迁移时保留文本工具”，不是“源码无生产调用”，也不是 hybrid 已完成迁移。跨 run `taskId` 过滤缺陷已修复。 | 保留 `16/16` 回归证据；hybrid 迁移 owner 和更广 task-scope 集成仍属后续边界。 |
| `TF-0143` | `done / 100` | **接受，范围性接受**。真实脱敏语料、哈希、T-C0 复跑和 UFTK 兼容面证据成立；这不是 receipt baseline、真人反馈或产品 moat 证据。 | 保留当前语料证据，不能把 `480` 个被定位单元写成持续数据资产。 |
| `TF-0134` | `ready / 0` | **保持 ready**。生产可达性取证已增强；AST `--exports` inventory 已落盘，但仍是发现盲区的工具，不是 M4 最终收口证据。 | M4 收口时逐符号复核，并人工处理 wildcard/default/dynamic import、外部调用者和同名绑定。 |
| `TF-0135` | `review_needed / 20` | **退回/阻塞**。护城河风险仍开放；真实 receipt baseline 为 `BLOCKED / NOT EXECUTED`，当前只有工程证据和有限真实输入可行性。 | 先建立隔离 state/config、明确授权 provider/model、非敏感 probe message、可回滚清理和真实 receipt 入口。 |
| `TF-0066` | `in_progress / 10` | **保持进行中**。15/15 focused tests 证明诊断契约，不证明 ClawX Main/host 生产 adapter 已安全接线。 | 先确定 host-only secret owner、审批绑定 lineage 和 bounded event sink，再做跨层 adapter。 |

### 总判断

本轮没有发现足以推翻 `TF-0122` 或 `TF-0143` 当前任务范围结论的新证据；跨 run 过滤缺陷已由显式稳定 `taskId` 修复并通过回归测试。仍保留三条硬边界：

1. `TF-0119` 的事实证据已接受，但 canonical node 仍为 `review_needed / 90`；历史 closeout proposal 已被较新的 canonical review-needed 更新 supersede，`F-AUTH-003=Partial/L3` 和 CVK 生产执行边界仍需保留。
2. `TF-0122` 的 hybrid 函数有 3 个静态生产文件调用点；正确表述是“默认路径未通电”，不是“零生产调用”。
3. `TF-0135` 的 receipt 行数仍为 0；probe 已建立但本轮仍是 `BLOCKED / NOT EXECUTED`，单测、synthetic、一次真实语料和生产静态调用点都不能推出真人产品价值或 12-18 个月护城河。

## 证据复核

### TF-0119：治理事实源与 synthetic 降级

**结论：证据层接受，节点层暂不收口。**

复核的四个条件全部满足：

- `plans/system-maturity/findings-registry.json:26-42,271-291`：`F-AUTH-003.status=Partial`、`evidenceLevel=L3`，`counts.total=35`，派生状态为 `Fixed=31 / Partial=4 / Open=0 / Unverified=0`，数组长度为 35。
- `P2-005.md:3,32-35`、`P2-005.delivery.md:7,11` 和 `risk-acceptance.json:24-28` 统一说明：gate API 可以计算 `denied`，但生产 CVK engine 尚未在工具执行边界消费它；历史测试保留为 API/单元证据，生产硬阻断需要另立 default-off、至少 `brb-M` 的 follow-up。
- `artifacts/runtime-memory-eval/report.json:3-4`：`evidenceClass=synthetic`、`accepted=false`，并有明确的 `acceptanceNote`；`scripts/runtime-long-stability.mjs:267-275` 将其标为 incomplete。
- `tests/unit/runtime-memory-eval-aggregate-report-real.test.ts`：当前复跑 `15/15` 通过，验证生成链不会覆盖 `evidenceClass`、`accepted` 和 `acceptanceNote`。

较早的 `TFP-lane1-tf0119-closeout-20260829.json` 虽标记为 applied，但随后更晚的 canonical 更新又将 node 置为 `review_needed / 90`，并把可认证 `Task: TF-0119` 归属或协议裁决列为前置。因此本报告只接受事实证据，不把历史 proposal 当作当前 closeout，也不把 CVK API `denied` 宣称为生产硬阻断或把 synthetic runtime-memory 报告升级为 L3 真人/真实运行证据。

### TF-0122：hybrid 检索链迁出

**结论：接受当前裁决范围。**

lane-2 的四项判断经独立复跑成立，但必须修正措辞：

- `openclaw_runtime/src/context-engine/memory-context-provider.ts:515`、`openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts:304`、`openclaw_runtime/src/runtime-core/memory-query-tool.ts:140` 均存在 `hybridSearchFactsWithEmbedding` 调用点。
- `memory-context-provider.ts:197-202,269-274` 要求 `embeddingEnabled === true` 且存在 provider；`memory-pre-reply-injection.ts:382` 受独立 retrieval flag 控制。跨 run 过滤缺陷已在 `context-orchestrator.ts` 改为接受显式稳定 `taskId`，不再从瞬时 `runId` 推导；`attempt.ts` 传入 `params.lineage?.taskLedgerRootId`。
- `node openclaw_runtime/scripts/check-production-reachable.mjs hybridSearchFactsWithEmbedding`：`PRODUCTION REACHABLE — 3 call site(s)`，退出码 `0`。
- `node openclaw_runtime/scripts/check-production-reachable.mjs findRuntimeMemoryFacts`：`PRODUCTION REACHABLE — 7 call site(s)`，退出码 `0`。
- `node openclaw_runtime/scripts/check-production-reachable.mjs applyContextLadder`：`NOT PRODUCTION REACHABLE — zero production call sites`，退出码 `1`；这是 experiment/test 阴性对照。
- 相关内存/体验回归合并复跑：`5 test files / 69 tests passed`，退出码 `0`。

因此迁出决策可接受，且跨 run 召回修复已作为后续实现落地；仍需保留生产文本工具、不要删除显式 opt-in 的边界。静态 import、静态 call site 和默认通电三者不可混为一谈。

### TF-0143：真实语料与 schema 兼容面

**结论：接受当前任务范围，不升级证据等级。**

- `docs/dev/context-moat/corpus/tf-0143-57c00668.md` 登记的脱敏语料哈希与当前 `~/.openclaw/corpus/tf-0143-57c00668.jsonl` 实测 SHA-256 均为 `CDF6843E2E0BDAF159FFC6DD792E81E57C1BED8E03BF586EFA8B5857FF81E4E2`。
- `node scripts/context-loss-trace-spike.mjs --session <脱敏语料> --state-db <本机 state>`：退出码 `0`；`entries=255 messages=248 userTurns=42 compactions=2`，`units located=480`，`units carrying a reason=0`，`persisted receipt rows=0`，脱敏 `findings=0`。
- `tests/unit/default-config-matrix.test.ts`：`18/18` 通过，退出码 `0`。
- `openclaw_runtime/src/config/runtime-coding-uftk.test.ts`：`2/2` 通过，退出码 `0`。
- `TF-0143` canonical node 位于 `.agent-workbench/task-forest/graph/nodes.json:9996-10060`，当前为 `done / 100`。

这证明“真实输入可以被脱敏并被 T-C0 消费，schema 兼容修复没有改变默认行为”。它不证明 receipt 已持续写入、不证明真人满意度、不证明任务成功率，也不证明数据或市场护城河。

### TF-0134：生产可达性证据边界

**结论：保持 `ready`。**

- 逐符号 D1 结果确认：`auditCompactionDamage`、`scoreContextHealthFromCompactionAudit`、`recordContextHealth`、`scoreGoalAlignment`、`informationNovelty`、`chargeTurnInjection`、`finalizeContextCandidates` 和 `endContextCandidateCollection` 存在生产链调用点。
- `applyContextLadder` 为 experiment/test-only，不能作为当前 M4 生产能力。
- `node openclaw_runtime/scripts/check-production-reachable.mjs --exports --exports-report docs/dev/context-moat/reviews/TF-0134-exports-20260829.json`：`total=21701`、`production-reachable=14075`、`api-surface-only=1044`、`not-production-reachable=6582`、`export-blind-spots=412`、`module-blind-spots=1714`，退出码 `1`。
- `node --test openclaw_runtime/scripts/check-production-reachable.test.mjs`：`2/2` 通过，退出码 `0`；机器报告落盘于 `docs/dev/context-moat/reviews/TF-0134-exports-20260829.json`。

`--exports` 是静态 inventory，报告自己也声明 wildcard/default exports、computed imports、unresolved imports、out-of-root modules、published package exports 和外部 callers 是盲区。因此它能暴露需要审计的集合，不能把 6558 直接判成死代码，也不能替代 M4 最终逐符号和反向证伪。

### TF-0135 与 TF-0066：真实运行阻断

`docs/dev/context-moat/reviews/TF-0135-receipt-baseline.md:7-11,22-26,66,81-86` 的当前基线仍是 **`BLOCKED / NOT EXECUTED`**；本轮新增的 `scripts/rc03-receipt-probe.mjs` 只建立了 fail-closed 安全入口，不产生真实 receipt：

- `runtime_receipts=0`，`OPENCLAW_RC03_SEAL` 未设置，默认 `rc03.seal` 关闭。
- 真实脱敏输入为 `42 user turns / 2 compactions / 480 units`，但 `units carrying a reason=0` 且没有 persisted receipt。
- rc03、ReceiptStore 和 config targeted checks 的绿灯属于 engineering evidence，不是 receipt baseline。
- probe 默认拒绝共享 state，并要求隔离 state/config、授权 provider/model、非敏感 probe message、可回滚清理和真实运行证明；本轮未提供凭据和网络确认，因此没有执行真实模型调用。

`openclaw_runtime/src/observability/host-trace-diagnostics.test.ts` 当前复跑 `15/15`，退出码 `0`；`host-trace-diagnostics-adapter-audit.md` 仍确认没有安全的 host-only secret/lineage/bounded sink 生产入口。因此 TF-0066 保持 `in_progress`，不能因契约测试通过而制造 dead adapter。

## 证据分类规则

| 分类 | 当前例子 | 允许证明 | 不允许证明 |
|---|---|---|---|
| `production` | `hybridSearchFactsWithEmbedding` 3 个静态调用点；T-C1 的损伤审计调用链 | 源码图中存在生产调用路径 | 默认开启、每次运行必执行、已经产生产品数据 |
| `test` / `engineering` | Vitest、schema guard、ReceiptStore、default-config matrix | 当前契约、回归和 fail-closed 行为 | 真人体验、生产流量、持续价值 |
| `experiment` | `applyContextLadder`、paired evaluator、A/B fixture | 实验面或离线工具的行为 | M4 生产接线或产品收益 |
| `synthetic` | `artifacts/runtime-memory-eval/report.json` | 可重复的工程回归输入 | L3 真人证据、真实 receipt、数据 moat |
| `real-session` | TF-0143 脱敏 JSONL 与 T-C0 `42/2/480/0` | 一份真实输入可被安全脱敏和离线分析 | 持续 receipt、用户满意度、市场护城河 |
| `real-receipt` | 当前没有，`runtime_receipts=0` | 未来才可证明真实运行中的持久谱系 | 本轮不能宣称已存在 |

## 当前阻断项与已解除边界

1. `TF-0119`：事实证据已接受，但状态收口仍阻塞，canonical node 为 `review_needed / 90`；需补齐 R3 归属或协议裁决，再重新交 lane-1 复核。
2. `TF-0135`：真实 receipt probe 已有 fail-closed 入口，但因缺少授权凭据、网络确认和真实运行条件，本轮仍不能进入 L3 14 天真人记录或 moat 结论。
3. `TF-0066`：host-only secret、审批绑定 lineage 和 bounded event sink 的 owner/adapter 尚未确定。
4. `TF-0122`：跨 run `taskId` 过滤缺陷已修复；`16/16` context-orchestrator 回归通过，hybrid 迁移 owner 仍属于后续边界。
5. `TF-0134`：M4 最终收口仍需人工审查静态扫描盲区和默认门控；当前 export inventory 不能单独判死代码。

## 不允许写出的结论

- “有静态 import/call site”不等于“默认生产通电”。
- “单测或 focused tests 全绿”不等于“生产硬阻断成立”。
- “synthetic evaluation 通过”不等于“真实用户效果通过”。
- “一份真实语料可复跑”不等于“receipt 数据资产持续增长”。
- “存在 receipt hook / writer”不等于“当前已有 persisted receipt”。
- “60-80% 已建成”“机制 12-18 个月”是规划或 sizing 假设，不是本地证据。
- 不得因 lane-2 的 review 段落、看板文字或一次命令输出，绕过 canonical Task Forest node 的状态一致性。

## 可直接复制的 lane-2 审计提示词

```text
你是 lane-2 证据执行 agent，不是状态收口 agent。你的工作是为 lane-1 提供可复核事实，不是自行宣布任务完成。

审计范围：只审当前被明确指派的 TF node 及其 issue；只读取当前 Task Forest canonical node、reviews/*.md、源码、测试、脚本和既有事实源。先记录 node 的当前 status/progress/next_action，再开始验证。不得用看板文字替代 Task Forest 或 review 文件。

每个结论必须逐条给出：
1. 具体文件路径和行号/JSON 坐标；
2. 可在当前 checkout 复跑的完整命令；
3. stdout 的关键结果；
4. 退出码；
5. 证据等级（E0 配置元数据、E1 engineering/test、E2 limited real-input、E3 real receipt、L3 真人证据）；
6. 证据分类（production、test、experiment、synthetic、real-session、real-receipt）；
7. 已证明的范围、未证明的范围和最小后续动作。

硬性禁止：
- 禁止把测试通过写成生产接线或生产默认开启；
- 禁止把 synthetic、fixture、paired summary 或离线 evaluator 写成真实会话、真人反馈或 receipt；
- 禁止把静态 import、静态 call site 或 export 枚举写成 production reachable；必须说明默认旗标、provider、上游分支和真实执行条件；
- 禁止把一次真实 JSONL 复跑写成 persisted receipt、持续数据资产、用户价值或 12-18 个月护城河；
- 禁止自行把 Task Forest node 置为 done、修改 progress、应用 proposal 或伪造 deviation；
- 禁止自行修改 AUDIT-BOARD.html 的当前状态结论；看板只由 lane-1 根据 canonical source 镜像；
- 发现 review、node、registry、plan、artifact 或 risk-acceptance 之间事实冲突时，必须报告 FAIL/REVIEW_NEEDED，并列出最小修复路径，不得选择有利口径收口；
- 不得改变默认关闭、kill switch、approval、rollback、provider、阈值或敏感数据边界；
- 真实 E2E 只有在明确授权、隔离 state/config、指定 provider/model、非敏感 probe message、可回滚清理和完整 stdout/退出码均可证明时才可执行；否则报告 BLOCKED/NOT EXECUTED，不得为了“补证据”调用共享 state 或真实凭据。

输出格式：
A. 当前 node 状态和审计范围；
B. 逐项证据表；
C. 生产/测试/实验/synthetic/real-session 分类；
D. 接受、降级、退回或阻塞的明确 status recommendation；
E. 不允许作出的推断；
F. 最小修复路径和需要 lane-1 决定的事项。

最终只提交审计报告和 status recommendation。只有 lane-1 独立复核通过，并且 review 文件、canonical node、事实源和必要 deviation 一致后，任务才可以进入正式收口。
```

## 收口规则

本报告替代 lane-2 的审计判断作为当前看板的审核口径，但不删除 lane-2 的原始证据。`TF-0122` 和 `TF-0143` 的当前 node 已是 `done / 100`，本报告确认其各自任务范围内的结论；`TF-0119` 仍为 `review_needed / 90`，`TF-0135` 和 `TF-0066` 继续阻塞后续生产/护城河主张。

本轮最终状态：**2 项范围性接受，1 项证据接受但暂不收口，1 项保持 ready，2 项保持阻塞/进行中；没有新增默认行为或生产安全边界变更。**
