---
id: paired-ablation-boundary
title: 配对消融边界（主指标预登记 / 效应量与区间 / 不挑赢家）
---

# 配对消融边界

适用于本仓库的组件收益/退化配对消融。

- **预登记**：主指标、k、case 数下限、退化预算必须在 fixture 里先写定；不得跑完后调阈值或挑赢家。
- **真实组件**：treatment 必须是既有、可逆、非安全的生产组件；baseline 是其 leave-one-out。先验证组件生效（移除痕迹）。
- **配对**：按 (caseId, repeat) 配对，固定 seed、隔离状态、随机/固定顺序一致。
- **区分 synthetic 与 live**：无真实 provider 调用必须显式标注 synthetic/local-fixture，tokens 若为代理必须写明，不升级为 live，不宣称泛化或账单。
- **效应量 + 95% 区间**：报告均值差、区间、效应量；判决按区间是否排除 0 得出，零/负效应是有效结果。
- **安全与误拦截**：安全违规或显著负效应必须显式判为 safety-regression / hurts，不得掩盖。
- **不改产品默认/锁/approval**：显著正效应也不得据此改默认值、产品锁或扩大启用。