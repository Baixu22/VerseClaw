# P6 TF-0074 live run evidence（2026-08-23，真实 provider 执行）

## 结论

当前源码绑定的 independent live judge / schema-free / real continuation 已
真实执行（DeepSeek 官方 API，`deepseek-v4-flash`，30/30 样本 × judge /
schema-free / continuation 全 live，0 cache，`--no-cache`）。
`evidenceInsufficient=false`——live 证据已完整采集。

**验收判定：FAIL（3/31 门未达标），生产保持 `promotionStage: shadow`。**
按 spec 失败门保持 fail-closed：不提升 stage、不解锁 TF-0075、不设置
`liveReady` / `productApproved` / default-on。本报告不伪造、不降门槛。

## 执行配置

- run：`artifacts/p6-tf0074-live-acceptance/2026-08-23T05-31-46-743Z/`
- 端点：`https://api.deepseek.com`（官方），凭据仅环境变量注入，产物
  secret 扫描 0 泄漏（`cache.noSecretLeak` PASS + 事后 grep 复验）
- 模型级联：compressor 记录 `deepseek-chat`（paired 模式，本地 Recovery
  Ledger 摘要）；judge/schema-free/continuation/critic 实际执行模型
  `deepseek-v4-flash`
- paired 输入：`artifacts/p6-tf0074-deterministic-recovery-30/would-retry-summaries.jsonl`
  （当前源码 model-free Recovery Ledger batch，manifest sha256 绑定）
- `modelIndependence`：PASS（compressor 与全部 evaluator 模型不同）
- 账户余额：起 1.78 CNY，中途充值，终 0.18 CNY

## 已授权偏差（诚实记录）

Spec P6-A 要求 judge/schema-free/continuation/critic=`deepseek-reasoner`。
本轮经用户明确指定使用 `deepseek-v4-flash`（额度有限的 key）。因此：

- 本 run 是**真实 live 诊断 run**，即使全绿也不构成正式 P6-A acceptance；
- FAIL 结论本身保守有效：门禁 fail-closed，不存在用弱 judge 放行的解读。

## 门禁结果（28/31 PASS）

### 失败门（3）

| 门 | 实际 | 要求 | 缺口 |
|---|---:|---:|---|
| `l2.schemaFree.majorOmissionRate` | 0.40（12/30：9 major + 3 critical） | <=0.10 | 主要缺口 |
| `l3.realContinuation.gate`（criticalActionMatchRate） | 0.5333（16/30） | >=0.95 | 主要缺口 |
| `l2.realJudge.gate`（noFabricationRate 子阈值） | 0.9333（28/30） | >=0.98 | 2 样本被judge 判定虚构/误标 |

L2 real judge 其余子阈值全过：score mean 9.7/min 7（26/30 满分 10）、
completeness 1.0、accuracy 0.9667、causal chain 1.0、actionability 0.9333。

### 通过门（节选）

deterministic L0/L1/informationLoss 全绿（retention 189/189=1.0、
criticalDropped=0、L1 critical mean/min=1.0）、stale leakage=0、
manifest 30/30 精确解析、`full.realJudge.coverage`=30、
`full.schemaFree.coverage`=30、`full.realContinuation.coverage`=30、
noRepeatedWork=1.0、noContradictoryAction=1.0、secret 扫描 0 泄漏。

## 失败模式分析（来自逐样本 judge 输出）

schema-free 12 条 major/critical omission 聚焦三类语义缺失：

1. **「预期 vs 故障」语义丢失**（R1/R4/R21/R23）：摘要把预期内的禁用态、
   SQLite 锁警告、ENOENT 测试预期等保留为事实，但丢失「这是预期行为、
   非产品故障」的定性，恢复后会被误读为待修故障。
2. **「已完成+已验证」结局状态丢失/误标**（R15/R27/R28）：修复已应用且
   grep 已确认的完成态没有进入摘要，R27 甚至被 judge 指出「invents a
   shell_quoting_failure and an in-progress state」——与 L2 的 2 条
   no-fabrication 失败相互印证。
3. **调查结论丢失**（R10/R11/R17）：「无手动 compaction CLI、openclaw
   不在 PATH、compaction 为自动触发」等结论性事实未保留。

continuation 14 条失败呈单一模式：模型发出「保留已验证结局、不重复已
完成工作」的泛化 decision，而非期望的 critical action（通过样本均为
「Inspect the failure around…」+ `critical:true` 形状）。失败样本
`noRepeatedWork=1.0`、`noContradictoryAction=1.0`——模型与摘要自洽，
但摘要未携带足够的「下一步该做什么」指令让新会话命中期望动作；
`completedWithCompressedContext=false` 而 full-context 参照为 true。

## 迭代方向（不越过门禁）

失败模式与 TF-0071..0073 已修的 exact-identifier / handoff-structure /
completed-outcome 主题同族但更深层：Recovery Ledger 保留「经验证的
事实」，但尚未保留三类恢复语义——expected-vs-failure 定性、终局
completed+verified 状态、面向下一动作的 continuation 指令。下一步应按
spec 的 failure-guideline 循环：把上述 12+2 条失败样本提炼为 guideline，
迭代摘要生成策略（Recovery Ledger 投影增加这三类字段），本地
deterministic 复验后再重跑 live。正式 P6-A acceptance 仍需
`deepseek-reasoner` 级 judge 与足额凭据。

## 边界

本 run 不关闭 TF-0074，不解锁 TF-0075，不改变 promotion stage。旧冻结
摘要（08-18）不合格的结论见
`P6-TF0074-LIVE-PREFLIGHT-EVIDENCE-2026-08-23.md`，本 run 使用当前源码
摘要，排除了该混杂因素。
