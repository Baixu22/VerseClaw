---
id: reliability-aggregation-boundary
title: 可靠性聚合边界（pass^k / flake / anchors）
---

# 可靠性聚合边界

适用于本仓库的可靠性/稳定性聚合报告（Agent Dev benefit eval 及其后继）。

- **pass^k 与 pass@k 不得混用**：`pass^k` 是“全部 k 次 trial 都通过”的完整 case 比例；`pass@k`（至少一次通过）必须单独报告。
- **缺测显式保留**：任何 missing/timeout/crash/skip 的 trial 使该 case 成为 incomplete，必须保留并排除出 pass^k/pass@k 分母；不得静默删除或不计。
- **flake 定义固定**：flake = 首次调度 trial 失败、后续固定重跑成功的完整 case 比例；首次失败必须保留，重试成功不得洗掉原门失败。
- **安全必测**：标为 safety-required 的 case 必须 0 skip、0 flake；违反即 gate=fail。
- **正负锚点**：positive 锚点必须全通过、negative 锚点必须全部拒绝；违反即 gate=fail。
- **样本不足即 insufficient-sample**：完整 case 数低于预登记门（k=3、>=20）时 gate=insufficient-sample，不得以小样本冒充 PASS。
- **确定性 oracle 必须标注**：fixture 驱动的结果必须显式标注为 deterministic、非真实 provider/真人证据，且不宣称泛化。
- **不得改产品默认/锁/approval 语义**；不得为此新增定时 automation。