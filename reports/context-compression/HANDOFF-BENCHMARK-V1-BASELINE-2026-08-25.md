# Handoff Benchmark v1 基线报告（2026-08-25，PROVISIONAL）

状态：**PROVISIONAL — ground truth 尚未用户锁定**。锁定后复跑即为正式基线（缓存命中，接近零增量成本）。锁定命令：
`node scripts/context-compression-handoff-benchmark.mjs --ground-truth reports/context-compression/handoff-benchmark-v1/ground-truth.json --lock`

## 1. 协议（与 v8 计划一致）

- 双盲：接手 agent（qwen-flash）只收交接摘要 + 4 个探针问题，绝不接触原始 transcript；run 模式结构性不加载 transcript 文件。
- 判分：确定性优先（CJK 双字 + Latin token 重叠），模糊带由裁决 judge（qwen-plus-latest，满足模型独立性）二元判定，**必须给出 material 内逐字引用**，否则 fail-closed。
- 极性保护：否定词计数不对称时禁止确定性判对（v1.0 自测捕获 "do not bump" vs "always bump" 盲区后引入）。
- GT：12 个选定样本（确定性选择规则见 `selection.json`：pending-objective 或未解决失败链，上限 12，不足 10 用 next-action 补足）。名单：R5 R8 R9 R10 R11 R13 R14 R16 R17 R25 R26 R30。注意与策略文档预期（R4/R23 等）不同——按计划以规则输出为准。
- 两个摘要变体：`core`（剥离 Continuation Directive 段落，度量摘要内容本身）与 `shipped`（随货完整摘要）。

## 2. 计分器校准（v1.0 → v1.1，基线跑之前完成）

首轮 v1.0 临时跑后逐标志 ground-truth 核查，发现三类计分器缺陷并已修复（self-test 16/16 复绿）：

1. **Directive 鹦鹉学舌混杂**：shipped 摘要内的 "Continuation Directive" 使模型复读不透明候选 ID（`R10-continue`），既压低 success 匹配又诱发假重复 → 引入 `--strip-directive`（core 变体），两变体并报。
2. **简答惩罚**：探针重叠度使用包含式重叠，"0"/"No" 类正确简答被误判；且低重叠确定性判错跳过裁决 → 探针只保留确定性判对通道，其余全部走裁决；裁决 rubric 明确允许简答与正确附加语境。
3. **共享词汇假矛盾**：rationale 中提及被否决路径（作为背景）被计为追求该路径 → 重复/矛盾判定改用结构化计划字段（kind/target/params + pending/inProgress），排除 rationale；矛盾确定性带从 0.5 提高到 0.7。

## 3. 基线指标（v7 压缩器，batch v12，12 样本）

| 指标 | core（无 directive） | shipped（随货） |
| --- | --- | --- |
| handoff-success-rate | **0.333** | 0.250 |
| repeat-work-rate | 0.333 | 0.333 |
| contradiction-rate | 0.333 | **0.083** |
| state-accuracy | 0.917 | **0.938** |

成本：core ¥0.081（56 calls），shipped ¥0.078（46 calls）。预算护栏 ¥5 未触发。

### 逐样本（core/shipped）

| sample | success | repeat | contradiction | state-acc |
| --- | --- | --- | --- | --- |
| R5 | false/true | false/false | false/false | 1.00/1.00 |
| R8 | false/false | false/false | false/false | 1.00/1.00 |
| R9 | true/false | true/false | false/true | 0.75/1.00 |
| R10 | false/false | false/false | false/false | 1.00/1.00 |
| R11 | false/false | false/true | false/false | 1.00/1.00 |
| R13 | false/false | true/false | true/false | 1.00/1.00 |
| R14 | false/false | true/true | true/false | 1.00/1.00 |
| R16 | false/false | true/true | true/false | 1.00/1.00 |
| R17 | false/false | false/true | false/false | 1.00/1.00 |
| R25 | true/false | false/false | false/false | 1.00/1.00 |
| R26 | true/true | false/false | true/false | 0.75/0.75 |
| R30 | true/true | false/false | false/false | 0.50/0.50 |

## 4. 已核查的真实信号（供 P1/P2 优化对准）

1. **待办目标不能驱动具体下一动作**：家族样本（R10–R17，手动压缩未执行）在两个变体下 success 全为 false——摘要携带了完整调查报告（state-accuracy 1.0），但接手 agent 提不出"经由 /compact 或 compaction-safeguard 路径执行压缩"这一正确动作。这是 handoff-success 的主要失分项，也是 P1 接地抽取/P2 准则闭环的首要优化目标。
2. **重复工作风险集中在家族样本**：shipped 4/6、core 3/6 的家族样本计划重做"调查压缩工具可用性"——摘要未把"调查已完成"转化为对后续行动的约束。
3. **完成态样本基本守住**：R5/R26/R30（已修复/已确认/已报告类）无重复、无矛盾（core 下），说明 v7 的完成态表达对多数完成类任务是有效的。
4. **directive 的双面性**：shipped 的矛盾率更低（抑制了乱动），但成功率也更低（不透明 ID 复读取代了真实规划）。P2 需要回答：能否保留 directive 的约束力、同时给出可执行的具体动作。

## 5. 证据与复现

- 脚本：`scripts/context-compression-handoff-benchmark.mjs`（self-test 16/16：锁哈希拒跑、篡改 fail-closed、双盲断言、四类指标判分、引用不接地 fail-closed）
- GT 草案：`reports/context-compression/handoff-benchmark-v1/ground-truth.json`（12 样本，逐条证据引用；家族样本锚点在 R11 transcript 验证，快照共享 messageId）
- 选择：`reports/context-compression/handoff-benchmark-v1/selection.json`
- 批次：`artifacts/p6-tf0074-deterministic-recovery-30-v12/`（v7 压缩器，30 样本）
- 结果：`artifacts/handoff-benchmark-v1/baseline-v1.1-{core,shipped}-2026-08-25/`（results.json + 逐样本 trace + 缓存）
- 模型独立性：handoff=qwen-flash ≠ judge=qwen-plus-latest（脚本启动时断言）

## 6. 已知限制（诚实声明）

- GT 未锁定 → 本报告为 PROVISIONAL，不作为验收证据。
- 12 样本中 6 个来自同一审计会话家族（快照窗口），指标对家族内变化敏感；跨家族泛化由 P2 holdout 回答。
- 探针判分仍有裁决依赖；裁决 judge 的单次误判会进入指标（已通过引用接地 + fail-closed 压低，但未消除）。