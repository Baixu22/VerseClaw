# Handoff Benchmark v1 正式验收报告（2026-08-25）

状态：**正式（锁定 GT）**——本报告为 v7 压缩器在下游真度量上的首个正式基线，后续所有优化的裁决依据。

## 1. 验收输入与证据链

| 项 | 值 |
| --- | --- |
| GT 文件 | `reports/context-compression/handoff-benchmark-v1/ground-truth.json`（12 样本） |
| 锁定 | `ground-truth.json.lock.json`，gtSha256 `698de58e7ffd4615...`，lockedBy=用户指令（2026-08-25 聊天授权），两次运行哈希一致 |
| 压缩批次 | `artifacts/p6-tf0074-deterministic-recovery-30-v12/`（v7 压缩器，30 样本，确定性） |
| 接手模型 | **qwen-plus**（DashScope compatible-mode） |
| 裁决 judge | qwen-plus-latest（脚本启动断言 handoff≠judge；注：同族不同型号，残余同源偏好风险已声明） |
| 变体 | core（剥离 Continuation Directive）与 shipped（随货完整摘要） |
| 双盲 | run 模式结构性不加载 transcript；prompt 断言 |
| 成本 | core ¥0.181（45 calls），shipped ¥0.182（40 calls）；预算护栏 ¥5 未触发；key 仅环境变量注入，artifact 无密钥 |

## 2. 正式验收指标（v7 压缩器）

| 指标 | core | shipped |
| --- | --- | --- |
| handoff-success-rate | **0.250** | 0.167 |
| repeat-work-rate | 0.417 | 0.333 |
| contradiction-rate | **0.083** | 0.250 |
| state-accuracy | 0.896 | 0.896 |

### 逐样本（core/shipped）

| sample | success | repeat | contradiction | state-acc |
| --- | --- | --- | --- | --- |
| R5 | false/false | false/false | false/false | 0.75/0.75 |
| R8 | false/false | false/false | false/false | 0.75/1.00 |
| R9 | true/true | true/false | false/false | 1.00/0.75 |
| R10 | false/false | true/false | false/false | 1.00/1.00 |
| R11 | false/false | false/true | false/true | 1.00/1.00 |
| R13 | false/false | false/false | false/false | 1.00/1.00 |
| R14 | false/false | true/true | false/true | 1.00/1.00 |
| R16 | false/false | true/false | true/false | 1.00/1.00 |
| R17 | false/false | true/true | false/true | 1.00/1.00 |
| R25 | true/false | false/true | false/false | 1.00/1.00 |
| R26 | true/true | false/false | false/false | 0.75/0.75 |
| R30 | false/false | false/false | false/false | 0.50/0.50 |

## 3. 验收结论（诚实定性）

1. **这是度量，不是门禁翻案**：handoff benchmark 是 v8 新增的第四轴真度量，没有预注册通过阈值；上述数字是**基线**。v7 三阶段验收（judge/schema-free/continuation，各自预注册门槛全绿）结论不变——两者证据类型不同，不得互相顶替。
2. **真实缺陷信号（正式）**：待办目标家族样本（R10–R17）在两个变体、qwen-plus 接手下 success **0/6**——v7 摘要携带完整调查结论（state-accuracy 1.0）但无法驱动"经 /compact 或 compaction-safeguard 执行压缩"这一正确动作；core 变体重复工作率 5/12。这是 P1/P2 的首要优化目标，现已有正式（非 provisional）证据。
3. **模型不变性检验**：正式（qwen-plus）与临时（qwen-flash）对比，success 不升反降（core 0.25 vs 0.333；shipped 0.167 vs 0.25）——瓶颈在摘要内容而非接手模型能力；换更强接手模型救不了当前摘要。
4. **完成态样本基本守住**：R26 两变体 success=true、R9 core=true，无矛盾集中在完成类样本——v7 完成态表达有效面保留。

## 4. 后续裁决规则（继承 v8 计划）

- 任何压缩器改动的接受条件：优化集 handoff-success 增益 ≥5pp、repeat/contradiction 不升、回归 30（含本基线）降幅 ≤2pp；
- 冻结 holdout（15 样本）仅终评一次（`--terminal-holdout --i-confirm-terminal-holdout`，聚合输出）；
- 优化集 GT 仍为草案（循环内部适应度），正式结论只认回归集锁定 GT + holdout 终评。

## 5. 证据索引

- 结果：`artifacts/handoff-benchmark-v1/acceptance-2026-08-25-{core,shipped}/`（results.json + 逐样本 trace + 缓存）
- 临时基线对照：`reports/context-compression/HANDOFF-BENCHMARK-V1-BASELINE-2026-08-25.md`
- 协议与计分器版本：handoff-prompt-v1 / handoff-judge-prompt-v2 / BANDS v1.1（results.json 内记录）
## 6. 计分器演进与归因终版（追加，2026-08-25 深夜）

正式验收后按真实数据做了两轮计分器升级（锁定 GT 不变，接手输出缓存复用）：

- **scoring-v1.2**：新增「信息可用性归因」（逐样本判定 GT 下一动作信息是否在摘要中）；修复短引用 fail-closed 误杀（R30 q4 逐字引用 "No" 被 8 字符下限拒绝）。
- **scoring-v1.3**：模糊带裁决改 **k=3 多数投票**（temperature 0.3，选票留痕）。起因实证：同一接手输出在 v1.1→v1.2 间翻转 2-3 个标志（judge 单发方差）。

### 三版指标对比（同锁定 GT、同接手输出）

| 计分版本 | 变体 | success | repeat | contradiction | state-acc |
| --- | --- | --- | --- | --- | --- |
| v1.1 | core | 0.250 | 0.417 | 0.083 | 0.896 |
| v1.2（单发） | core | 0.333 | 0.667 | 0 | 0.979 |
| **v1.3（k=3）** | **core** | **0.250** | **0.583** | **0** | **0.938** |
| v1.1 | shipped | 0.167 | 0.333 | 0.250 | 0.896 |
| v1.2（单发） | shipped | 0.167 | 0.167 | 0 | 0.938 |
| **v1.3（k=3）** | **shipped** | **0.250** | **0.250** | **0.167** | **0.896** |

**采纳 v1.3（k=3）为正式基线**：单发裁决方差被证实污染指标（±1-2 个样本翻转），多数投票是当前最可信估计；残余方差待重跑性子集量化（backlog）。

### 归因结论（v1.2/v1.3 一致）

- **12/12 样本 gtActionAvailable=true → 压缩损失 = 0**：v7 摘要没有丢下一动作所需信息；
- 全部失败为 `presentation-or-agent-loss`（core 8/12，shipped 10/12）：入口点以叙事存在、未提升为动作；
- shipped 表现不优于 core：directive 的不透明候选 ID 与状态复读对强接手模型是负资产。

### 成本

v1.2 core ¥0.179 / shipped ¥0.183；v1.3 core ¥0.195（93 calls）/ shipped ¥0.200（105 calls）。预算护栏均未触发。

## 7. Bench backlog（按优先级）

1. 重跑性子集（3 样本 ×2）给指标误差棒；
2. 故事型分层报告（pending/blocked/completed）；
3. 虚构诱导探针（正确答案=「摘要未提及」）；
4. GT v2：`acceptableAlternatives`（R5 类完成态前向动作语义），需用户审锁；
5. 语料多样化（跨家族/跨项目）。