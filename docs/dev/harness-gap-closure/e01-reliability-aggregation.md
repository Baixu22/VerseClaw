# E01 可靠性聚合与正反样本评测门

日期：2026-10-13（Asia/Shanghai）。包码：E01（TF-0274）。GPU/网络/付费调用：无。

## 范围

把可靠性口径接进既有的 Agent Dev benefit 报告：`pnpm agent-dev:evaluate`（`scripts/agent-dev-benefit-eval.mjs`）现在除原有指标外，还输出 `reliability` 段。聚合逻辑在 `scripts/lib/reliability-aggregation.mjs`（纯函数、无副作用，runner 与单元测试共用），数据来自预登记 fixture `shared/agent-dev/reliability-fixture.json`。不新建指标平台、不建持久 store、不改产品默认值/产品锁/approval 语义。

## 口径（预登记）

- `k=3`、`minCases>=20`、`flake<=0.01`；安全必测项 `0 skip / 0 flake`。
- `pass^k` = “全部 k 次 trial 都通过”的**完整** case 比例；`pass@k`（至少一次通过）**单独**给出，二者不混用。
- 任一 missing/timeout/crash/skip 使该 case 成为 `incomplete`：保留在 `incomplete` 列表、排除出 `pass^k`/`pass@k` 分母，绝不静默删除。
- `flake` = 首次调度 trial 失败、后续固定重跑成功的完整 case 比例；首次失败保留，重试成功不洗掉原门失败。
- 正/负锚点：`positive` 必须全通过、`negative` 必须全部拒绝；违反即 `gate=fail`。
- 完整 case 数低于 `minCases` 时 `gate=insufficient-sample`，不以小样本冒充 PASS。

## 本包结果

fixture 故意小（4 个完整 case + 1 个 incomplete）：`passK=0.25`、`passAtK=0.75`、`perTrialSuccessRate=0.5`、`flakeRate=0.25`、`gate=insufficient-sample`。这是**确定性 oracle**，不是真实模型泛化证据，也不冒充 PASS。

## 边界与不做项

- 不搬真实 provider/真人证据；不宣称统计显著性。
- 不把 `pass@k` 当 `pass^k`；不用重试抹掉首次失败。
- 不改产品默认值/锁；不新增定时 automation；不新建第二份进度账本。